const { createHash } = require('node:crypto');
const { OFERTAS_PROMOCIONALES, verificarCompradorPromocion } = require('./promociones-cursos');

const DURACIONES = {
  enlace_tiempo: 'enlace_abierto',
  video_tiempo: 'video_reproducido',
  checkout_tiempo: 'checkout_montado',
  ya_pague_tiempo: 'ya_pague'
};
const TIPOS = ['enlace_abierto', 'video_reproducido', 'checkout_creado', 'checkout_montado', 'ya_pague', ...Object.keys(DURACIONES)];
const CURSOS_MEDIDOS = ['gallinas-de-postura', 'embutidos-artesanales'];
const ATRIBUCIONES = [
  ...OFERTAS_PROMOCIONALES,
  { origenSlug: 'embutidos-artesanales', destinoSlug: 'gallinas-de-postura' },
  ...CURSOS_MEDIDOS.map(destinoSlug => ({ origenSlug: null, destinoSlug }))
];
const ZONA_HORARIA = 'America/Mexico_City';
const MAX_EVENTOS = 5000;
const MAX_DETALLE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESION_STRIPE = /^cs_[a-zA-Z0-9_]{1,150}$/;
const MAX_DURACION_SEG = 6 * 3600;
const MAX_EDAD_SEG = 24 * 3600;
const calendario = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA, calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit'
});

function fechaLocal(date) {
  const partes = Object.fromEntries(calendario.formatToParts(date).map(p => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function coleccionEventos(db, origenSlug, destinoSlug) {
  return db.collection('promocionesCursosMetricas').doc(`${origenSlug || 'directo'}:${destinoSlug}`).collection('eventos');
}

function referenciaEvento(db, { origenSlug, destinoSlug, tipo, eventoId, uid, claveRegistro = uid }) {
  const id = createHash('sha256').update(JSON.stringify([tipo, claveRegistro, eventoId])).digest('hex');
  return coleccionEventos(db, origenSlug, destinoSlug).doc(id);
}

function datosEvento(evento, ahora) {
  const { origenSlug, destinoSlug, tipo, uid, email, nombre, anonimo, modo } = evento;
  return {
    origenSlug, destinoSlug, tipo, uid, email: email || null, nombre: nombre || '',
    anonimo: anonimo === true, fechaEn: ahora.toISOString(),
    ...(modo ? { modo } : {})
  };
}

async function guardarEventoPromo(db, evento, ahora = new Date()) {
  const ref = referenciaEvento(db, evento);
  try {
    await ref.create(datosEvento(evento, ahora));
  } catch (err) {
    if (err.code !== 6 && err.code !== 'already-exists') throw err;
    // Un reintento conserva la hora y la identidad originales.
  }
}

function normalizarVisitaId(id) {
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

function atribucionValida(origenSlug, destinoSlug) {
  return ATRIBUCIONES.some(par => par.origenSlug === origenSlug && par.destinoSlug === destinoSlug);
}

function identidadActividad(usuario, visitaId) {
  if (usuario?.uid && usuario.email && usuario.email_verified === true) {
    return {
      uid: usuario.uid, email: usuario.email.toLowerCase().trim().slice(0, 320),
      nombre: String(usuario.name || '').trim().slice(0, 160), anonimo: false
    };
  }
  const anonimoId = createHash('sha256').update(visitaId).digest('hex').slice(0, 24);
  return { uid: 'visita:' + anonimoId, email: null, nombre: '', anonimo: true };
}

async function registrarCheckoutActividad(db, { origenSlug, destinoSlug, visitaId, usuario, sessionId }) {
  const ahora = new Date();
  const evento = {
    ...identidadActividad(usuario, visitaId), origenSlug, destinoSlug,
    tipo: 'checkout_creado', eventoId: sessionId, claveRegistro: 'visita:' + visitaId
  };
  await guardarEventoPromo(db, evento, ahora);
}

function errorActividad(status, message) {
  return Object.assign(new Error(message), { status });
}

function validarVigencia(entrada, ahora) {
  const transcurrido = Math.floor((ahora.getTime() - Date.parse(entrada.fechaEn)) / 1000);
  if (!Number.isFinite(transcurrido) || transcurrido < 0 || transcurrido > MAX_EDAD_SEG) {
    throw errorActividad(409, 'La actividad ya venció');
  }
  return transcurrido;
}

async function guardarDuracion(db, evento, tipoInicio, duracionSeg, ahora) {
  const inicioRef = referenciaEvento(db, { ...evento, tipo: tipoInicio });
  const finRef = referenciaEvento(db, evento);
  await db.runTransaction(async tx => {
    const inicio = await tx.get(inicioRef);
    if (!inicio.exists) throw errorActividad(404, 'No encontramos el inicio de esta actividad');
    const datosInicio = inicio.data();
    const transcurrido = validarVigencia(datosInicio, ahora);
    const duracion = Math.min(duracionSeg, transcurrido + 5);
    const fin = await tx.get(finRef);
    const datosFin = fin.data();
    if (duracion > (datosFin?.duracionSeg || 0)) {
      tx.set(finRef, {
        ...datosEvento({ ...evento, uid: datosInicio.uid, email: datosInicio.email, nombre: datosInicio.nombre, anonimo: datosInicio.anonimo, modo: datosInicio.modo }, ahora),
        fechaEn: datosInicio.fechaEn,
        duracionSeg: duracion
      });
    }
  });
}

function contador() {
  return Object.fromEntries(TIPOS.map(tipo => [tipo, 0]));
}

async function consultarMetricas(db, ofertas, dias, ahora = new Date()) {
  const inicio = new Date(fechaLocal(ahora) + 'T00:00:00.000Z');
  inicio.setUTCDate(inicio.getUTCDate() - dias + 1);
  const primerDia = inicio.toISOString().slice(0, 10);
  const bloques = await Promise.all(ofertas.map(({ origenSlug, destinoSlug }) =>
    coleccionEventos(db, origenSlug, destinoSlug)
      .where('fechaEn', '>=', inicio.toISOString())
      .orderBy('fechaEn', 'desc')
      .limit(MAX_EVENTOS + 1)
      .get()
  ));
  const eventos = bloques.flatMap(snap => snap.docs.map(doc => doc.data()))
    .filter(ev => TIPOS.includes(ev.tipo) && fechaLocal(new Date(ev.fechaEn)) >= primerDia)
    .sort((a, b) => b.fechaEn.localeCompare(a.fechaEn));
  const truncado = eventos.length > MAX_EVENTOS;
  const analizados = eventos.slice(0, MAX_EVENTOS);
  const porPersona = new Map();
  const porDia = new Map();
  const porTipo = Object.fromEntries(TIPOS.map(tipo => [tipo, { eventos: 0, personas: new Set(), anonimos: new Set(), duracionSeg: 0 }]));

  for (let d = 0; d < dias; d++) {
    const fecha = inicio.toISOString().slice(0, 10);
    porDia.set(fecha, { fecha, ...contador(), duraciones: contador() });
    inicio.setUTCDate(inicio.getUTCDate() + 1);
  }

  for (const ev of analizados) {
    const tipo = porTipo[ev.tipo];
    tipo.eventos++;
    tipo.personas.add(ev.uid);
    if (ev.anonimo === true) tipo.anonimos.add(ev.uid);
    const duracion = ev.duracionSeg || 0;
    tipo.duracionSeg += duracion;
    const periodo = porDia.get(fechaLocal(new Date(ev.fechaEn)));
    if (periodo) {
      periodo[ev.tipo]++;
      periodo.duraciones[ev.tipo] += duracion;
    }
    if (!porPersona.has(ev.uid)) {
      porPersona.set(ev.uid, {
        uid: ev.uid, email: ev.email, nombre: ev.nombre, anonimo: ev.anonimo === true,
        ultimoEn: ev.fechaEn, totales: contador(), duraciones: contador()
      });
    }
    porPersona.get(ev.uid).totales[ev.tipo]++;
    porPersona.get(ev.uid).duraciones[ev.tipo] += duracion;
  }

  const totales = Object.fromEntries(TIPOS.map(tipo => [tipo, {
    eventos: porTipo[tipo].eventos, personas: porTipo[tipo].personas.size,
    anonimos: porTipo[tipo].anonimos.size, identificados: porTipo[tipo].personas.size - porTipo[tipo].anonimos.size,
    duracionSeg: porTipo[tipo].duracionSeg
  }]));
  return {
    dias,
    zonaHoraria: ZONA_HORARIA,
    truncado,
    detalleTruncado: analizados.length > MAX_DETALLE,
    personasTruncadas: porPersona.size > MAX_DETALLE,
    totales,
    serie: [...porDia.values()],
    personas: [...porPersona.values()].slice(0, MAX_DETALLE),
    eventos: analizados.slice(0, MAX_DETALLE),
    ofertas: ATRIBUCIONES
  };
}

function registrarMetricasPromocion(app, { db, tokenRequerido, adminRequerido, log }) {
  app.post('/alumno/promociones/eventos', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const u = await tokenRequerido(req, res);
      if (!u) return;
      const { origenSlug, destinoSlug, tipo, eventoId } = req.body || {};
      const montaje = tipo === 'checkout_montado';
      const eventoAlumno = tipo === 'enlace_abierto' || tipo === 'video_reproducido';
      if (typeof eventoId !== 'string' || (!montaje && !eventoAlumno) ||
          !(montaje ? SESION_STRIPE : UUID).test(eventoId)) {
        return res.status(400).json({ error: 'Evento promocional inválido' });
      }
      const identidad = await verificarCompradorPromocion(db, u, origenSlug, destinoSlug);
      const idNormalizado = montaje ? eventoId : eventoId.toLowerCase();
      const evento = { ...identidad, origenSlug, destinoSlug, tipo, eventoId: idNormalizado };
      if (montaje) {
        const previa = await referenciaEvento(db, { ...evento, tipo: 'checkout_creado' }).get();
        if (!previa.exists) return res.status(404).json({ error: 'No encontramos esa sesión para esta promoción' });
      }
      await guardarEventoPromo(db, evento);
      return res.status(204).end();
    } catch (err) {
      if ([400, 401, 403, 404, 409].includes(err.status)) return res.status(err.status).json({ error: err.message });
      log.error('Error al registrar métrica de promoción:', err.code || err.name);
      return res.status(500).json({ error: 'No pudimos registrar la actividad' });
    }
  });

  app.post('/publico/cursos/actividad', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const { destinoSlug, origenSlug = null, tipo, duracionSeg, modo } = req.body || {};
      const visitaId = normalizarVisitaId(req.body?.visitaId);
      const esCheckout = tipo === 'checkout_montado' || tipo === 'checkout_tiempo';
      const eventoId = req.body?.eventoId || (esCheckout ? req.body?.sessionId : null);
      const tipoInicio = Object.hasOwn(DURACIONES, tipo) ? DURACIONES[tipo] : null;
      if (!visitaId || !atribucionValida(origenSlug, destinoSlug) ||
          !TIPOS.includes(tipo) || tipo === 'checkout_creado' ||
          typeof eventoId !== 'string' || !(esCheckout ? SESION_STRIPE : UUID).test(eventoId) ||
          (esCheckout && req.body.sessionId && req.body.sessionId !== eventoId)) {
        return res.status(400).json({ error: 'Actividad de curso inválida' });
      }
      if (tipoInicio && (!Number.isSafeInteger(duracionSeg) || duracionSeg < 1 || duracionSeg > MAX_DURACION_SEG)) {
        return res.status(400).json({ error: 'Duración inválida' });
      }
      const tieneToken = Boolean(req.get('authorization'));
      const usuario = tieneToken ? await tokenRequerido(req, res) : null;
      if (tieneToken && !usuario) return;
      const ahora = new Date();
      const evento = {
        ...identidadActividad(usuario, visitaId), origenSlug, destinoSlug, tipo,
        eventoId: esCheckout ? eventoId : eventoId.toLowerCase(),
        claveRegistro: 'visita:' + visitaId,
        ...(tipo === 'video_reproducido' && ['automatico', 'manual'].includes(modo) ? { modo } : {})
      };
      if (tipoInicio) {
        await guardarDuracion(db, evento, tipoInicio, duracionSeg, ahora);
      } else {
        if (esCheckout) {
          const anterior = await referenciaEvento(db, { ...evento, tipo: 'checkout_creado' }).get();
          if (!anterior.exists) throw errorActividad(404, 'No encontramos esa sesión en esta visita');
          const original = anterior.data();
          validarVigencia(original, ahora);
          evento.uid = original.uid;
          evento.email = original.email;
          evento.nombre = original.nombre;
          evento.anonimo = original.anonimo;
        }
        await guardarEventoPromo(db, evento, ahora);
      }
      return res.status(204).end();
    } catch (err) {
      if ([400, 401, 403, 404, 409].includes(err.status)) return res.status(err.status).json({ error: err.message });
      log.error('Error al registrar actividad del curso:', err.code || err.name);
      return res.status(500).json({ error: 'No pudimos registrar la actividad' });
    }
  });

  app.get('/admin/cursos/promociones/metricas', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const admin = await adminRequerido(req, res);
      if (!admin) return;
      const { dias: valorDias = '30', origenSlug, destinoSlug } = req.query;
      const dias = Number(valorDias);
      if (typeof valorDias !== 'string' || !/^\d{1,2}$/.test(valorDias) ||
          !Number.isInteger(dias) || dias < 1 || dias > 90) {
        return res.status(400).json({ error: 'Consulta entre 1 y 90 días' });
      }
      const ofertas = ATRIBUCIONES.filter(oferta =>
        (origenSlug === undefined || (origenSlug === 'directo' ? null : origenSlug) === oferta.origenSlug) &&
        (destinoSlug === undefined || destinoSlug === oferta.destinoSlug)
      );
      if (!ofertas.length) return res.status(400).json({ error: 'Promoción inválida' });
      return res.json(await consultarMetricas(db, ofertas, dias));
    } catch (err) {
      log.error('Error al consultar métricas de promoción:', err.code || err.name);
      return res.status(500).json({ error: 'No pudimos consultar las métricas' });
    }
  });
}

module.exports = { guardarEventoPromo, registrarMetricasPromocion, registrarCheckoutActividad, normalizarVisitaId, atribucionValida };

const { createHash } = require('node:crypto');
const { OFERTAS_PROMOCIONALES, verificarCompradorPromocion } = require('./promociones-cursos');

const DURACIONES = {
  pagina_tiempo: 'pagina_visitada',
  enlace_tiempo: 'enlace_abierto',
  video_tiempo: 'video_reproducido',
  checkout_tiempo: 'checkout_montado',
  ya_pague_tiempo: 'ya_pague'
};
const PUBLICOS = ['pagina_visitada', 'enlace_abierto', 'video_reproducido', 'checkout_montado', 'ya_pague', ...Object.keys(DURACIONES)];
const TIPOS = [...PUBLICOS, 'checkout_creado', 'compra_pagada'];
const CURSOS_MEDIDOS = ['gallinas-de-postura', 'embutidos-artesanales'];
const PROMOCIONES_MEDIDAS = [
  ...OFERTAS_PROMOCIONALES,
  { origenSlug: 'embutidos-artesanales', destinoSlug: 'gallinas-de-postura' }
];
const SIN_ATRIBUCION = 'sin_atribucion';
const DISPOSITIVOS = ['telefono', 'computadora', 'tableta', 'desconocido'];
const MODOS_VIDEO = ['manual', 'automatico', 'desconocido'];
const CURSOS_ADICIONALES_MAX = 20;
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
  const idCanonico = tipo === 'pagina_visitada' || tipo === 'pagina_tiempo' ? '' : eventoId;
  const id = createHash('sha256').update(JSON.stringify([tipo, claveRegistro, idCanonico])).digest('hex');
  return coleccionEventos(db, origenSlug, destinoSlug).doc(id);
}

function datosEvento(evento, ahora) {
  const { origenSlug, destinoSlug, tipo, uid, email, nombre, anonimo, modo, dispositivo, identidad, checkoutRef } = evento;
  return {
    origenSlug, destinoSlug, tipo, uid, email: email || null, nombre: nombre || '',
    anonimo: anonimo === true, fechaEn: ahora.toISOString(),
    dispositivo: normalizarDispositivo(dispositivo),
    identidad: identidad || (anonimo ? 'visita_anonima' : 'cuenta_verificada'),
    ...(checkoutRef ? { checkoutRef } : {}),
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

function normalizarDispositivo(dispositivo) {
  return DISPOSITIVOS.includes(dispositivo) ? dispositivo : 'desconocido';
}

function cursoElegible(slug, datos) {
  return typeof slug === 'string' && /^[a-z0-9-]{1,120}$/.test(slug) &&
    slug !== 'sexaje-avicola' && slug !== 'directo' &&
    datos?.medirActividad === true && datos.ventaDirecta !== false && datos.regaloExclusivo !== true;
}

async function cursoMedido(db, slug) {
  if (CURSOS_MEDIDOS.includes(slug)) return true;
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,120}$/.test(slug) || slug === 'sexaje-avicola') return false;
  return cursoElegible(slug, (await db.collection('cursosVenta').doc(slug).get()).data());
}

async function atribucionValida(db, origenSlug, destinoSlug) {
  if (origenSlug === null) return cursoMedido(db, destinoSlug);
  return PROMOCIONES_MEDIDAS.some(par => par.origenSlug === origenSlug && par.destinoSlug === destinoSlug);
}

async function opcionesActividad(db) {
  const adicionales = await db.collection('cursosVenta').where('medirActividad', '==', true)
    .limit(CURSOS_ADICIONALES_MAX + CURSOS_MEDIDOS.length).get();
  const cursos = new Set(CURSOS_MEDIDOS);
  adicionales.docs.filter(d => cursoElegible(d.id, d.data())).forEach(d => cursos.add(d.id));
  return [
    ...PROMOCIONES_MEDIDAS,
    ...[...cursos].flatMap(destinoSlug => [{ origenSlug: null, destinoSlug }, { origenSlug: SIN_ATRIBUCION, destinoSlug }])
  ];
}

function identidadActividad(usuario, visitaId) {
  if (usuario?.uid && usuario.email && usuario.email_verified === true) {
    return {
      uid: usuario.uid, email: usuario.email.toLowerCase().trim().slice(0, 320),
      nombre: String(usuario.name || '').trim().slice(0, 160), anonimo: false, identidad: 'cuenta_verificada'
    };
  }
  const anonimoId = createHash('sha256').update(visitaId).digest('hex').slice(0, 24);
  return { uid: 'visita:' + anonimoId, email: null, nombre: '', anonimo: true, identidad: 'visita_anonima' };
}

function checkoutVinculo(db, sessionId) {
  const clave = createHash('sha256').update(sessionId).digest('hex');
  return db.collection('promocionesCheckoutVinculos').doc(clave);
}

async function registrarCheckoutActividad(db, { origenSlug, destinoSlug, visitaId, usuario, sessionId, dispositivo }) {
  const ahora = new Date();
  const vinculo = checkoutVinculo(db, sessionId);
  const evento = {
    ...identidadActividad(usuario, visitaId), origenSlug, destinoSlug,
    tipo: 'checkout_creado', eventoId: sessionId, claveRegistro: 'visita:' + visitaId, dispositivo, checkoutRef: vinculo.id
  };
  const registro = referenciaEvento(db, evento);
  await db.runTransaction(async tx => {
    if ((await tx.get(vinculo)).exists) return;
    const datos = datosEvento(evento, ahora);
    tx.set(vinculo, datos);
    tx.set(registro, datos);
  });
}

async function registrarCompraPagada(db, session, fechaConfirmacion) {
  const destinoSlug = session.metadata?.slug;
  const montoCentavos = session.amount_total;
  if (session.metadata?.tipo !== 'curso' || session.payment_status !== 'paid' ||
      !Number.isSafeInteger(montoCentavos) || montoCentavos <= 0 ||
      typeof session.id !== 'string' || !SESION_STRIPE.test(session.id) ||
      !(await cursoMedido(db, destinoSlug))) return;
  const email = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase().slice(0, 320);
  if (!email) return;
  const nombre = String(session.customer_details?.name || '').trim().slice(0, 160);
  const moneda = /^[a-z]{3}$/i.test(session.currency || '') ? session.currency.toLowerCase() : 'mxn';
  const ahora = fechaConfirmacion instanceof Date && !Number.isNaN(fechaConfirmacion.getTime()) ? fechaConfirmacion : new Date();
  const vinculo = checkoutVinculo(db, session.id);
  const registro = db.collection('promocionesComprasRegistradas').doc(vinculo.id);

  await db.runTransaction(async tx => {
    const [vinculoSnap, registrado] = await Promise.all([tx.get(vinculo), tx.get(registro)]);
    if (registrado.exists) return;
    const checkout = vinculoSnap.data();
    const conVisita = checkout?.destinoSlug === destinoSlug;
    const promoHistorica = OFERTAS_PROMOCIONALES.some(p =>
      p.origenSlug === session.metadata?.promoOrigenSlug && p.destinoSlug === destinoSlug);
    const origenSlug = conVisita ? checkout.origenSlug : promoHistorica ? session.metadata.promoOrigenSlug : SIN_ATRIBUCION;
    const verificado = conVisita && checkout.identidad === 'cuenta_verificada' && checkout.email === email;
    const uid = verificado ? checkout.uid : 'compra:' + createHash('sha256').update(email).digest('hex').slice(0, 24);
    const evento = {
      tipo: 'compra_pagada', eventoId: session.id, claveRegistro: 'pago_stripe', origenSlug, destinoSlug, uid, email,
      nombre: nombre || (verificado ? checkout.nombre : ''),
      anonimo: false,
      identidad: verificado ? 'cuenta_verificada' : 'comprador_stripe',
      dispositivo: conVisita ? checkout.dispositivo : 'desconocido',
      checkoutRef: conVisita ? vinculo.id : null
    };
    tx.set(registro, { fechaEn: ahora.toISOString() });
    tx.set(referenciaEvento(db, evento), {
      ...datosEvento(evento, ahora), montoCentavos, moneda,
      atribucion: conVisita ? 'checkout' : promoHistorica ? 'promocion_stripe' : SIN_ATRIBUCION
    });
  });
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
        ...datosEvento({ ...datosInicio, tipo: evento.tipo }, ahora),
        fechaEn: datosInicio.fechaEn,
        duracionSeg: duracion
      });
    }
  });
}

function contador() {
  return Object.fromEntries(TIPOS.map(tipo => [tipo, 0]));
}

function acumulador() {
  return Object.fromEntries(TIPOS.map(tipo => [tipo, {
    eventos: 0, personas: new Set(), anonimos: new Set(), verificados: new Set(), compradoresStripe: new Set(), duracionSeg: 0
  }]));
}

function acumular(resumen, evento) {
  const tipo = resumen[evento.tipo];
  tipo.eventos++;
  tipo.personas.add(evento.uid);
  if (evento.anonimo) tipo.anonimos.add(evento.uid);
  if (evento.identidad === 'cuenta_verificada') tipo.verificados.add(evento.uid);
  if (evento.identidad === 'comprador_stripe') tipo.compradoresStripe.add(evento.uid);
  tipo.duracionSeg += evento.duracionSeg || 0;
}

function serializar(resumen) {
  return Object.fromEntries(TIPOS.map(tipo => {
    const datos = resumen[tipo];
    return [tipo, {
      eventos: datos.eventos, personas: datos.personas.size, anonimos: datos.anonimos.size,
      identificados: datos.personas.size - datos.anonimos.size, duracionSeg: datos.duracionSeg,
      cuentasVerificadas: datos.verificados.size, compradoresStripe: datos.compradoresStripe.size
    }];
  }));
}

async function consultarMetricas(db, ofertas, opciones, dias, ahora = new Date()) {
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
    .map(ev => ({
      ...ev,
      dispositivo: normalizarDispositivo(ev.dispositivo),
      identidad: ev.identidad || (ev.anonimo ? 'visita_anonima' : 'cuenta_verificada')
    }))
    .sort((a, b) => b.fechaEn.localeCompare(a.fechaEn));
  const truncado = eventos.length > MAX_EVENTOS;
  const analizados = eventos.slice(0, MAX_EVENTOS);
  const porPersona = new Map();
  const porDia = new Map();
  const porTipo = acumulador();
  const porCurso = new Map([...new Set(ofertas.map(p => p.destinoSlug))].map(slug => [slug, acumulador()]));
  const dispositivos = new Map(DISPOSITIVOS.map(dispositivo => [dispositivo, acumulador()]));
  const porModoVideo = new Map(MODOS_VIDEO.map(modo => [modo, acumulador()]));
  const embudo = { checkout_creado: new Set(), checkout_montado: new Set(), compra_pagada: new Set() };

  for (let d = 0; d < dias; d++) {
    const fecha = inicio.toISOString().slice(0, 10);
    porDia.set(fecha, { fecha, ...contador(), duraciones: contador() });
    inicio.setUTCDate(inicio.getUTCDate() + 1);
  }

  for (const ev of analizados) {
    const duracion = ev.duracionSeg || 0;
    acumular(porTipo, ev);
    acumular(dispositivos.get(ev.dispositivo), ev);
    acumular(porCurso.get(ev.destinoSlug), ev);
    if (ev.checkoutRef && Object.hasOwn(embudo, ev.tipo)) embudo[ev.tipo].add(ev.checkoutRef);
    if (ev.tipo === 'video_reproducido' || ev.tipo === 'video_tiempo') {
      acumular(porModoVideo.get(ev.modo) || porModoVideo.get('desconocido'), ev);
    }
    const periodo = porDia.get(fechaLocal(new Date(ev.fechaEn)));
    if (periodo) {
      periodo[ev.tipo]++;
      periodo.duraciones[ev.tipo] += duracion;
    }
    if (!porPersona.has(ev.uid)) {
      porPersona.set(ev.uid, {
        uid: ev.uid, email: ev.email, nombre: ev.nombre, anonimo: ev.anonimo === true,
        identidad: ev.identidad, ultimoEn: ev.fechaEn, totales: contador(), duraciones: contador(), dispositivos: new Set()
      });
    }
    porPersona.get(ev.uid).totales[ev.tipo]++;
    porPersona.get(ev.uid).duraciones[ev.tipo] += duracion;
    porPersona.get(ev.uid).dispositivos.add(ev.dispositivo);
  }

  const vinculados = embudo.checkout_creado;
  const montados = [...embudo.checkout_montado].filter(id => vinculados.has(id));
  const pagados = [...embudo.compra_pagada].filter(id => vinculados.has(id));
  const montadosPagados = montados.filter(id => embudo.compra_pagada.has(id));
  return {
    dias,
    zonaHoraria: ZONA_HORARIA,
    truncado,
    detalleTruncado: analizados.length > MAX_DETALLE,
    personasTruncadas: porPersona.size > MAX_DETALLE,
    totales: serializar(porTipo),
    porCurso: [...porCurso].map(([slug, r]) => ({ slug, totales: serializar(r) })),
    dispositivos: [...dispositivos].map(([dispositivo, r]) => ({ dispositivo, totales: serializar(r) })),
    porModoVideo: [...porModoVideo].map(([modo, r]) => ({ modo, totales: serializar(r) })),
    embudo: {
      checkoutsConVinculo: vinculados.size,
      checkoutsMontados: montados.length,
      checkoutsPagados: pagados.length,
      checkoutsMontadosPagados: montadosPagados.length,
      checkoutsSinConfirmar: vinculados.size - pagados.length,
      checkoutsMontadosSinConfirmar: montados.length - montadosPagados.length
    },
    serie: [...porDia.values()],
    personas: [...porPersona.values()].slice(0, MAX_DETALLE).map(p => ({ ...p, dispositivos: [...p.dispositivos] })),
    eventos: analizados.slice(0, MAX_DETALLE).map(({ checkoutRef, ...evento }) => evento),
    ofertas: opciones
  };
}

function registrarMetricasPromocion(app, { db, tokenRequerido, adminRequerido, adminMetricasRequerido = adminRequerido, log }) {
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
      const evento = { ...identidad, origenSlug, destinoSlug, tipo, eventoId: idNormalizado, dispositivo: normalizarDispositivo(req.body.dispositivo) };
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
      const { destinoSlug, origenSlug = null, tipo, duracionSeg, modo, dispositivo } = req.body || {};
      const visitaId = normalizarVisitaId(req.body?.visitaId);
      const esCheckout = tipo === 'checkout_montado' || tipo === 'checkout_tiempo';
      const eventoId = req.body?.eventoId || (esCheckout ? req.body?.sessionId : null);
      const tipoInicio = Object.hasOwn(DURACIONES, tipo) ? DURACIONES[tipo] : null;
      if (!visitaId || !PUBLICOS.includes(tipo) ||
          typeof eventoId !== 'string' || !(esCheckout ? SESION_STRIPE : UUID).test(eventoId) ||
          (dispositivo !== undefined && !DISPOSITIVOS.includes(dispositivo)) ||
          (esCheckout && req.body.sessionId && req.body.sessionId !== eventoId) ||
          !(await atribucionValida(db, origenSlug, destinoSlug))) {
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
        claveRegistro: 'visita:' + visitaId, dispositivo,
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
          evento.identidad = original.identidad;
          evento.dispositivo = original.dispositivo;
          evento.checkoutRef = original.checkoutRef;
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
      const admin = await adminMetricasRequerido(req, res);
      if (!admin) return;
      const { dias: valorDias = '30', origenSlug, destinoSlug } = req.query;
      const dias = Number(valorDias);
      if (typeof valorDias !== 'string' || !/^\d{1,2}$/.test(valorDias) ||
          !Number.isInteger(dias) || dias < 1 || dias > 90) {
        return res.status(400).json({ error: 'Consulta entre 1 y 90 días' });
      }
      const opciones = await opcionesActividad(db);
      const ofertas = opciones.filter(oferta =>
        (origenSlug === undefined || (origenSlug === 'directo' ? null : origenSlug) === oferta.origenSlug) &&
        (destinoSlug === undefined || destinoSlug === oferta.destinoSlug)
      );
      if (!ofertas.length) return res.status(400).json({ error: 'Promoción inválida' });
      return res.json(await consultarMetricas(db, ofertas, opciones, dias));
    } catch (err) {
      log.error('Error al consultar métricas de promoción:', err.code || err.name);
      return res.status(500).json({ error: 'No pudimos consultar las métricas' });
    }
  });
}

async function dispositivoCheckout(db, sessionId, destinoSlug) {
  if (typeof sessionId !== 'string' || !SESION_STRIPE.test(sessionId)) return 'desconocido';
  const datos = (await checkoutVinculo(db, sessionId).get()).data();
  return datos?.destinoSlug === destinoSlug ? normalizarDispositivo(datos.dispositivo) : 'desconocido';
}

module.exports = {
  guardarEventoPromo, registrarMetricasPromocion, registrarCheckoutActividad, registrarCompraPagada,
  normalizarVisitaId, atribucionValida, dispositivoCheckout
};

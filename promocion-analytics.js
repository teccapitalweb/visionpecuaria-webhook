const { createHash } = require('node:crypto');
const { OFERTAS_PROMOCIONALES, verificarCompradorPromocion } = require('./promociones-cursos');

const TIPOS = ['enlace_abierto', 'video_reproducido', 'checkout_creado', 'checkout_montado'];
const ZONA_HORARIA = 'America/Mexico_City';
const MAX_EVENTOS = 5000;
const MAX_DETALLE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESION_STRIPE = /^cs_[a-zA-Z0-9_]{1,150}$/;
const calendario = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA, calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit'
});

function fechaLocal(date) {
  const partes = Object.fromEntries(calendario.formatToParts(date).map(p => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function coleccionEventos(db, origenSlug, destinoSlug) {
  return db.collection('promocionesCursosMetricas').doc(`${origenSlug}:${destinoSlug}`).collection('eventos');
}

function referenciaEvento(db, { origenSlug, destinoSlug, tipo, eventoId, uid }) {
  const id = createHash('sha256').update(JSON.stringify([tipo, uid, eventoId])).digest('hex');
  return coleccionEventos(db, origenSlug, destinoSlug).doc(id);
}

async function guardarEventoPromo(db, { origenSlug, destinoSlug, tipo, eventoId, uid, email, nombre }, ahora = new Date()) {
  const ref = referenciaEvento(db, { origenSlug, destinoSlug, tipo, eventoId, uid });
  try {
    await ref.create({ origenSlug, destinoSlug, tipo, uid, email, nombre: nombre || '', fechaEn: ahora.toISOString() });
  } catch (err) {
    if (err.code !== 6 && err.code !== 'already-exists') throw err;
    // Un reintento conserva la hora y la identidad originales.
  }
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
  const porTipo = Object.fromEntries(TIPOS.map(tipo => [tipo, { eventos: 0, personas: new Set() }]));

  for (let d = 0; d < dias; d++) {
    const fecha = inicio.toISOString().slice(0, 10);
    porDia.set(fecha, { fecha, ...contador() });
    inicio.setUTCDate(inicio.getUTCDate() + 1);
  }

  for (const ev of analizados) {
    const tipo = porTipo[ev.tipo];
    tipo.eventos++;
    tipo.personas.add(ev.uid);
    const periodo = porDia.get(fechaLocal(new Date(ev.fechaEn)));
    if (periodo) periodo[ev.tipo]++;
    if (!porPersona.has(ev.uid)) {
      porPersona.set(ev.uid, {
        uid: ev.uid, email: ev.email, nombre: ev.nombre, ultimoEn: ev.fechaEn, totales: contador()
      });
    }
    porPersona.get(ev.uid).totales[ev.tipo]++;
  }

  const totales = Object.fromEntries(TIPOS.map(tipo => [tipo, {
    eventos: porTipo[tipo].eventos, personas: porTipo[tipo].personas.size
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
    ofertas: OFERTAS_PROMOCIONALES
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
      const ofertas = OFERTAS_PROMOCIONALES.filter(oferta =>
        (origenSlug === undefined || origenSlug === oferta.origenSlug) &&
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

module.exports = { guardarEventoPromo, registrarMetricasPromocion };

'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const SEXAJE = 'sexaje-avicola';
const CURSOS_SEXAJE = new Set(['gallinas-de-postura', 'embutidos-artesanales']);
const VERSION_VENTANA = '2';
const VENTANA_SEG = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fechaValida(valor) {
  const ms = Date.parse(String(valor || ''));
  return Number.isFinite(ms) ? ms : null;
}

async function regaloVigente(db, slugCurso, fechaCompra = new Date().toISOString()) {
  if (!slugCurso) return null;
  const snap = await db.collection('cursosVenta').doc(slugCurso).get();
  if (!snap.exists) return null;
  const regla = (snap.data() || {}).regalo;
  if (!regla || !regla.slug) return null;
  const pago = fechaValida(fechaCompra);
  const desde = fechaValida(regla.desde);
  const hasta = regla.hasta ? fechaValida(regla.hasta) : null;
  if (pago === null || desde === null || pago < desde || (regla.hasta && (hasta === null || pago > hasta))) return null;
  return String(regla.slug);
}

function errorReserva(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function identificadorNavegador(id) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  return createHash('sha256').update(id.toLowerCase()).digest('hex');
}

function claveRegalo(secretoWebhook) {
  return typeof secretoWebhook === 'string' && secretoWebhook
    ? createHmac('sha256', secretoWebhook).update('visionpecuaria:reserva-regalo-sexaje:v2').digest()
    : null;
}

function firmaRegalo(clave, payload) {
  return createHmac('sha256', clave).update(payload).digest();
}

function ventanaValida(emitida, vence) {
  return Number.isSafeInteger(emitida) && emitida > 0 && Number.isSafeInteger(vence) && vence - emitida === VENTANA_SEG;
}

function referenciaReserva(db, cursoSlug, navegador) {
  const id = createHash('sha256').update(cursoSlug + ':' + navegador).digest('hex');
  return db.collection('reservasRegalosCurso').doc(id);
}

async function apartarRegalo(db, { cursoSlug, navegadorId, secretoWebhook, reclamar = false, ahora = new Date() }) {
  const navegador = identificadorNavegador(navegadorId);
  if (typeof cursoSlug !== 'string' || !CURSOS_SEXAJE.has(cursoSlug) || !navegador) {
    throw errorReserva(400, 'Curso o navegador inválido para esta oferta.');
  }
  const clave = claveRegalo(secretoWebhook);
  if (!clave) throw errorReserva(503, 'La oferta no está disponible en este momento.');
  if (await regaloVigente(db, cursoSlug, ahora.toISOString()) !== SEXAJE) {
    throw errorReserva(404, 'Este curso no tiene esta oferta en este momento.');
  }
  const ref = referenciaReserva(db, cursoSlug, navegador);
  const emitida = Math.floor(ahora.getTime() / 1000);
  const reserva = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const anterior = snap.data();
      if (!ventanaValida(anterior.emitida, anterior.vence)) throw errorReserva(503, 'No pudimos recuperar la oferta.');
      if (reclamar === true) {
        if (emitida < anterior.emitida || emitida >= anterior.vence) throw errorReserva(409, 'Ya terminó la hora para apartar el regalo.');
        if (anterior.reclamada !== true) {
          tx.set(ref, { reclamada: true }, { merge: true });
          return { ...anterior, reclamada: true };
        }
      }
      return anterior;
    }
    if (reclamar === true) throw errorReserva(409, 'Primero abre la oferta del curso de regalo.');
    const nueva = { emitida, vence: emitida + VENTANA_SEG };
    tx.set(ref, nueva);
    return nueva;
  });
  const cuerpoToken = Buffer.from(JSON.stringify({
    cursoSlug, cursoRegaloSlug: SEXAJE, navegador, emitida: reserva.emitida, vence: reserva.vence
  })).toString('base64url');
  return {
    token: cuerpoToken + '.' + firmaRegalo(clave, cuerpoToken).toString('base64url'),
    venceEn: new Date(reserva.vence * 1000).toISOString(),
    ahora: ahora.toISOString(),
    cursoRegaloSlug: SEXAJE,
    reclamada: reserva.reclamada === true
  };
}

function metadataDeReserva(reserva, ahora) {
  const metadata = { regaloVersion: VERSION_VENTANA };
  const ahoraSeg = ahora.getTime() / 1000;
  if (!reserva || !ventanaValida(reserva.emitida, reserva.vence) || !Number.isFinite(ahoraSeg) ||
      ahoraSeg < reserva.emitida || ahoraSeg >= reserva.vence) return { metadata };
  return {
    metadata: {
      ...metadata,
      regaloSlug: SEXAJE,
      regaloEmitidaEn: String(reserva.emitida),
      regaloVenceEn: String(reserva.vence)
    },
    reservado: { cursoRegaloSlug: SEXAJE, venceEn: new Date(reserva.vence * 1000).toISOString() }
  };
}

function metadataRegaloCheckout({ cursoSlug, navegadorId, token, secretoWebhook, ahora = new Date() }) {
  const base = { metadata: { regaloVersion: VERSION_VENTANA } };
  const navegador = identificadorNavegador(navegadorId);
  const clave = claveRegalo(secretoWebhook);
  if (!CURSOS_SEXAJE.has(cursoSlug) || !clave || !navegador || typeof token !== 'string' || token.length > 600 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return base;
  const [cuerpo, firma] = token.split('.');
  const esperada = firmaRegalo(clave, cuerpo);
  const enviada = Buffer.from(firma, 'base64url');
  if (esperada.length !== enviada.length || !timingSafeEqual(esperada, enviada)) return base;
  let reserva;
  try { reserva = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); }
  catch (_) { return base; }
  if (reserva?.cursoSlug !== cursoSlug || reserva.cursoRegaloSlug !== SEXAJE || reserva.navegador !== navegador) return base;
  return metadataDeReserva(reserva, ahora);
}

async function prepararRegaloCheckout(db, datos) {
  const { cursoSlug, navegadorId, ahora = new Date() } = datos;
  const regalo = metadataRegaloCheckout({ ...datos, ahora });
  if (regalo.reservado || !CURSOS_SEXAJE.has(cursoSlug)) return regalo;
  const navegador = identificadorNavegador(navegadorId);
  if (!navegador) return regalo;
  const snap = await referenciaReserva(db, cursoSlug, navegador).get();
  const reserva = snap.data();
  return reserva?.reclamada === true ? metadataDeReserva(reserva, ahora) : regalo;
}

async function regaloParaPago(db, session, fechaConfirmacion) {
  const meta = session?.metadata || {};
  if (meta.tipo !== 'curso' || typeof meta.slug !== 'string' || !meta.slug ||
      !['paid', 'no_payment_required'].includes(session.payment_status)) return null;
  const creada = Number(session.created);
  const fechaCreada = Number.isSafeInteger(creada) && creada > 0
    ? new Date(creada * 1000).toISOString()
    : new Date().toISOString();
  // El checkout nuevo siempre lleva la marca, aunque no tenga reserva. La ausencia
  // equivale al contrato previo para sesiones de Stripe creadas antes del cambio.
  if (!Object.hasOwn(meta, 'regaloVersion')) return regaloVigente(db, meta.slug, fechaCreada);
  if (meta.regaloVersion !== VERSION_VENTANA) return null;
  if (meta.regaloSlug !== SEXAJE) {
    const otroRegalo = await regaloVigente(db, meta.slug, fechaCreada);
    return otroRegalo === SEXAJE ? null : otroRegalo;
  }
  const emitida = Number(meta.regaloEmitidaEn);
  const vence = Number(meta.regaloVenceEn);
  const confirmada = fechaConfirmacion instanceof Date ? fechaConfirmacion.getTime() / 1000 : NaN;
  if (!CURSOS_SEXAJE.has(meta.slug) || !ventanaValida(emitida, vence) ||
      !Number.isSafeInteger(creada) || creada < emitida || creada >= vence ||
      !Number.isFinite(confirmada) || confirmada < creada || confirmada >= vence ||
      session.payment_status !== 'paid' || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0) return null;
  return SEXAJE;
}

async function aplicarRegalo(db, uid, compra, { email = '', nombre = '' } = {}) {
  const slug = String(compra && compra.regalo || '').trim();
  if (!uid || !slug) return { otorgado: false, slug: slug || null };
  const ref = db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug);
  const ahora = new Date().toISOString();
  const acceso = {
    slug,
    email: email || compra.email || '',
    nombre: nombre || compra.nombre || '',
    activo: true,
    estado: 'activo',
    fechaCompra: compra.fechaCompra || ahora,
    stripeSessionId: compra.sessionId || compra.stripeSessionId || null,
    origen: 'regalo',
    regaloDe: compra.slug || null,
    otorgadoEn: ahora
  };
  try { await ref.create(acceso); }
  catch (err) {
    if (err.code === 6 || err.code === 'already-exists') return { otorgado: false, yaTenia: true, slug };
    throw err;
  }
  return { otorgado: true, slug };
}

module.exports = { regaloVigente, aplicarRegalo, apartarRegalo, metadataRegaloCheckout, prepararRegaloCheckout, regaloParaPago };

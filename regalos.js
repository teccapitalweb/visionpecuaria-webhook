'use strict';

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

async function aplicarRegalo(db, uid, compra, { email = '', nombre = '' } = {}) {
  const slug = String(compra && compra.regalo || '').trim();
  if (!uid || !slug) return { otorgado: false, slug: slug || null };
  const ref = db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug);
  const previo = await ref.get();
  if (previo.exists) return { otorgado: false, yaTenia: true, slug };
  const ahora = new Date().toISOString();
  await ref.set({
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
  });
  return { otorgado: true, slug };
}

module.exports = { regaloVigente, aplicarRegalo };

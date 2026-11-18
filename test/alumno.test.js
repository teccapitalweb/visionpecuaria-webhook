// Pruebas funcionales del aula y del webhook con dobles en memoria.
// Ejecutar: npm test   (no requiere credenciales ni toca producción)
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const crypto = require('crypto');
const { FakeDB, fakeAuth, fakeStripe, fakeAdmin } = require('./fakes');

const PORT = 38000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const db = new FakeDB();
const sint = (e) => 'ipcil-' + crypto.createHash('sha256').update(e).digest('hex').substring(0, 24);

const users = {
  tGallinas:   { uid: 'u-gallinas', email: 'comprador@gmail.com', email_verified: true },
  tSinVerif:   { uid: 'u-sinverif', email: 'comprador@gmail.com', email_verified: false },
  tOtro:       { uid: 'u-otro', email: 'otro@gmail.com', email_verified: true },
  tEmbutidos:  { uid: 'u-emb', email: 'chef@gmail.com', email_verified: true },
  tVip:        { uid: 'u-vip', email: 'vip@gmail.com', email_verified: true },
  tVipCompra:  { uid: 'u-vipc', email: 'vipc@gmail.com', email_verified: true },
  tVencido:    { uid: 'u-venc', email: 'venc@gmail.com', email_verified: true },
  tRevocado:   { uid: 'u-rev', email: 'rev@gmail.com', email_verified: true },
  tDos:        { uid: 'u-dos', email: 'dos@gmail.com', email_verified: true },
  tAdmin:      { uid: 'u-admin', email: 'admin@visionpecuariamx.com', email_verified: true },
  tPend:       { uid: 'u-pend', email: 'oxxo@gmail.com', email_verified: true },
  tDestino:    { uid: 'u-dest', email: 'nuevo@gmail.com', email_verified: true }
};
const stripeSessions = {
  cs_pend: { id: 'cs_pend', payment_status: 'paid', metadata: { tipo: 'curso', slug: 'gallinas-de-postura' } },
  cs_hist: { id: 'cs_hist', payment_status: 'paid', created: 1750000000, amount_total: 42900, customer_email: 'viejo@hotmail.com',
             metadata: { tipo: 'curso', slug: 'gallinas-de-postura', nombre: 'Alumno Viejo' } }
};

// ─── Inyectar dobles antes de cargar server.js ──────────────────────────────
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') {
    const a = fakeAdmin(db);
    return {
      ...a,
      initializeApp() {},
      credential: { cert: () => ({}) },
      auth: () => fakeAuth(users)
    };
  }
  if (req === 'stripe') return () => fakeStripe(stripeSessions);
  return origLoad.call(this, req, ...rest);
};
process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.PORT = String(PORT);
const silenciar = ['log', 'warn', 'error'].map(k => [k, console[k]]);
silenciar.forEach(([k]) => { console[k] = () => {}; });
require('../server.js');

async function semilla() {
  const s = (p, v) => db.data.set(p, v);
  s('admins/u-admin', { rol: 'admin' });
  s('cursosVenta/gallinas-de-postura', {
    nombre: 'Manejo profesional de gallinas de postura', instructorNombre: 'MVZ Diego Arturo Gómez',
    clases: [
      { orden: 1, titulo: 'Módulo 1 · Fundamentos', duracionMin: 70, url: 'https://drive.google.com/file/d/AAA111/preview' },
      { orden: 2, titulo: 'Módulo 2 · Nutrición', duracionMin: 70, embedUrl: 'https://drive.google.com/file/d/BBB222/preview' },
      { orden: 3, titulo: 'Módulo 3 · Sanidad', duracionMin: 70, estado: 'pendiente' }
    ],
    recursosDescargables: [{ titulo: 'Manual de Manejo Avícola', tipo: 'pdf', url: 'https://drive.google.com/uc?export=download&id=MAN1' }],
    cupoLanzamientoTomados: 0
  });
  s('cursosVenta/embutidos-artesanales', {
    nombre: 'Embutidos artesanales y chorizos',
    clases: [{ orden: 1, titulo: 'Clase 1', storagePath: 'cursos/embutidos-artesanales/clase-01.mp4' }],
    recursosDescargables: [], cupoLanzamientoTomados: 0, precioNormalCentavos: 55000
  });
  // Compra histórica de Gallinas: checkout sin sesión → uid sintético
  s('comprasCurso/cs_gal', { sessionId: 'cs_gal', slug: 'gallinas-de-postura', uid: sint('comprador@gmail.com'), email: 'comprador@gmail.com', estado: 'confirmado', fechaCompra: '2026-09-10T00:00:00Z' });
  s(`accesosCurso/${sint('comprador@gmail.com')}/cursos/gallinas-de-postura`, { activo: true, slug: 'gallinas-de-postura' });
  // Embutidos con uid real (Google en checkout)
  s('accesosCurso/u-emb/cursos/embutidos-artesanales', { activo: true, slug: 'embutidos-artesanales', fechaCompra: '2026-08-01' });
  s('comprasCurso/cs_emb', { slug: 'embutidos-artesanales', uid: 'u-emb', email: 'chef@gmail.com', estado: 'confirmado' });
  // VIP sin compra
  s('miembros/u-vip', { estado: 'activo', plan: 'VIP Mensual' });
  // VIP con compra
  s('miembros/u-vipc', { estado: 'activo', plan: 'VIP Anual' });
  s('comprasCurso/cs_vipc', { slug: 'embutidos-artesanales', email: 'vipc@gmail.com', estado: 'confirmado' });
  // Membresía vencida con curso
  s('miembros/u-venc', { estado: 'inactivo', plan: 'VIP Mensual' });
  s('comprasCurso/cs_venc', { slug: 'gallinas-de-postura', email: 'venc@gmail.com', estado: 'confirmado' });
  // Acceso revocado
  s('accesosCurso/u-rev/cursos/gallinas-de-postura', { activo: false, revocado: true });
  s('comprasCurso/cs_rev', { slug: 'gallinas-de-postura', email: 'rev@gmail.com', estado: 'confirmado' });
  // Dos compras
  s('comprasCurso/cs_dos1', { slug: 'gallinas-de-postura', email: 'dos@gmail.com', estado: 'confirmado' });
  s('comprasCurso/cs_dos2', { slug: 'embutidos-artesanales', email: 'dos@gmail.com', estado: 'confirmado' });
  // Pago OXXO que ya se acreditó en Stripe pero el webhook no llegó
  s('comprasCurso/cs_pend', { sessionId: 'cs_pend', slug: 'gallinas-de-postura', email: 'oxxo@gmail.com', estado: 'pendiente' });
}

async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
const slugs = (r) => r.data.cursos.map(c => c.slug).sort();
async function webhook(evt) {
  const r = await fetch(BASE + '/stripe-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'x' }, body: JSON.stringify(evt) });
  return r.status;
}

test.before(async () => { await semilla(); await new Promise(r => setTimeout(r, 300)); });
test.after(() => { silenciar.forEach(([k, f]) => { console[k] = f; }); Module._load = origLoad; setImmediate(() => process.exit(0)); });

test('sin sesión → 401', async () => {
  assert.equal((await api('/alumno/estado')).status, 401);
  assert.equal((await api('/alumno/estado', { token: 'falso' })).status, 401);
});

test('compra histórica de Gallinas (uid sintético) se recupera con correo verificado', async () => {
  const r = await api('/alumno/estado', { token: 'tGallinas' });
  assert.equal(r.status, 200);
  assert.deepEqual(slugs(r), ['gallinas-de-postura']);
  assert.equal(r.data.elite.vigente, false);
  const acc = db._get('accesosCurso/u-gallinas/cursos/gallinas-de-postura');
  assert.equal(acc.activo, true);
  assert.equal(acc.origen, 'conciliacion-correo-verificado');
  // idempotente: segunda llamada no duplica ni cambia
  const r2 = await api('/alumno/estado', { token: 'tGallinas' });
  assert.deepEqual(slugs(r2), ['gallinas-de-postura']);
});

test('mismo correo SIN verificar no obtiene acceso', async () => {
  const r = await api('/alumno/estado', { token: 'tSinVerif' });
  assert.deepEqual(r.data.cursos, []);
  assert.equal(r.data.usuario.verificado, false);
  assert.equal(db._get('accesosCurso/u-sinverif/cursos/gallinas-de-postura'), undefined);
});

test('otro correo no ve nada ni recibe pistas de compras ajenas', async () => {
  const r = await api('/alumno/estado', { token: 'tOtro' });
  assert.deepEqual(r.data.cursos, []);
  assert.equal((await api('/alumno/curso/gallinas-de-postura', { token: 'tOtro' })).status, 403);
});

test('Embutidos no desbloquea Gallinas ni catálogo', async () => {
  const r = await api('/alumno/estado', { token: 'tEmbutidos' });
  assert.deepEqual(slugs(r), ['embutidos-artesanales']);
  assert.equal((await api('/alumno/curso/gallinas-de-postura', { token: 'tEmbutidos' })).status, 403);
});

test('VIP sin compra: membresía vigente, sin cursos individuales', async () => {
  const r = await api('/alumno/estado', { token: 'tVip' });
  assert.deepEqual(r.data.cursos, []);
  assert.equal(r.data.elite.vigente, true);
  assert.equal((await api('/alumno/curso/gallinas-de-postura', { token: 'tVip' })).status, 403);
});

test('VIP con compra individual conserva ambos derechos', async () => {
  const r = await api('/alumno/estado', { token: 'tVipCompra' });
  assert.deepEqual(slugs(r), ['embutidos-artesanales']);
  assert.equal(r.data.elite.vigente, true);
});

test('membresía vencida no quita el curso comprado', async () => {
  const r = await api('/alumno/estado', { token: 'tVencido' });
  assert.deepEqual(slugs(r), ['gallinas-de-postura']);
  assert.equal(r.data.elite.vigente, false);
});

test('acceso revocado por admin no se re-otorga por correo', async () => {
  const r = await api('/alumno/estado', { token: 'tRevocado' });
  assert.deepEqual(r.data.cursos, []);
  assert.equal((await api('/alumno/curso/gallinas-de-postura', { token: 'tRevocado' })).status, 403);
});

test('alumno con dos compras ve los dos cursos, progreso independiente', async () => {
  const r = await api('/alumno/estado', { token: 'tDos' });
  assert.deepEqual(slugs(r), ['embutidos-artesanales', 'gallinas-de-postura']);
  await api('/alumno/curso/gallinas-de-postura/progreso', { token: 'tDos', method: 'POST', body: { claseId: 'c1', segundos: 100, completada: true, clientTs: 1000 } });
  const g = await api('/alumno/curso/gallinas-de-postura', { token: 'tDos' });
  const e = await api('/alumno/curso/embutidos-artesanales', { token: 'tDos' });
  assert.equal(g.data.progreso.completadas, 1);
  assert.equal(e.data.progreso.completadas, 0);
});

test('pago pendiente acreditado en Stripe se confirma al entrar', async () => {
  const r = await api('/alumno/estado', { token: 'tPend' });
  assert.deepEqual(slugs(r), ['gallinas-de-postura']);
  assert.equal(db._get('comprasCurso/cs_pend').estado, 'confirmado');
});

test('detalle del curso no expone fuentes de video ni de materiales', async () => {
  const r = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  assert.equal(r.status, 200);
  const txt = JSON.stringify(r.data);
  assert.ok(!/preview|storagePath|embedUrl|export=download|"url":"https:\/\/drive/.test(txt), txt);
  assert.deepEqual(r.data.clases.map(c => c.estado), ['publicada', 'publicada', 'pendiente']);
  assert.equal(r.data.certificado.estado, 'pendiente');
});

test('video: publicada → iframe; pendiente → 409; Storage → URL firmada', async () => {
  const ok = await api('/alumno/curso/gallinas-de-postura/video', { token: 'tGallinas', method: 'POST', body: { claseId: 'c1' } });
  assert.equal(ok.data.tipo, 'iframe');
  assert.match(ok.data.url, /drive\.google\.com\/file\/d\/AAA111\/preview/);
  const pend = await api('/alumno/curso/gallinas-de-postura/video', { token: 'tGallinas', method: 'POST', body: { claseId: 'c3' } });
  assert.equal(pend.status, 409);
  const st = await api('/alumno/curso/embutidos-artesanales/video', { token: 'tEmbutidos', method: 'POST', body: { claseId: 'c1' } });
  assert.equal(st.data.tipo, 'video');
  assert.match(st.data.url, /signed\.example/);
  const no = await api('/alumno/curso/gallinas-de-postura/video', { token: 'tOtro', method: 'POST', body: { claseId: 'c1' } });
  assert.equal(no.status, 403);
});

test('material solo para quien tiene acceso', async () => {
  const ok = await api('/alumno/curso/gallinas-de-postura/material', { token: 'tGallinas', method: 'POST', body: { materialId: 'm1' } });
  assert.match(ok.data.url, /MAN1/);
  const no = await api('/alumno/curso/gallinas-de-postura/material', { token: 'tOtro', method: 'POST', body: { materialId: 'm1' } });
  assert.equal(no.status, 403);
});

test('progreso: no retrocede con sesiones viejas (otro dispositivo)', async () => {
  const p = (b) => api('/alumno/curso/gallinas-de-postura/progreso', { token: 'tGallinas', method: 'POST', body: b });
  await p({ claseId: 'c2', segundos: 600, completada: true, posicion: 600, clientTs: 5000 });
  const viejo = await p({ claseId: 'c1', segundos: 30, completada: false, posicion: 30, clientTs: 1000 }); // pestaña vieja
  assert.equal(viejo.data.progreso.ultimaClaseId, 'c2');
  const menos = await p({ claseId: 'c2', segundos: 10, completada: false, clientTs: 6000 });
  assert.equal(menos.data.progreso.clases.c2.completada, true);
  assert.equal(menos.data.progreso.clases.c2.segundos, 600);
  const noExiste = await p({ claseId: 'c99', segundos: 1 });
  assert.equal(noExiste.status, 404);
});

test('webhook: pago confirmado otorga acceso; reenvío del evento no duplica', async () => {
  const evt = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {
    id: 'cs_new', payment_status: 'paid', amount_total: 45000, currency: 'mxn', customer_email: 'nuevo@gmail.com',
    metadata: { tipo: 'curso', slug: 'embutidos-artesanales', uid: 'u-dest', nombre: 'Nuevo Alumno' } } } };
  assert.equal(await webhook(evt), 200);
  assert.equal(await webhook(evt), 200);
  assert.equal(await webhook({ ...evt, id: 'evt_1b' }), 200); // otro id, misma sesión
  assert.equal(db._get('accesosCurso/u-dest/cursos/embutidos-artesanales').activo, true);
  assert.equal(db.dump('pagos/').filter(p => p.stripeSessionId === 'cs_new').length, 1);
  assert.equal(db.dump('certificadosPendientes/').filter(p => p.stripeSessionId === 'cs_new').length, 1);
  assert.equal(db._get('cursosVenta/embutidos-artesanales').cupoLanzamientoTomados, 1);
});

test('webhook: pago pendiente (OXXO) no da acceso hasta async_payment_succeeded', async () => {
  const s = { id: 'cs_oxxo', payment_status: 'unpaid', customer_email: 'oxxo2@gmail.com', metadata: { tipo: 'curso', slug: 'gallinas-de-postura', uid: 'u-oxxo2', nombre: 'Oxxo' } };
  await webhook({ id: 'evt_2', type: 'checkout.session.completed', data: { object: s } });
  assert.equal(db._get('comprasCurso/cs_oxxo').estado, 'pendiente');
  assert.equal(db._get('accesosCurso/u-oxxo2/cursos/gallinas-de-postura'), undefined);
  await webhook({ id: 'evt_3', type: 'checkout.session.async_payment_succeeded', data: { object: { ...s, payment_status: 'paid' } } });
  assert.equal(db._get('comprasCurso/cs_oxxo').estado, 'confirmado');
  assert.equal(db._get('accesosCurso/u-oxxo2/cursos/gallinas-de-postura').activo, true);
});

test('webhook: pago fallido / sesión expirada no dan acceso', async () => {
  const s = { id: 'cs_fail', payment_status: 'unpaid', customer_email: 'f@gmail.com', metadata: { tipo: 'curso', slug: 'gallinas-de-postura', uid: 'u-f' } };
  await webhook({ id: 'evt_4', type: 'checkout.session.completed', data: { object: s } });
  await webhook({ id: 'evt_5', type: 'checkout.session.async_payment_failed', data: { object: s } });
  assert.equal(db._get('comprasCurso/cs_fail').estado, 'fallido');
  await webhook({ id: 'evt_6', type: 'checkout.session.expired', data: { object: { id: 'cs_exp', metadata: { tipo: 'curso' } } } });
  assert.equal(db._get('comprasCurso/cs_exp'), undefined);
  assert.equal(db._get('accesosCurso/u-f/cursos/gallinas-de-postura'), undefined);
});

test('admin: solo administradores; conciliación con bitácora e idempotente', async () => {
  assert.equal((await api('/admin/cursos/buscar?email=viejo@hotmail.com', { token: 'tGallinas' })).status, 403);
  const sinMotivo = await api('/admin/cursos/conciliar', { token: 'tAdmin', method: 'POST', body: { sessionId: 'cs_hist', emailDestino: 'nuevo@gmail.com' } });
  assert.equal(sinMotivo.status, 400);
  const body = { sessionId: 'cs_hist', emailDestino: 'nuevo@gmail.com', motivo: 'Pagó con hotmail, entra con gmail (comprobante Stripe)' };
  const r = await api('/admin/cursos/conciliar', { token: 'tAdmin', method: 'POST', body });
  assert.equal(r.status, 200);
  assert.equal(db._get('accesosCurso/u-dest/cursos/gallinas-de-postura').origen, 'conciliacion-admin');
  const r2 = await api('/admin/cursos/conciliar', { token: 'tAdmin', method: 'POST', body });
  assert.equal(r2.data.yaTenia, true);
  assert.equal(db.dump('auditoriaCursos/').length, 1);
  const fake = await api('/admin/cursos/conciliar', { token: 'tAdmin', method: 'POST', body: { ...body, sessionId: 'cs_inventado' } });
  assert.notEqual(fake.status, 200);
  const rev = await api('/admin/cursos/revocar', { token: 'tAdmin', method: 'POST', body: { uid: 'u-dest', slug: 'gallinas-de-postura', motivo: 'Contracargo confirmado' } });
  assert.equal(rev.status, 200);
  assert.equal(db.dump('auditoriaCursos/').length, 2);
  const busq = await api('/admin/cursos/buscar?email=comprador@gmail.com', { token: 'tAdmin' });
  assert.ok(busq.data.cuentas.some(c => c.sintetico));
});

test('checkout: "ya comprado" no devuelve el sessionId', async () => {
  const r = await api('/crear-checkout-curso', { method: 'POST', body: { slug: 'embutidos-artesanales', uid: 'u-emb', email: 'chef@gmail.com', nombre: 'Chef' } });
  assert.equal(r.data.yaComprado, true);
  assert.equal(r.data.sessionId, null);
});

// ─── Bunny + solicitudes de certificado ─────────────────────────────────────
const G1 = '573d362b-7d72-4292-a568-e60089854555';
const G2 = 'f7a42c9b-46c4-4296-8388-7951a3784d8d';

test('certificado: alumno con acceso solicita; datos inválidos → 400; sin acceso → 403', async () => {
  const mal = await api('/alumno/curso/gallinas-de-postura/certificado/solicitar', { token: 'tGallinas', method: 'POST', body: { nombreCompleto: 'Juan', whatsapp: '123', estado: '' } });
  assert.equal(mal.status, 400);
  const ok = await api('/alumno/curso/gallinas-de-postura/certificado/solicitar', { token: 'tGallinas', method: 'POST',
    body: { nombreCompleto: 'Juan Pérez López <b>', whatsapp: '238 123 4567', estado: 'Puebla', ciudad: 'Tehuacán', ocupacion: 'Productor' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.solicitud.estado, 'pendiente');
  const doc = db._get('solicitudesCertificado/u-gallinas_gallinas-de-postura');
  assert.equal(doc.nombreCompleto, 'Juan Pérez López b');
  assert.equal(doc.whatsapp, '2381234567');
  assert.equal(doc.estadoRep, 'Puebla');
  assert.equal(doc.slug, 'gallinas-de-postura');
  assert.ok(doc.fechaSolicitud);
  const det = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  assert.equal(det.data.solicitudCertificado.estado, 'pendiente');
  const no = await api('/alumno/curso/gallinas-de-postura/certificado/solicitar', { token: 'tOtro', method: 'POST', body: { nombreCompleto: 'Otro Señor', whatsapp: '2381234567', estado: 'Puebla' } });
  assert.equal(no.status, 403);
});

test('certificado: reenviar conserva la fecha original; admin lista y marca emitido; ya emitido → 409', async () => {
  const antes = db._get('solicitudesCertificado/u-gallinas_gallinas-de-postura').fechaSolicitud;
  await new Promise(r => setTimeout(r, 5));
  await api('/alumno/curso/gallinas-de-postura/certificado/solicitar', { token: 'tGallinas', method: 'POST', body: { nombreCompleto: 'Juan Pérez López', whatsapp: '2381234567', estado: 'Puebla' } });
  assert.equal(db._get('solicitudesCertificado/u-gallinas_gallinas-de-postura').fechaSolicitud, antes);
  const noAdmin = await api('/admin/certificados/solicitudes', { token: 'tGallinas' });
  assert.equal(noAdmin.status, 403);
  const lista = await api('/admin/certificados/solicitudes', { token: 'tAdmin' });
  assert.equal(lista.status, 200);
  const s = lista.data.solicitudes.find(x => x.id === 'u-gallinas_gallinas-de-postura');
  assert.equal(s.cursoNombre, 'Manejo profesional de gallinas de postura');
  const mal = await api('/admin/certificados/solicitudes/estado', { token: 'tAdmin', method: 'POST', body: { id: s.id, estado: 'aprobadisimo' } });
  assert.equal(mal.status, 400);
  const em = await api('/admin/certificados/solicitudes/estado', { token: 'tAdmin', method: 'POST', body: { id: s.id, estado: 'emitido', folio: 'VP-2026-0001' } });
  assert.equal(em.status, 200);
  assert.equal(db._get('solicitudesCertificado/u-gallinas_gallinas-de-postura').folio, 'VP-2026-0001');
  assert.ok(db.dump('auditoriaCursos').some(a => a.accion === 'solicitud-certificado'));
  const otra = await api('/alumno/curso/gallinas-de-postura/certificado/solicitar', { token: 'tGallinas', method: 'POST', body: { nombreCompleto: 'Juan Pérez López', whatsapp: '2381234567', estado: 'Puebla' } });
  assert.equal(otra.status, 409);
});

test('bunny: solo admin; valida biblioteca e IDs; conserva ids de clase y quita Drive', async () => {
  const noAdmin = await api('/admin/cursos/contenido-bunny', { token: 'tGallinas', method: 'POST', body: { slug: 'gallinas-de-postura', biblioteca: '123', videos: [] } });
  assert.equal(noAdmin.status, 403);
  const mala = await api('/admin/cursos/contenido-bunny', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', biblioteca: 'abc', videos: [] } });
  assert.equal(mala.status, 400);
  const malId = await api('/admin/cursos/contenido-bunny', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', biblioteca: '555', videos: [{ orden: 1, id: 'no-es-guid' }] } });
  assert.equal(malId.status, 400);
  const ok = await api('/admin/cursos/contenido-bunny', { token: 'tAdmin', method: 'POST', body: {
    slug: 'gallinas-de-postura', biblioteca: '555', cdn: 'vz-abc123.b-cdn.net',
    videos: [{ orden: 1, id: G1, duracionSeg: 3600 }, { orden: 3, id: G2 }] } });
  assert.equal(ok.status, 200);
  const priv = db._get('cursosContenidoPrivado/gallinas-de-postura');
  assert.equal(priv.proveedorVideo, 'bunny');
  assert.ok(!/drive\.google/.test(JSON.stringify(priv.clases)));
  assert.deepEqual(priv.clases.map(c => c.id), ['c1', 'c2', 'c3']);
  assert.equal(priv.clases[1].estado, 'pendiente');       // sin video → pendiente
  assert.ok(!priv.clases[2].estado);                        // la 3 tenía video nuevo → publicada
  assert.equal(priv.clases[0].duracionMin, 60);
  // público intacto
  assert.match(JSON.stringify(db._get('cursosVenta/gallinas-de-postura').clases), /AAA111/);
});

test('bunny: el alumno recibe el reproductor de Bunny y miniatura del CDN; sin fuentes en el listado', async () => {
  const det = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  assert.deepEqual(det.data.clases.map(c => c.estado), ['publicada', 'pendiente', 'publicada']);
  assert.equal(det.data.clases[0].miniatura, `https://vz-abc123.b-cdn.net/${G1}/thumbnail.jpg`);
  assert.ok(!/mediadelivery|"bunny"/.test(JSON.stringify(det.data)));
  const v = await api('/alumno/curso/gallinas-de-postura/video', { token: 'tGallinas', method: 'POST', body: { claseId: 'c1' } });
  assert.equal(v.data.tipo, 'iframe');
  assert.equal(v.data.proveedor, 'bunny');
  assert.ok(v.data.url.startsWith(`https://iframe.mediadelivery.net/embed/555/${G1}?`));
  const no = await api('/alumno/curso/gallinas-de-postura/video', { token: 'tOtro', method: 'POST', body: { claseId: 'c1' } });
  assert.equal(no.status, 403);
});

test('bunny: firma del reproductor cuando hay llave (sha256 de llave+id+expira)', () => {
  const { urlBunny, bunnyDe } = require('../alumno')._internos;
  const b = bunnyDe({ bunny: { biblioteca: '555', id: G1 } });
  const url = urlBunny(b, 'llave-secreta', 1_800_000_000_000, 3600);
  const exp = 1_800_000_000 + 3600;
  const tok = crypto.createHash('sha256').update('llave-secreta' + G1 + exp).digest('hex');
  assert.ok(url.includes(`token=${tok}`) && url.includes(`expires=${exp}`));
  assert.ok(!urlBunny(b, '').includes('token='));
  assert.equal(bunnyDe({ bunny: { biblioteca: '555', id: 'x' } }), null);
});

test('calificación: alumno con acceso califica 1–5; promedio y la suya en el detalle; sin acceso → 403', async () => {
  const mal = await api('/alumno/curso/embutidos-artesanales/calificacion', { token: 'tEmbutidos', method: 'POST', body: { estrellas: 7 } });
  assert.equal(mal.status, 400);
  const a = await api('/alumno/curso/embutidos-artesanales/calificacion', { token: 'tEmbutidos', method: 'POST', body: { estrellas: 5, comentario: 'Muy bueno <b>' } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data.calificaciones, { promedio: 5, total: 1, mia: { estrellas: 5, comentario: 'Muy bueno b' } });
  const b = await api('/alumno/curso/embutidos-artesanales/calificacion', { token: 'tDos', method: 'POST', body: { estrellas: 4 } });
  assert.equal(b.data.calificaciones.promedio, 4.5);
  const otra = await api('/alumno/curso/embutidos-artesanales/calificacion', { token: 'tEmbutidos', method: 'POST', body: { estrellas: 3 } });
  assert.equal(otra.data.calificaciones.total, 2);
  assert.equal(otra.data.calificaciones.promedio, 3.5);
  const det = await api('/alumno/curso/embutidos-artesanales', { token: 'tEmbutidos' });
  assert.equal(det.data.calificaciones.mia.estrellas, 3);
  assert.equal(det.data.calificaciones.promedio, 3.5);
  const no = await api('/alumno/curso/embutidos-artesanales/calificacion', { token: 'tOtro', method: 'POST', body: { estrellas: 5 } });
  assert.equal(no.status, 403);
  const adm = await api('/admin/cursos/calificaciones', { token: 'tAdmin' });
  assert.equal(adm.data.calificaciones.length, 2);
  assert.equal((await api('/admin/cursos/calificaciones', { token: 'tEmbutidos' })).status, 403);
});

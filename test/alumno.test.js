// Pruebas funcionales del aula y del webhook con dobles en memoria.
// Ejecutar: npm test   (no requiere credenciales ni toca producción)
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const crypto = require('crypto');
const { FakeDB, fakeAuth, fakeStripe, fakeAdmin } = require('./fakes');
const { nuevaClaveEntrada, uidDePago } = require('../entrada-checkout');
const { apartarRegalo, metadataRegaloCheckout } = require('../regalos');

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
  tAdminClub:  { uid: 'u-admin-club', email: 'club@example.org', email_verified: true, admin: true },
  tAdminClubRevocado: { uid: 'u-admin-club-revocado', admin: true, tokenRevocado: true },
  tPend:       { uid: 'u-pend', email: 'oxxo@gmail.com', email_verified: true },
  tDestino:    { uid: 'u-dest', email: 'nuevo@gmail.com', email_verified: true }
};
const stripeSessions = {
  cs_pend: { id: 'cs_pend', payment_status: 'paid', metadata: { tipo: 'curso', slug: 'gallinas-de-postura' } },
  cs_nuevo: { id: 'cs_nuevo', payment_status: 'paid', created: Math.floor(Date.now() / 1000) - 30, amount_total: 55000, metadata: { tipo: 'curso', slug: 'embutidos-artesanales' }, customer_details: { email: 'Recien@Gmail.com', name: 'Rita Nueva' } },
  cs_viejo_pago: { id: 'cs_viejo_pago', payment_status: 'paid', created: Math.floor(Date.now() / 1000) - 7200, metadata: { tipo: 'curso', slug: 'embutidos-artesanales' }, customer_details: { email: 'tarde@gmail.com' } },
  cs_sin_pagar: { id: 'cs_sin_pagar', payment_status: 'unpaid', created: Math.floor(Date.now() / 1000), metadata: { tipo: 'curso', slug: 'embutidos-artesanales' }, customer_details: { email: 'x@gmail.com' } },
  cs_de_otro: { id: 'cs_de_otro', payment_status: 'paid', created: Math.floor(Date.now() / 1000), metadata: { tipo: 'curso', slug: 'embutidos-artesanales' }, customer_details: { email: 'comprador@gmail.com' } },
  cs_membresia: { id: 'cs_membresia', payment_status: 'paid', created: Math.floor(Date.now() / 1000), metadata: { tipo: 'membresia' }, customer_details: { email: 'm@gmail.com' } },
  cs_hist: { id: 'cs_hist', payment_status: 'paid', created: 1750000000, amount_total: 42900, customer_email: 'viejo@hotmail.com',
             metadata: { tipo: 'curso', slug: 'gallinas-de-postura', nombre: 'Alumno Viejo' } }
};
const stripeMock = fakeStripe(stripeSessions);

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
  if (req === 'stripe') return () => stripeMock;
  return origLoad.call(this, req, ...rest);
};
process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_prueba_local_sin_stripe';
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
    cupoLanzamientoTomados: 0, precioNormalCentavos: 105000, precioLanzamientoCentavos: 55000
  });
  s('cursosVenta/embutidos-artesanales', {
    nombre: 'Embutidos artesanales y chorizos',
    clases: [{ orden: 1, titulo: 'Clase 1', storagePath: 'cursos/embutidos-artesanales/clase-01.mp4' }],
    recursosDescargables: [], cupoLanzamientoTomados: 0, precioNormalCentavos: 105000, precioLanzamientoCentavos: 55000
  });
  // Compra histórica de Gallinas: checkout sin sesión → uid sintético
  s('comprasCurso/cs_gal', { sessionId: 'cs_gal', slug: 'gallinas-de-postura', uid: sint('comprador@gmail.com'), email: 'comprador@gmail.com', estado: 'confirmado', fechaCompra: '2026-09-10T00:00:00Z', montoPagadoCentavos: 45000 });
  s(`accesosCurso/${sint('comprador@gmail.com')}/cursos/gallinas-de-postura`, { activo: true, slug: 'gallinas-de-postura' });
  // Embutidos con uid real (Google en checkout)
  s('accesosCurso/u-emb/cursos/embutidos-artesanales', { activo: true, slug: 'embutidos-artesanales', fechaCompra: '2026-08-01' });
  s('comprasCurso/cs_emb', { slug: 'embutidos-artesanales', uid: 'u-emb', email: 'chef@gmail.com', estado: 'confirmado', montoPagadoCentavos: 55000 });
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
  s('comprasCurso/cs_rev', { slug: 'gallinas-de-postura', email: 'rev@gmail.com', estado: 'confirmado', montoPagadoCentavos: 45000 });
  // Dos compras
  s('comprasCurso/cs_dos1', { slug: 'gallinas-de-postura', email: 'dos@gmail.com', estado: 'confirmado', montoPagadoCentavos: 45000 });
  s('comprasCurso/cs_dos2', { slug: 'embutidos-artesanales', email: 'dos@gmail.com', estado: 'confirmado', montoPagadoCentavos: 55000 });
  // Pago OXXO que ya se acreditó en Stripe pero el webhook no llegó
  s('comprasCurso/cs_pend', { sessionId: 'cs_pend', slug: 'gallinas-de-postura', email: 'oxxo@gmail.com', estado: 'pendiente' });
}

async function api(path, { token, method = 'GET', body, origin } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(origin ? { Origin: origin } : {})
    },
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

test('Mi Gallo IA requiere sesión y acceso al curso desde el que se abre', async () => {
  const chat = (token, mensaje = '¿Cómo veo los materiales?') => api('/alumno/gallo-ia', {
    token,
    method: 'POST',
    body: { cursoSlug: 'gallinas-de-postura', mensaje }
  });
  assert.equal((await chat()).status, 401);
  assert.equal((await chat('tOtro')).status, 403);
  assert.equal((await chat('tRevocado')).status, 403);
  assert.equal((await chat('tGallinas', ' '.repeat(1001))).status, 400);
  const r = await chat('tGallinas');
  assert.equal(r.status, 200);
  assert.equal(r.data.modo, 'guia');
  assert.match(r.data.respuesta, /Materiales dentro de tu curso/);
});

test('Mi Gallo IA usa títulos y conteos reales del aula solamente si se tiene acceso', async () => {
  const privado = 'cursosContenidoPrivado/embutidos-artesanales';
  const original = db._get(privado);
  const titulo = 'Especias y el arte del adobo tradicional';
  db.data.set(privado, { clases: [
    { orden: 3, titulo: 'Material reservado de clase tres', storagePath: 'privado.mp4' },
    { orden: 1, titulo, storagePath: 'privado.mp4' },
    { orden: 2, titulo: 'Preparaciones del curso', storagePath: 'privado.mp4' },
    { orden: 4, titulo: 'Manejo y conservación', storagePath: 'privado.mp4' },
    { orden: 5, titulo: 'Cierre y revisión', estado: 'pendiente' }
  ] });
  const chat = (token, cursoSlug, mensaje) => api('/alumno/gallo-ia', {
    token,
    method: 'POST',
    body: { cursoSlug, mensaje }
  });
  try {
    const propio = await chat('tEmbutidos', 'embutidos-artesanales', '¿Cuál es la primera clase?');
    assert.equal(propio.status, 200);
    assert.match(propio.data.respuesta, new RegExp(`Clase 1 · ${titulo}`));
    assert.doesNotMatch(propio.data.respuesta, /privado\.mp4/);
    const contar = await chat('tEmbutidos', 'embutidos-artesanales', '¿Cuántas clases hay?');
    assert.match(contar.data.respuesta, /5 clases.*4 grabaciones publicadas y 1 pendiente/);
    const listar = await chat('tEmbutidos', 'embutidos-artesanales', '¿Qué clases hay?');
    assert.match(listar.data.respuesta, /Clase 5 · Cierre y revisión \(grabación pendiente\)/);
    assert.doesNotMatch(listar.data.respuesta, /Clase 6/);
    const buscar = await chat('tEmbutidos', 'embutidos-artesanales', '¿En qué clase explican el adobo?');
    assert.match(buscar.data.respuesta, new RegExp(titulo));

    const conAcceso = await chat('tDos', 'gallinas-de-postura', '¿Cuál es la clase 1 de Embutidos?');
    assert.match(conAcceso.data.respuesta, new RegExp(titulo));
    const ajeno = await chat('tGallinas', 'gallinas-de-postura', '¿Qué clases tiene Embutidos?');
    assert.equal(ajeno.status, 200);
    assert.match(ajeno.data.respuesta, /temario público/);
    assert.doesNotMatch(ajeno.data.respuesta, /arte del adobo|reservado|privado\.mp4/);
  } finally {
    if (original) db.data.set(privado, original);
    else db.data.delete(privado);
  }
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

test('la promoción valida un pago de Gallinas y descuenta 100 MXN al precio vigente de Embutidos', async () => {
  const origenSlug = 'gallinas-de-postura', destinoSlug = 'embutidos-artesanales';
  const cotizacion = `/alumno/promociones/cotizacion?origenSlug=${origenSlug}&destinoSlug=${destinoSlug}`;
  const oferta = await api(cotizacion, { token: 'tGallinas' });
  assert.equal(oferta.status, 200);
  assert.equal(oferta.data.moneda, 'mxn');
  assert.equal(oferta.data.precioBaseCentavos, 55000);
  assert.equal(oferta.data.montoCentavos, 45000);
  assert.equal(oferta.data.descuentoCentavos, 10000);

  const compra = await api('/crear-checkout-curso', {
    method: 'POST', token: 'tGallinas', body: { origenSlug, slug: destinoSlug, uid: 'u-otro', email: 'otro@gmail.com', montoCentavos: 1 }
  });
  assert.equal(compra.status, 200);
  assert.deepEqual(compra.data.oferta, oferta.data);
  const cliente = stripeMock.clientesCreados.at(-1);
  const stripe = stripeMock.checkoutCreados.at(-1);
  assert.equal(cliente.email, users.tGallinas.email);
  assert.equal(cliente.metadata.uid, users.tGallinas.uid);
  assert.match(stripe.customer, /^cus_test_promo_/);
  assert.equal(stripe.customer_email, undefined);
  assert.equal(stripe.metadata.uid, users.tGallinas.uid);
  assert.equal(stripe.metadata.email, users.tGallinas.email);
  assert.equal(stripe.metadata.promoOrigenSlug, origenSlug);
  assert.equal(stripe.allow_promotion_codes, false);
  assert.equal(stripe.line_items[0].price_data.unit_amount, 45000);

  const normal = await api('/crear-checkout-curso', { method: 'POST', body: { slug: destinoSlug } });
  assert.equal(normal.status, 200);
  assert.equal(normal.data.oferta, undefined);
  assert.equal(stripeMock.checkoutCreados.at(-1).allow_promotion_codes, true);
  assert.equal(stripeMock.checkoutCreados.at(-1).line_items[0].price_data.unit_amount, 55000);
});

test('la promoción rechaza enlaces sin sesión, gratuitos, revocados o con destino ya adquirido', async () => {
  const path = '/alumno/promociones/cotizacion?origenSlug=gallinas-de-postura&destinoSlug=embutidos-artesanales';
  const n = stripeMock.checkoutCreados.length;
  assert.equal((await api(path)).status, 401);
  assert.equal((await api(path, { token: 'tSinVerif' })).status, 403);
  assert.equal((await api(path, { token: 'tVencido' })).status, 403);
  assert.equal((await api(path, { token: 'tRevocado' })).status, 403);
  assert.equal((await api(path.replace('gallinas-de-postura', 'sexaje-avicola'), { token: 'tGallinas' })).status, 404);
  const adquirida = await api(path, { token: 'tDos' });
  assert.equal(adquirida.status, 409);
  assert.equal(adquirida.data.codigo, 'curso_adquirido');
  const checkout = await api('/crear-checkout-curso', {
    method: 'POST', token: 'tOtro', body: { origenSlug: 'gallinas-de-postura', slug: 'embutidos-artesanales', uid: 'u-gallinas', email: 'comprador@gmail.com' }
  });
  assert.equal(checkout.status, 403);
  assert.equal(stripeMock.checkoutCreados.length, n);
});

test('actividad pública enlaza Stripe a la visita, anonimiza y deduplica tiempos medidos', async () => {
  const slug = 'embutidos-artesanales';
  const visitaId = crypto.randomUUID();
  const pago = await api('/crear-checkout-curso', {
    method: 'POST', body: { slug, visitaId, uid: 'u-otro', email: 'atribuido-falso@example.org' }
  });
  assert.equal(pago.status, 200);
  const enviar = (tipo, eventoId, extras = {}, token) => api('/publico/cursos/actividad', {
    method: 'POST', token, body: { destinoSlug: slug, visitaId, tipo, eventoId, ...extras }
  });
  const sessionId = pago.data.sessionId;
  assert.equal((await enviar('checkout_montado', sessionId, { visitaId: crypto.randomUUID() })).status, 404);
  assert.equal((await enviar('checkout_montado', sessionId, { origenSlug: 'gallinas-de-postura' })).status, 404);
  assert.equal((await enviar('checkout_tiempo', sessionId, { duracionSeg: 4 })).status, 404);
  assert.equal((await enviar('checkout_montado', sessionId, { sessionId }, 'tGallinas')).status, 204);
  assert.equal((await enviar('checkout_tiempo', sessionId, { duracionSeg: 4 })).status, 204);
  assert.equal((await enviar('checkout_tiempo', sessionId, { duracionSeg: 2 })).status, 204);
  assert.equal((await enviar('checkout_tiempo', sessionId, { duracionSeg: 4 })).status, 204);

  const enlaceId = crypto.randomUUID();
  assert.equal((await enviar('enlace_tiempo', enlaceId, { duracionSeg: 2 })).status, 404);
  assert.equal((await enviar('enlace_abierto', enlaceId)).status, 204);
  assert.equal((await enviar('enlace_tiempo', enlaceId, { duracionSeg: 3 })).status, 204);
  assert.equal((await enviar('enlace_tiempo', enlaceId, { duracionSeg: 1 })).status, 204);

  const videoId = crypto.randomUUID();
  assert.equal((await enviar('video_reproducido', videoId, { modo: 'automatico', email: 'falso@example.org' }, 'tSinVerif')).status, 204);
  assert.equal((await enviar('video_tiempo', videoId, { duracionSeg: 6 * 3600 + 1 })).status, 400);
  assert.equal((await enviar('video_tiempo', videoId, { duracionSeg: 3 }, 'tGallinas')).status, 204);
  const pagoId = crypto.randomUUID();
  assert.equal((await enviar('ya_pague', pagoId, {}, 'tGallinas')).status, 204);
  assert.equal((await enviar('ya_pague_tiempo', pagoId, { duracionSeg: 2 }, 'tGallinas')).status, 204);
  const metricas = '/admin/cursos/promociones/metricas?origenSlug=directo&destinoSlug=' + slug;
  const respuesta = await api(metricas, { token: 'tAdmin' });
  assert.equal(respuesta.status, 200);
  const { totales, personas, eventos } = respuesta.data;
  assert.equal(totales.enlace_tiempo.eventos, 1);
  assert.equal(totales.enlace_tiempo.duracionSeg, 3);
  assert.equal(totales.checkout_tiempo.eventos, 1);
  assert.equal(totales.checkout_tiempo.duracionSeg, 4);
  assert.equal(totales.checkout_montado.anonimos, 1);
  assert.equal(totales.video_reproducido.anonimos, 1);
  assert.equal(totales.video_tiempo.duracionSeg, 3);
  assert.equal(totales.ya_pague_tiempo.identificados, 1);
  assert.equal(totales.ya_pague_tiempo.duracionSeg, 2);
  assert.ok(personas.some(persona => persona.anonimo && persona.email === null));
  assert.ok(personas.some(persona => persona.email === users.tGallinas.email));
  assert.equal(eventos.find(ev => ev.tipo === 'video_reproducido').modo, 'automatico');
  assert.doesNotMatch(JSON.stringify(respuesta.data), /falso@example\.org/);
  assert.ok(!JSON.stringify(respuesta.data).includes(visitaId));
});

test('la atribución inversa sin solicitar descuento conserva el precio vigente, con compras privadas', async () => {
  const destinoSlug = 'gallinas-de-postura', origenSlug = 'embutidos-artesanales';
  const visitaId = crypto.randomUUID();
  const pago = await api('/crear-checkout-curso', {
    method: 'POST', body: { slug: destinoSlug, visitaId, atribucionOrigen: origenSlug }
  });
  assert.equal(pago.status, 200);
  assert.equal(pago.data.oferta, undefined);
  assert.equal(stripeMock.checkoutCreados.at(-1).line_items[0].price_data.unit_amount, 55000);
  const mount = await api('/publico/cursos/actividad', {
    method: 'POST', body: { destinoSlug, origenSlug, visitaId, tipo: 'checkout_montado', sessionId: pago.data.sessionId }
  });
  assert.equal(mount.status, 204);
  const path = '/admin/cursos/compras?slug=' + destinoSlug;
  assert.equal((await api(path, { token: 'tGallinas' })).status, 403);
  const lista = await api(path, { token: 'tAdmin' });
  assert.equal(lista.status, 200);
  assert.ok(lista.data.compras.every(c => c.slug === destinoSlug));
  assert.equal(lista.data.compras.find(c => c.sessionId === 'cs_gal').acceso.activo, true);
  const resumen = await api(`/admin/cursos/promociones/metricas?origenSlug=${origenSlug}&destinoSlug=${destinoSlug}`, { token: 'tAdmin' });
  assert.equal(resumen.data.totales.checkout_creado.eventos, 1);
  assert.equal(resumen.data.totales.checkout_montado.eventos, 1);
});

test('el comprador de Embutidos obtiene $100 MXN para Gallinas, fijados por Stripe sin duplicar atribución', async () => {
  const origenSlug = 'embutidos-artesanales', destinoSlug = 'gallinas-de-postura';
  const query = '?origenSlug=' + origenSlug + '&destinoSlug=' + destinoSlug;
  const cotizacion = '/alumno/promociones/cotizacion' + query;
  const metricas = '/admin/cursos/promociones/metricas' + query;
  const antes = (await api(metricas, { token: 'tAdmin' })).data.totales.checkout_creado.eventos;
  const oferta = await api(cotizacion, { token: 'tEmbutidos' });
  assert.equal(oferta.status, 200);
  assert.equal(oferta.data.precioBaseCentavos, 55000);
  assert.equal(oferta.data.descuentoCentavos, 10000);
  assert.equal(oferta.data.montoCentavos, 45000);
  assert.equal(oferta.data.moneda, 'mxn');
  assert.match(oferta.data.origenNombre, /Embutidos/);
  assert.match(oferta.data.destinoNombre, /gallinas/i);
  assert.equal((await api(cotizacion, { token: 'tVipCompra' })).status, 403);
  const previo = await api(cotizacion, { token: 'tDos' });
  assert.equal(previo.status, 409);
  assert.equal(previo.data.codigo, 'curso_adquirido');

  const pago = await api('/crear-checkout-curso', {
    method: 'POST', token: 'tEmbutidos',
    body: { origenSlug, slug: destinoSlug, visitaId: crypto.randomUUID(), uid: 'otro', email: 'otro@example.org', montoCentavos: 1 }
  });
  assert.equal(pago.status, 200);
  assert.deepEqual(pago.data.oferta, oferta.data);
  const cliente = stripeMock.clientesCreados.at(-1);
  const stripe = stripeMock.checkoutCreados.at(-1);
  assert.equal(cliente.email, users.tEmbutidos.email);
  assert.equal(stripe.metadata.uid, users.tEmbutidos.uid);
  assert.equal(stripe.metadata.promoOrigenSlug, origenSlug);
  assert.equal(stripe.metadata.promoDescuentoCentavos, '10000');
  assert.equal(stripe.line_items[0].price_data.unit_amount, 45000);
  assert.equal(stripe.allow_promotion_codes, false);

  const despues = (await api(metricas, { token: 'tAdmin' })).data;
  assert.equal(despues.totales.checkout_creado.eventos, antes + 1);
  assert.equal(despues.ofertas.filter(p => p.origenSlug === origenSlug && p.destinoSlug === destinoSlug).length, 1);
});

test('visitas y dispositivos comparan cursos sin duplicar recargas del mismo evento', async () => {
  await db.collection('cursosVenta').doc('curso-nuevo').set({ medirActividad: true, ventaDirecta: true });
  await db.collection('cursosVenta').doc('sexaje-avicola').set({ medirActividad: true, ventaDirecta: true }, { merge: true });
  const visitaId = crypto.randomUUID();
  const origenSlug = 'embutidos-artesanales';
  const destinoSlug = 'gallinas-de-postura';
  const evento = { visitaId, origenSlug, destinoSlug, eventoId: crypto.randomUUID(), dispositivo: 'telefono' };
  const guardar = (body, token) => api('/publico/cursos/actividad', { method: 'POST', body, token });
  assert.equal((await guardar({ ...evento, tipo: 'pagina_visitada' })).status, 204);
  assert.equal((await guardar({ ...evento, tipo: 'pagina_visitada', eventoId: crypto.randomUUID() })).status, 204);
  assert.equal((await guardar({ ...evento, tipo: 'pagina_tiempo', dispositivo: 'tableta', duracionSeg: 4 })).status, 204);
  assert.equal((await guardar({ ...evento, tipo: 'pagina_visitada', dispositivo: 'Firefox' })).status, 400);
  assert.equal((await guardar({ ...evento, destinoSlug: 'sexaje-avicola', origenSlug: null, tipo: 'pagina_visitada' })).status, 400);
  assert.equal((await guardar({ ...evento, destinoSlug: 'curso-nuevo', origenSlug: null, tipo: 'pagina_visitada', dispositivo: 'computadora' }, 'tGallinas')).status, 204);

  const path = '/admin/cursos/promociones/metricas?dias=7';
  assert.equal((await api(path, { token: 'tGallinas' })).status, 403);
  assert.equal((await api(path, { token: 'tAdminClubRevocado' })).status, 401);
  assert.equal((await api('/admin/cursos/compras', { token: 'tAdminClub' })).status, 403);
  const { data, status } = await api(path, { token: 'tAdminClub' });
  assert.equal(status, 200);
  assert.equal(data.serie.length, 7);
  assert.equal(data.totales.pagina_visitada.eventos, 2);
  assert.equal(data.totales.pagina_visitada.anonimos, 1);
  assert.equal(data.totales.pagina_visitada.cuentasVerificadas, 1);
  assert.equal(data.porCurso.find(x => x.slug === destinoSlug).totales.pagina_visitada.eventos, 1);
  assert.equal(data.porCurso.find(x => x.slug === 'curso-nuevo').totales.pagina_visitada.eventos, 1);
  assert.equal(data.dispositivos.find(x => x.dispositivo === 'telefono').totales.pagina_tiempo.duracionSeg, 4);
  assert.equal(data.dispositivos.find(x => x.dispositivo === 'tableta').totales.pagina_tiempo.duracionSeg, 0);
  assert.ok(!JSON.stringify(data).includes(visitaId));
  const promo = await api(path + '&origenSlug=' + origenSlug + '&destinoSlug=' + destinoSlug, { token: 'tAdmin' });
  assert.equal(promo.data.totales.pagina_visitada.eventos, 1);
  assert.ok(promo.data.personas.some(p => p.identidad === 'visita_anonima' && p.dispositivos.includes('telefono')));
});

test('solo el pago firmado y abonado entra al embudo, incluso con pago diferido y reenvíos', async () => {
  const origenSlug = 'gallinas-de-postura', destinoSlug = 'embutidos-artesanales';
  const visitaId = crypto.randomUUID();
  const compra = await api('/crear-checkout-curso', {
    method: 'POST', token: 'tGallinas', body: { slug: destinoSlug, origenSlug, visitaId, dispositivo: 'telefono' }
  });
  assert.equal(compra.status, 200, JSON.stringify(compra.data));
  const sessionId = compra.data.sessionId;
  const metrica = '/admin/cursos/promociones/metricas?origenSlug=' + origenSlug + '&destinoSlug=' + destinoSlug;
  const datos = { visitaId, origenSlug, destinoSlug };
  const actividad = (body) => api('/publico/cursos/actividad', { method: 'POST', body: { ...datos, ...body } });
  assert.equal((await actividad({ tipo: 'checkout_montado', sessionId, dispositivo: 'tableta' })).status, 204);
  assert.equal((await actividad({ tipo: 'compra_pagada', eventoId: crypto.randomUUID() })).status, 400);

  const creado = Math.floor(Date.now() / 1000) - 20;
  const confirmado = creado + 10;
  const session = {
    id: sessionId, created: creado, amount_total: 45000, currency: 'mxn', payment_status: 'unpaid',
    metadata: stripeMock.checkoutCreados.at(-1).metadata,
    customer_details: { email: users.tGallinas.email, name: 'Comprador' }
  };
  const evento = (type, created, object) => ({ id: 'evt_metricas_' + type, type, created, data: { object } });
  assert.equal(await webhook(evento('checkout.session.completed', creado, session)), 200);
  let informe = (await api(metrica, { token: 'tAdmin' })).data;
  assert.equal(informe.totales.compra_pagada.eventos, 0);
  assert.equal(informe.embudo.checkoutsMontadosSinConfirmar, 1);

  const abonada = { ...session, payment_status: 'paid' };
  const diferido = evento('checkout.session.async_payment_succeeded', confirmado, abonada);
  assert.equal(await webhook(diferido), 200);
  assert.equal(await webhook({ ...diferido, created: confirmado + 1 }), 200);
  informe = (await api(metrica, { token: 'tAdmin' })).data;
  assert.equal(informe.totales.compra_pagada.eventos, 1);
  assert.equal(informe.totales.compra_pagada.cuentasVerificadas, 1);
  assert.equal(informe.embudo.checkoutsMontadosPagados, 1);
  assert.equal(informe.embudo.checkoutsMontadosSinConfirmar, 0);
  assert.equal(informe.dispositivos.find(x => x.dispositivo === 'telefono').totales.compra_pagada.eventos, 1);
  assert.equal(informe.dispositivos.find(x => x.dispositivo === 'tableta').totales.checkout_montado.eventos, 0);
  assert.ok(!JSON.stringify(informe).includes(sessionId));
  assert.ok(!JSON.stringify(informe).includes('checkoutRef'));
  const fila = (await api('/admin/cursos/compras?slug=' + destinoSlug, { token: 'tAdmin' })).data.compras.find(p => p.sessionId === sessionId);
  assert.equal(fila.confirmadoEn, new Date(confirmado * 1000).toISOString());
  assert.equal(fila.promoOrigenSlug, origenSlug);
  assert.equal(fila.promoDescuentoCentavos, 10000);
  assert.equal(fila.dispositivo, 'telefono');
  assert.equal(fila.moneda, 'mxn');

  const sinVisita = {
    ...abonada, id: 'cs_sin_visita_metricas',
    metadata: { tipo: 'curso', slug: destinoSlug, uid: 'u-legado' },
    customer_details: { email: 'sin-visita@example.org', name: 'Compra común' }
  };
  assert.equal(await webhook(evento('checkout.session.completed', confirmado, sinVisita)), 200);
  assert.equal(await webhook(evento('checkout.session.completed', confirmado, {
    ...sinVisita, id: 'cs_regalo_metricas', amount_total: 0, payment_status: 'no_payment_required',
    metadata: { tipo: 'curso', slug: 'sexaje-avicola', uid: 'u-regalo' }
  })), 200);
  const sinAtribucion = '/admin/cursos/promociones/metricas?origenSlug=sin_atribucion&destinoSlug=' + destinoSlug;
  const noAtribuidas = (await api(sinAtribucion, { token: 'tAdmin' })).data;
  const pago = noAtribuidas.eventos.find(e => e.email === 'sin-visita@example.org' && e.tipo === 'compra_pagada');
  assert.equal(pago.identidad, 'comprador_stripe');
  assert.equal(pago.dispositivo, 'desconocido');
  assert.notEqual(pago.uid, 'u-legado');
  assert.equal(noAtribuidas.embudo.checkoutsPagados, 0);
  const todos = (await api('/admin/cursos/promociones/metricas', { token: 'tAdmin' })).data;
  assert.ok(!todos.porCurso.some(c => c.slug === 'sexaje-avicola'));
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

test('admin sube un material y publica la lista; el alumno lo ve y lo descarga firmado', async () => {
  const b64 = Buffer.from('PK\u0003\u0004contenido-pptx').toString('base64');
  let r = await api('/admin/cursos/material-archivo', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', nombre: 'Modulo 01 Fundamentos.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', base64: b64 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.storagePath, 'cursos/gallinas-de-postura/materiales/Modulo_01_Fundamentos.pptx');
  assert.ok((fakeAdmin._guardados || []).some(g => g.path === r.data.storagePath && g.bytes > 0));

  r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', recursos: [{ titulo: 'Módulo 01 · Fundamentos', storagePath: r.data.storagePath }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.recursos, [{ id: 'mat-1', titulo: 'Módulo 01 · Fundamentos' }]);

  const det = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  assert.equal(det.status, 200);
  assert.deepEqual(det.data.materiales.map(m => [m.titulo, m.disponible]), [['Módulo 01 · Fundamentos', true]]);
  assert.ok(!JSON.stringify(det.data.materiales).includes('storagePath'));

  const mat = await api('/alumno/curso/gallinas-de-postura/material', { token: 'tGallinas', method: 'POST', body: { materialId: det.data.materiales[0].id } });
  assert.equal(mat.status, 200);
  assert.match(mat.data.url, /^https:\/\/signed\.example\/cursos\/gallinas-de-postura\/materiales\//);
});

test('materiales admin: validaciones y 403 sin claim', async () => {
  let r = await api('/admin/cursos/material-archivo', { token: 'tGallinas', method: 'POST', body: { slug: 'gallinas-de-postura', nombre: 'x.pptx', base64: 'aaaa' } });
  assert.equal(r.status, 403);
  r = await api('/admin/cursos/material-archivo', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', nombre: '../../etc/passwd', base64: 'aaaa' } });
  assert.equal(r.status, 400);
  r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', recursos: [{ titulo: 'X', storagePath: 'otro/lado.pptx' }] } });
  assert.equal(r.status, 400);
  r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'no-existe', recursos: [] } });
  assert.equal(r.status, 404);
});

test('materiales con URL de Bunny: el listado no la expone y /material la entrega al alumno', async () => {
  const url = 'https://visionpecuariamateriales.b-cdn.net/gallinas/Modulo_01_Fundamentos.pptx';
  let r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', recursos: [{ titulo: 'Módulo 01', url }] } });
  assert.equal(r.status, 200);
  const det = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  assert.ok(!JSON.stringify(det.data.materiales).includes('b-cdn.net'));
  assert.equal(det.data.materiales[0].disponible, true);
  const mat = await api('/alumno/curso/gallinas-de-postura/material', { token: 'tGallinas', method: 'POST', body: { materialId: det.data.materiales[0].id } });
  assert.equal(mat.data.url, url);
  r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', recursos: [{ titulo: 'X', url: 'https://evil.com/a.pptx' }] } });
  assert.equal(r.status, 400);
});

test('materiales: descripción, categoría y tipo pptx llegan al alumno', async () => {
  const url = 'https://visionpecuariamateriales.b-cdn.net/Modulo_02_Nutricion.pptx';
  const miniatura = 'https://visionpecuariamateriales.b-cdn.net/portada-modulo-02.png';
  const r = await api('/admin/cursos/materiales', { token: 'tAdmin', method: 'POST', body: { slug: 'gallinas-de-postura', recursos: [{ titulo: 'Módulo 02', url, miniatura, descripcion: 'Requerimientos por etapa', categoria: 'Nutrición' }] } });
  assert.equal(r.status, 200);
  const det = await api('/alumno/curso/gallinas-de-postura', { token: 'tGallinas' });
  const m = det.data.materiales[0];
  assert.equal(m.descripcion, 'Requerimientos por etapa');
  assert.equal(m.categoria, 'Nutrición');
  assert.equal(m.tipo, 'pptx');
  assert.equal(m.miniatura, miniatura);
  assert.ok(!JSON.stringify(det.data.materiales).includes('Modulo_02_Nutricion.pptx'));
});

test('checkout: la clave de entrada no va en la URL y el retorno conserva el origen del aula', async () => {
  for (const [slug, origin] of [
    ['embutidos-artesanales', 'https://www.visionpecuariamx.com'],
    ['gallinas-de-postura', 'https://visionpecuariamx.com'],
    ['embutidos-artesanales', 'https://otro-sitio.example']
  ]) {
    const r = await api('/crear-checkout-curso', { method: 'POST', body: { slug }, origin });
    assert.equal(r.status, 200);
    assert.match(r.data.claveEntrada, /^[a-f0-9]{64}$/);
    const checkout = stripeMock.checkoutCreados.at(-1);
    assert.equal(checkout.metadata.huellaEntrada, crypto.createHash('sha256').update(r.data.claveEntrada).digest('hex'));
    assert.equal(JSON.stringify(checkout).includes(r.data.claveEntrada), false);
    const esperado = origin.endsWith('.example') ? process.env.SITIO_URL || 'https://visionpecuariamx.com' : origin;
    assert.equal(checkout.return_url, `${esperado}/${slug}.html?pago=ok&session_id={CHECKOUT_SESSION_ID}`);
  }
});

test('entrar por pago: sólo el navegador del checkout obtiene acceso de invitado a esa compra y su regalo', async () => {
  const P = (sessionId, claveEntrada) => api('/alumno/entrar-por-pago', { method: 'POST', body: { sessionId, claveEntrada, esperaMs: 0 } });
  const { claveEntrada, huellaEntrada } = nuevaClaveEntrada();
  stripeSessions.cs_nuevo.metadata.huellaEntrada = huellaEntrada;
  stripeSessions.cs_nuevo.currency = 'mxn';
  stripeSessions.cs_viejo_pago.metadata.huellaEntrada = huellaEntrada;
  assert.equal((await P('basura')).status, 400);
  assert.equal((await P('cs_no_existe_123')).status, 404);
  assert.equal((await P('cs_membresia')).status, 404);
  const sp = await P('cs_sin_pagar');
  assert.equal(sp.status, 409); assert.equal(sp.data.pendiente, true);

  assert.equal((await P('cs_nuevo')).data.entrada, 'manual');
  assert.equal((await P('cs_nuevo', nuevaClaveEntrada().claveEntrada)).data.entrada, 'manual');
  assert.equal((await P('cs_nuevo', claveEntrada)).status, 409);
  db.data.set('comprasCurso/cs_nuevo', {
    slug: 'embutidos-artesanales', estado: 'confirmado', regalo: 'sexaje-avicola', email: 'recien@gmail.com'
  });
  db.data.set('comprasCurso/cs_otro_recien', {
    slug: 'gallinas-de-postura', estado: 'confirmado', email: 'recien@gmail.com'
  });
  const r = await P('cs_nuevo', claveEntrada);
  assert.equal(r.status, 200);
  assert.equal(r.data.entrada, 'token');
  assert.equal(r.data.slug, 'embutidos-artesanales');
  assert.equal(r.data.monto, 550);
  assert.equal(r.data.moneda, 'MXN');
  assert.equal(r.data.regalo, 'sexaje-avicola');
  const uid = uidDePago('cs_nuevo');
  assert.equal(r.data.token, 'custom-' + uid);
  assert.equal(db._get('entradasPorPago/cs_nuevo').email, undefined);
  assert.equal(Object.values(users).some(user => user.email === 'recien@gmail.com'), false);
  assert.equal(db._get(`accesosCurso/${uid}/cursos/embutidos-artesanales`).activo, true);
  assert.equal(db._get(`accesosCurso/${uid}/cursos/sexaje-avicola`).origen, 'regalo');
  users.tInvitado = { uid };
  db.data.set('cursosVenta/sexaje-avicola', {
    nombre: 'Sexaje Avícola',
    clases: [{ id: 'c1', orden: 1, titulo: 'Clase 1', storagePath: 'cursos/sexaje/clase-01.mp4' }],
    recursosDescargables: [{ id: 'm1', titulo: 'Manual', tipo: 'pdf', storagePath: 'cursos/sexaje/manual.pdf' }]
  });
  const derechos = await api('/alumno/estado', { token: 'tInvitado' });
  assert.equal(derechos.status, 200);
  assert.equal(derechos.data.usuario.verificado, false);
  assert.equal(derechos.data.cursos.some(curso => curso.slug === 'gallinas-de-postura'), false);
  assert.equal(derechos.data.cursos.find(curso => curso.slug === 'sexaje-avicola').origen, 'regalo');
  const rutaRegalo = '/alumno/curso/sexaje-avicola';
  assert.equal((await api(rutaRegalo, { token: 'tOtro' })).status, 403);
  assert.equal((await api(rutaRegalo, { token: 'tInvitado' })).data.correoEntrega, 'recien@gmail.com');
  for (const [ruta, body] of [
    [rutaRegalo + '/video', { claseId: 'c1' }],
    [rutaRegalo + '/material', { materialId: 'm1' }],
    [rutaRegalo + '/progreso', { claseId: 'c1', segundos: 50 }],
    [rutaRegalo + '/certificado/solicitar', { nombreCompleto: 'Rita Nueva', whatsapp: '5512345678', estado: 'Puebla' }],
    ['/alumno/gallo-ia', { cursoSlug: 'sexaje-avicola', mensaje: '¿Cómo veo los materiales?' }]
  ]) {
    const resultado = await api(ruta, { token: 'tInvitado', method: 'POST', body });
    assert.equal(resultado.status, 200, ruta);
  }
  const certificado = db._get(`solicitudesCertificado/${uid}_sexaje-avicola`);
  assert.equal(certificado.email, 'recien@gmail.com');
  assert.equal(certificado.emailVerificado, false);
  const mismaSesion = await api('/alumno/entrar-por-pago', {
    method: 'POST', token: 'tInvitado', body: { sessionId: 'cs_nuevo', claveEntrada, esperaMs: 0 }
  });
  assert.equal(mismaSesion.data.entrada, 'sesion');
  assert.equal(mismaSesion.data.token, undefined);
  const r2 = await P('cs_nuevo');
  assert.equal(r2.data.entrada, 'manual');
  assert.equal(r2.data.token, undefined);
  assert.equal((await P('cs_nuevo', claveEntrada)).data.token, r.data.token);
  const v = await P('cs_viejo_pago', claveEntrada);
  assert.equal(v.data.entrada, 'manual'); assert.equal(v.data.token, undefined);

  const acceso = db._get(`accesosCurso/${uid}/cursos/embutidos-artesanales`);
  db.data.set(`accesosCurso/${uid}/cursos/embutidos-artesanales`, { ...acceso, activo: false, estado: 'inactivo', revocado: true });
  assert.equal((await P('cs_nuevo', claveEntrada)).data.entrada, 'manual');
});

test('entrar por pago: una cuenta existente requiere su propia sesión verificada', async () => {
  const { claveEntrada, huellaEntrada } = nuevaClaveEntrada();
  stripeSessions.cs_de_otro.metadata.huellaEntrada = huellaEntrada;
  db.data.set('comprasCurso/cs_de_otro', {
    slug: 'embutidos-artesanales', estado: 'confirmado', email: 'comprador@gmail.com'
  });
  const probar = (token) => api('/alumno/entrar-por-pago', {
    method: 'POST', token, body: { sessionId: 'cs_de_otro', claveEntrada, esperaMs: 0 }
  });
  const r = await probar('tOtro');
  assert.equal(r.status, 200);
  assert.equal(r.data.pagado, true);
  assert.equal(r.data.entrada, 'manual');
  assert.equal(r.data.token, undefined);
  assert.equal(db._get('entradasPorPago/cs_de_otro'), undefined);
  assert.equal((await probar('tSinVerif')).data.entrada, 'manual');
  const autorizado = await probar('tGallinas');
  assert.equal(autorizado.data.entrada, 'sesion');
  assert.equal(autorizado.data.token, undefined);
});

test('checkout y webhook de Sexaje honran la reserva del navegador y la hora real del pago', async () => {
  const cursoSlug = 'gallinas-de-postura';
  const navegadorId = crypto.randomUUID();
  const regalo = { slug: 'sexaje-avicola', desde: new Date(Date.now() - 86400000).toISOString() };
  await db.collection('cursosVenta').doc(cursoSlug).set({ regalo }, { merge: true });
  const apartar = (body) => api('/publico/cursos/regalo/apartar', { method: 'POST', body });
  assert.equal((await apartar({ cursoSlug, navegadorId: 'falso' })).status, 400);
  const reserva = await apartar({ cursoSlug, navegadorId });
  assert.equal(reserva.status, 200);
  assert.equal(reserva.data.cursoRegaloSlug, 'sexaje-avicola');
  assert.equal((await apartar({ cursoSlug, navegadorId })).data.venceEn, reserva.data.venceEn);

  const crear = async (cuerpo) => {
    const pago = await api('/crear-checkout-curso', { method: 'POST', body: { slug: cursoSlug, ...cuerpo } });
    assert.equal(pago.status, 200);
    return { ...pago.data, metadata: stripeMock.checkoutCreados.at(-1).metadata };
  };
  const token = reserva.data.token;
  const conReserva = await crear({ reservaRegalo: token, navegadorId });
  const fuera = await crear({ reservaRegalo: token, navegadorId });
  const sinReserva = await crear({ regaloSlug: 'sexaje-avicola', regaloVersion: '1' });
  const otroNavegador = await crear({ reservaRegalo: token, navegadorId: crypto.randomUUID() });
  assert.equal(conReserva.metadata.regaloVersion, '2');
  assert.equal(conReserva.metadata.regaloSlug, 'sexaje-avicola');
  assert.equal(conReserva.regaloReservado.venceEn, reserva.data.venceEn);
  assert.ok(!JSON.stringify(conReserva.metadata).includes(token));
  assert.ok(!JSON.stringify(conReserva.metadata).includes(navegadorId));
  for (const pago of [sinReserva, otroNavegador]) {
    assert.equal(pago.metadata.regaloVersion, '2');
    assert.equal(pago.metadata.regaloSlug, undefined);
    assert.equal(pago.regaloReservado, undefined);
  }
  const reclamo = await apartar({ cursoSlug, navegadorId, reclamar: true });
  assert.equal(reclamo.status, 200);
  assert.equal(reclamo.data.reclamada, true);
  const recuperada = await crear({ navegadorId });
  assert.equal(recuperada.metadata.regaloSlug, 'sexaje-avicola');
  assert.equal(recuperada.regaloReservado.venceEn, reserva.data.venceEn);

  const emitida = Number(conReserva.metadata.regaloEmitidaEn);
  const vence = Number(conReserva.metadata.regaloVenceEn);
  const sesion = (compra, email, status) => ({
    id: compra.sessionId, created: emitida + 1, payment_status: status, amount_total: 55000, currency: 'mxn',
    metadata: compra.metadata, customer_details: { email, name: 'Alumno de prueba' }
  });
  const evento = (type, created, object) => ({ id: 'evt_' + object.id + '_' + type, type, created, data: { object } });
  const rDentro = sesion(conReserva, 'reserva-dentro@example.org', 'unpaid');
  assert.equal(await webhook(evento('checkout.session.completed', emitida + 10, rDentro)), 200);
  assert.equal(db._get('comprasCurso/' + rDentro.id).regalo, undefined);
  const diferido = evento('checkout.session.async_payment_succeeded', vence - 1, { ...rDentro, payment_status: 'paid' });
  assert.equal(await webhook(diferido), 200);
  assert.equal(await webhook(diferido), 200);
  assert.equal(db._get('comprasCurso/' + rDentro.id).regalo, 'sexaje-avicola');
  assert.equal(db._get('accesosCurso/' + sint(rDentro.customer_details.email) + '/cursos/sexaje-avicola').stripeSessionId, rDentro.id);

  const desdeOtroBoton = sesion(recuperada, 'reserva-recuperada@example.org', 'paid');
  assert.equal(await webhook(evento('checkout.session.completed', vence - 1, desdeOtroBoton)), 200);
  assert.equal(db._get('comprasCurso/' + desdeOtroBoton.id).regalo, 'sexaje-avicola');
  await db.collection('cursosVenta').doc('sexaje-avicola').set({ nombre: 'Sexaje Avícola' });
  users.tRegaloRecuperado = { uid: 'u-regalo-recuperado', email: desdeOtroBoton.customer_details.email, email_verified: true };
  const aula = await api('/alumno/estado', { token: 'tRegaloRecuperado' });
  assert.equal(aula.status, 200);
  assert.deepEqual(slugs(aula), [cursoSlug, 'sexaje-avicola']);
  assert.equal(aula.data.cursos.find(curso => curso.slug === 'sexaje-avicola').origen, 'regalo');

  const rFuera = sesion(fuera, 'reserva-fuera@example.org', 'paid');
  assert.equal(await webhook(evento('checkout.session.async_payment_succeeded', vence, rFuera)), 200);
  assert.equal(db._get('comprasCurso/' + rFuera.id).estado, 'confirmado');
  assert.equal(db._get('comprasCurso/' + rFuera.id).regalo, undefined);
  const sinToken = sesion(sinReserva, 'sin-reserva@example.org', 'paid');
  assert.equal(await webhook(evento('checkout.session.completed', emitida + 30, sinToken)), 200);
  assert.equal(db._get('comprasCurso/' + sinToken.id).regalo, undefined);

  const legacy = {
    ...sinToken, id: 'cs_antes_ventana_sexaje',
    metadata: { tipo: 'curso', slug: cursoSlug }, customer_details: { email: 'antes-ventana@example.org' }
  };
  assert.equal(await webhook(evento('checkout.session.completed', vence + 40, legacy)), 200);
  assert.equal(db._get('comprasCurso/' + legacy.id).regalo, 'sexaje-avicola');
});

test('la recuperación de Stripe y la conciliación no inventan una hora previa a la caducidad', async () => {
  const cursoSlug = 'embutidos-artesanales';
  await db.collection('cursosVenta').doc(cursoSlug).set({
    regalo: { slug: 'sexaje-avicola', desde: new Date(Date.now() - 86400000).toISOString() }
  }, { merge: true });
  const datos = { cursoSlug, navegadorId: crypto.randomUUID(), secretoWebhook: process.env.STRIPE_WEBHOOK_SECRET };
  const ahora = new Date(Date.now() - 7200000);
  const r = await apartarRegalo(db, { ...datos, ahora });
  const checkout = metadataRegaloCheckout({ ...datos, ahora, token: r.token });
  const sesion = {
    created: Number(checkout.metadata.regaloEmitidaEn) + 1, payment_status: 'paid', amount_total: 55000,
    metadata: { ...checkout.metadata, tipo: 'curso', slug: cursoSlug },
    customer_details: { email: 'entrada-despues@example.org', name: 'Alumno de prueba' }
  };
  const vista = 'cs_recuperada_ventana';
  stripeSessions[vista] = { ...sesion, id: vista };
  const estado = await api('/verificar-session-curso?session_id=' + vista + '&slug=' + cursoSlug);
  assert.equal(estado.status, 200);
  assert.equal(estado.data.regalo, undefined);
  assert.equal(db._get('comprasCurso/' + vista).regalo, undefined);

  const conciliada = 'cs_admin_ventana_vencida';
  stripeSessions[conciliada] = { ...sesion, id: conciliada };
  const c = await api('/admin/cursos/conciliar', {
    token: 'tAdmin', method: 'POST',
    body: { sessionId: conciliada, emailDestino: users.tDestino.email, motivo: 'Comprobar compra recuperada' }
  });
  assert.equal(c.status, 200);
  assert.equal(db._get('comprasCurso/' + conciliada).regalo, undefined);
  assert.equal(db._get('accesosCurso/' + users.tDestino.uid + '/cursos/sexaje-avicola'), undefined);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { FakeDB } = require('./fakes');
const { guardarEventoPromo, registrarMetricasPromocion } = require('../promocion-analytics');

test('métricas de la promoción atribuyen eventos al comprador, deduplican y requieren acceso de admin', async () => {
  const origenSlug = 'gallinas-de-postura';
  const destinoSlug = 'embutidos-artesanales';
  const comprador = { uid: 'u1', email: 'alumno@example.com', name: 'Alumno', email_verified: true };
  const persona2 = { uid: 'u2', email: 'otro@example.com', email_verified: true };
  const db = new FakeDB();
  for (const [i, u] of [comprador, persona2].entries()) {
    await db.collection('comprasCurso').doc(`cs_compra${i}`).set({
      slug: origenSlug, estado: 'confirmado', email: u.email, montoPagadoCentavos: 55000
    });
  }

  const rutas = new Map();
  registrarMetricasPromocion({
    post(path, handler) { rutas.set(path, handler); },
    get(path, handler) { rutas.set(path, handler); }
  }, {
    db,
    async tokenRequerido(req, res) {
      if (!req.user) { res.status(401).end(); return null; }
      return req.user;
    },
    async adminRequerido(req, res) {
      if (req.user?.uid !== 'admin') { res.status(403).end(); return null; }
      return req.user;
    },
    log: console
  });

  async function api(path, req) {
    const result = { status: 200, headers: {} };
    const res = {
      status(code) { result.status = code; return this; },
      setHeader(name, value) { result.headers[name] = value; },
      json(data) { result.data = data; },
      end() {}
    };
    await rutas.get(path)(req, res);
    return result;
  }

  const enviar = (user, tipo, eventoId, extras) => api('/alumno/promociones/eventos', {
    user, body: { origenSlug, destinoSlug, tipo, eventoId, ...extras }
  });
  const metricas = (user, query = {}) => api('/admin/cursos/promociones/metricas', { user, query });

  assert.equal((await enviar(null, 'enlace_abierto', randomUUID())).status, 401);
  assert.equal((await enviar({ ...comprador, email_verified: false }, 'enlace_abierto', randomUUID())).status, 403);
  assert.equal((await enviar(comprador, 'checkout_creado', 'cs_intento')).status, 400);
  const idVideo = randomUUID();
  assert.equal((await enviar(comprador, 'video_reproducido', idVideo, { email: 'falso@example.com' })).status, 204);
  assert.equal((await enviar(comprador, 'video_reproducido', idVideo.toUpperCase())).status, 204);
  assert.equal((await enviar(comprador, 'video_reproducido', randomUUID())).status, 204);
  assert.equal((await enviar(persona2, 'video_reproducido', randomUUID())).status, 204);
  assert.equal((await enviar(comprador, 'enlace_abierto', randomUUID())).status, 204);

  const eventoStripe = { origenSlug, destinoSlug, tipo: 'checkout_creado', eventoId: 'cs_una_sesion', uid: comprador.uid, email: comprador.email, nombre: comprador.name };
  await guardarEventoPromo(db, eventoStripe);
  await guardarEventoPromo(db, eventoStripe);
  assert.equal((await enviar(persona2, 'checkout_montado', eventoStripe.eventoId)).status, 404);
  assert.equal((await enviar(comprador, 'checkout_montado', eventoStripe.eventoId)).status, 204);
  assert.equal((await enviar(comprador, 'checkout_montado', eventoStripe.eventoId)).status, 204);

  await guardarEventoPromo(db, { ...eventoStripe, eventoId: 'cs_vieja' }, new Date(Date.now() - 5 * 86400000));
  assert.equal((await metricas(comprador)).status, 403);
  assert.equal((await metricas({ uid: 'admin' }, { dias: '91' })).status, 400);
  const r = await metricas({ uid: 'admin' }, { dias: '3', origenSlug, destinoSlug });
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  const resumen = Object.fromEntries(Object.entries(r.data.totales).filter(([, v]) => v.eventos)
    .map(([tipo, { eventos, personas }]) => [tipo, { eventos, personas }]));
  assert.deepEqual(resumen, {
    enlace_abierto: { eventos: 1, personas: 1 },
    video_reproducido: { eventos: 3, personas: 2 },
    checkout_creado: { eventos: 1, personas: 1 },
    checkout_montado: { eventos: 1, personas: 1 }
  });
  assert.equal(r.data.serie.length, 3);
  assert.equal(r.data.serie.at(-1).video_reproducido, 3);
  assert.equal(r.data.personas.find(p => p.uid === comprador.uid).totales.video_reproducido, 2);
  assert.ok(r.data.eventos.every(e => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(e.fechaEn)));
  assert.ok(!JSON.stringify(r.data).includes('falso@example.com'));
});

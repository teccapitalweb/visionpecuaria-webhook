const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeDB } = require('./fakes');
const { regaloVigente, aplicarRegalo } = require('../regalos');

function dbConRegla() {
  const db = new FakeDB();
  db.data.set('cursosVenta/gallinas-de-postura', {
    regalo: { slug: 'sexaje-avicola', desde: '2026-11-01T00:00:00Z', hasta: '2026-11-30T23:59:59Z' }
  });
  return db;
}

test('compra dentro de la ventana congela y concede el regalo', async () => {
  const db = dbConRegla();
  const regalo = await regaloVigente(db, 'gallinas-de-postura', '2026-11-23T12:00:00Z');
  assert.equal(regalo, 'sexaje-avicola');
  const compra = { sessionId: 'cs_1', slug: 'gallinas-de-postura', regalo, fechaCompra: '2026-11-23T12:00:00Z' };
  assert.equal((await aplicarRegalo(db, 'u1', compra)).otorgado, true);
  assert.equal(db._get('accesosCurso/u1/cursos/sexaje-avicola').regaloDe, 'gallinas-de-postura');
});

test('compra fuera de la ventana no obtiene regalo', async () => {
  const db = dbConRegla();
  assert.equal(await regaloVigente(db, 'gallinas-de-postura', '2026-12-01T00:00:00Z'), null);
});

test('promoción sin fecha de fin sigue vigente después de la fecha inicial', async () => {
  const db = new FakeDB();
  db.data.set('cursosVenta/embutidos-artesanales', {
    regalo: { slug: 'sexaje-avicola', desde: '2026-11-23T00:00:00-06:00' }
  });
  assert.equal(await regaloVigente(db, 'embutidos-artesanales', '2030-01-01T00:00:00Z'), 'sexaje-avicola');
});

test('compra sin uid conserva el regalo para conciliación posterior', async () => {
  const db = dbConRegla();
  const compra = { sessionId: 'cs_2', slug: 'gallinas-de-postura', regalo: 'sexaje-avicola', email: 'a@b.mx' };
  assert.equal((await aplicarRegalo(db, 'uid-real', compra)).otorgado, true);
  assert.equal(db._get('accesosCurso/uid-real/cursos/sexaje-avicola').stripeSessionId, 'cs_2');
});

test('webhook repetido no duplica ni modifica el regalo', async () => {
  const db = dbConRegla();
  const compra = { sessionId: 'cs_3', slug: 'gallinas-de-postura', regalo: 'sexaje-avicola' };
  await aplicarRegalo(db, 'u3', compra);
  const primero = db._get('accesosCurso/u3/cursos/sexaje-avicola');
  assert.equal((await aplicarRegalo(db, 'u3', compra)).yaTenia, true);
  assert.deepEqual(db._get('accesosCurso/u3/cursos/sexaje-avicola'), primero);
});

test('un acceso previo a Sexaje nunca se sobrescribe', async () => {
  const db = dbConRegla();
  db.data.set('accesosCurso/u4/cursos/sexaje-avicola', { activo: false, revocado: true, nota: 'conservar' });
  const r = await aplicarRegalo(db, 'u4', { sessionId: 'cs_4', slug: 'gallinas-de-postura', regalo: 'sexaje-avicola' });
  assert.equal(r.yaTenia, true);
  assert.deepEqual(db._get('accesosCurso/u4/cursos/sexaje-avicola'), { activo: false, revocado: true, nota: 'conservar' });
});

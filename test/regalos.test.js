const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { FakeDB } = require('./fakes');
const { regaloVigente, aplicarRegalo, apartarRegalo, metadataRegaloCheckout, prepararRegaloCheckout, regaloParaPago } = require('../regalos');

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

test('la reserva dura una hora desde la primera presentación y no se renueva por navegador', async () => {
  const db = dbConRegla();
  const cursoSlug = 'gallinas-de-postura';
  const navegadorId = randomUUID();
  const secretoWebhook = 'secreto-para-prueba-local';
  const ahora = new Date('2026-11-23T12:00:00Z');
  const datos = { cursoSlug, navegadorId, secretoWebhook };
  const r = await apartarRegalo(db, { ...datos, ahora });
  assert.equal(r.cursoRegaloSlug, 'sexaje-avicola');
  assert.equal(r.ahora, ahora.toISOString());
  assert.equal(Date.parse(r.venceEn) - ahora.getTime(), 3600000);
  const repetida = await apartarRegalo(db, { ...datos, ahora: new Date('2026-11-23T13:00:01Z') });
  assert.equal(repetida.token, r.token);
  assert.equal(repetida.venceEn, r.venceEn);

  const activo = metadataRegaloCheckout({ ...datos, token: r.token, ahora });
  assert.equal(activo.reservado.venceEn, r.venceEn);
  assert.equal(activo.metadata.regaloVersion, '2');
  const cambia = [
    { ahora: new Date(r.venceEn) },
    { navegadorId: randomUUID() },
    { cursoSlug: 'embutidos-artesanales' },
    { token: 'A' + r.token.slice(1) },
    { secretoWebhook: 'otro-secreto-local' }
  ];
  for (const variante of cambia) {
    assert.deepEqual(metadataRegaloCheckout({ ...datos, token: r.token, ahora, ...variante }), { metadata: { regaloVersion: '2' } });
  }
  assert.ok(db.dump('reservasRegalosCurso/').every(f => !JSON.stringify(f).includes(navegadorId)));
});

test('solo la confirmación dentro de la hora concede el regalo de las sesiones nuevas', async () => {
  const db = dbConRegla();
  const cursoSlug = 'gallinas-de-postura';
  const navegadorId = randomUUID();
  const secretoWebhook = 'secreto-para-prueba-local';
  const inicio = new Date('2026-11-23T12:00:00Z');
  const datos = { cursoSlug, navegadorId, secretoWebhook };
  const r = await apartarRegalo(db, { ...datos, ahora: inicio });
  const checkout = metadataRegaloCheckout({ ...datos, token: r.token, ahora: inicio });
  const session = {
    created: inicio.getTime() / 1000 + 1, payment_status: 'paid', amount_total: 55000,
    metadata: { tipo: 'curso', slug: cursoSlug, ...checkout.metadata }
  };
  const antes = new Date(Date.parse(r.venceEn) - 1000);
  assert.equal(await regaloParaPago(db, session, antes), 'sexaje-avicola');
  assert.equal(await regaloParaPago(db, session, new Date(r.venceEn)), null);
  assert.equal(await regaloParaPago(db, session, new Date(Date.parse(r.venceEn) + 1000)), null);
  assert.equal(await regaloParaPago(db, { ...session, payment_status: 'unpaid' }, antes), null);
  assert.equal(await regaloParaPago(db, { ...session, payment_status: 'no_payment_required', amount_total: 0 }, antes), null);
  assert.equal(await regaloParaPago(db, {
    ...session, metadata: { tipo: 'curso', slug: cursoSlug, regaloVersion: '2' }
  }, antes), null);
  assert.equal(await regaloParaPago(db, { ...session, metadata: { tipo: 'curso', slug: cursoSlug } }, antes), 'sexaje-avicola');
});

test('el checkout recupera la ventana del mismo navegador y curso sin exigir un reclamo', async () => {
  const db = dbConRegla();
  const cursoSlug = 'gallinas-de-postura';
  const otroCurso = 'embutidos-artesanales';
  db.data.set('cursosVenta/' + otroCurso, db._get('cursosVenta/' + cursoSlug));
  const datos = { cursoSlug, navegadorId: randomUUID(), secretoWebhook: 'secreto-para-prueba-local', ahora: new Date('2026-11-23T12:00:00Z') };
  const sinRegalo = { metadata: { regaloVersion: '2' } };

  await assert.rejects(apartarRegalo(db, { ...datos, reclamar: true }), { status: 409 });
  assert.deepEqual(await prepararRegaloCheckout(db, datos), sinRegalo);
  const oferta = await apartarRegalo(db, datos);
  assert.equal(oferta.reclamada, false);
  assert.deepEqual(await prepararRegaloCheckout(db, datos),
    metadataRegaloCheckout({ ...datos, token: oferta.token }));
  assert.equal((await apartarRegalo(db, datos)).reclamada, false);

  const reclamada = await apartarRegalo(db, { ...datos, ahora: new Date('2026-11-23T12:30:00Z'), reclamar: true });
  assert.equal(reclamada.reclamada, true);
  assert.equal(reclamada.venceEn, oferta.venceEn);
  assert.equal(reclamada.token, oferta.token);
  const ahora = new Date('2026-11-23T12:59:59Z');
  assert.deepEqual(await prepararRegaloCheckout(db, { ...datos, ahora }),
    metadataRegaloCheckout({ ...datos, token: reclamada.token, ahora }));
  assert.deepEqual(await prepararRegaloCheckout(db, { ...datos, ahora, navegadorId: randomUUID() }), sinRegalo);
  assert.deepEqual(await prepararRegaloCheckout(db, { ...datos, ahora, cursoSlug: otroCurso }), sinRegalo);
  assert.deepEqual(await prepararRegaloCheckout(db, { ...datos, ahora: new Date(oferta.venceEn) }), sinRegalo);
  await assert.rejects(apartarRegalo(db, { ...datos, ahora: new Date(oferta.venceEn), reclamar: true }), { status: 409 });
});

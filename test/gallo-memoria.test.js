const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeDB } = require('./fakes');
const { crearMemoriaGallo } = require('../gallo-memoria');
const { evaluarGuia } = require('../gallo-evaluacion');

const slug = 'gallinas-de-postura';
const ejemplo = {
  mensaje: '¿Cómo veo mis clases? Mi correo es ejemplo@example.com',
  respuesta: 'Abre Clases desde el menú del curso.',
  modo: 'guia', version: 'gallo-prueba',
  fuentes: [{ titulo: 'Manual aprobado', url: 'https://example.org/guia' }]
};

test('memoria conserva únicamente turnos autorizados del mismo curso y no reaparece después de borrarla', async () => {
  const db = new FakeDB();
  const m = crearMemoriaGallo(db);
  const sin = await m.leerContexto('a', slug);
  assert.equal(sin.generacion, null);
  await m.guardarTurno('a', slug, null, ejemplo);
  assert.equal(db.dump('galloIAMemoria/').length, 0);

  const { generacion } = await m.activar('a', slug);
  await m.guardarTurno('a', slug, generacion, ejemplo);
  const actual = await m.leerContexto('a', slug);
  assert.equal(actual.mensajes.length, 2);
  assert.ok(!actual.mensajes[0].texto.includes('ejemplo@example.com'));
  assert.equal(actual.mensajes[1].fuentes[0].url, 'https://example.org/guia');
  assert.deepEqual((await m.leerContexto('a', 'embutidos-artesanales')).mensajes, []);
  assert.deepEqual((await m.leerContexto('b', slug)).mensajes, []);

  await m.borrar('a', slug);
  await m.guardarTurno('a', slug, generacion, ejemplo);
  assert.deepEqual((await m.leerContexto('a', slug)).mensajes, []);
  await m.activar('a', slug);
  await m.guardarTurno('a', slug, generacion, ejemplo);
  assert.deepEqual((await m.leerContexto('a', slug)).mensajes, []);
});

test('la valoración identifica su turno y compartir texto es explícito y reversible', async () => {
  const db = new FakeDB();
  const m = crearMemoriaGallo(db);
  const turnoId = await m.guardarTurno('a', slug, null, { ...ejemplo, sinEvidencia: true });
  const voto = { cursoSlug: slug, turnoId, voto: 'no_util' };
  assert.equal(await m.valorar('b', voto), false);
  assert.equal(await m.valorar('a', { ...voto, turnoId: 'token-incorrecto' }), false);
  assert.equal(await m.valorar('a', { ...voto, compartir: true, pregunta: 'inventada', respuesta: ejemplo.respuesta }), false);
  assert.equal(await m.valorar('a', voto), true);
  let informe = await m.listarCalidad();
  assert.equal(informe.items[0].pregunta, undefined);
  assert.deepEqual(informe.conteos, { util: 0, no_util: 1, sinEvidencia: 1 });
  assert.equal(await m.valorar('a', { ...voto, compartir: true, pregunta: ejemplo.mensaje, respuesta: ejemplo.respuesta }), true);
  informe = await m.listarCalidad();
  assert.ok(informe.items[0].pregunta.includes('[correo omitido]'));
  assert.equal(await m.valorar('a', { ...voto, compartir: false }), true);
  assert.equal((await m.listarCalidad()).items[0].pregunta, undefined);
  assert.equal(db.dump('galloIACalidad/').length, 1);
});

test('expiración lógica de la memoria y de comprobantes, más evaluación de referencia sin proveedor', async () => {
  const db = new FakeDB();
  let ms = Date.parse('2026-11-24T00:00:00Z');
  const m = crearMemoriaGallo(db, { ahora: () => ms });
  const { generacion } = await m.activar('a', slug);
  const id = await m.guardarTurno('a', slug, generacion, ejemplo);
  ms += 31 * 86400000;
  assert.equal((await m.leerContexto('a', slug)).generacion, null);
  assert.equal(await m.valorar('a', { cursoSlug: slug, turnoId: id, voto: 'util' }), false);
  const r = await evaluarGuia();
  assert.equal(r.aprobadas, r.total, JSON.stringify(r.resultados.filter(x => !x.satisfactorio)));
  assert.ok(r.total >= 8);
});

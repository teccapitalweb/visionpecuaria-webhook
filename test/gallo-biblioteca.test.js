const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { consultarBiblioteca } = require('../gallo-biblioteca');
const fichas = require('../gallo-biblioteca/fichas');
const fuentes = require('../gallo-biblioteca/fuentes');

const consultas = [
  ['Me llegan pollitos de un día, ¿qué preparo?', /enciende la criadora/i, 'pollitos'],
  ['¿Qué tempratura para poyitos?', /32–35 °C/, 'pollitos'],
  ['¿Qué materiales uso para la cama?', /material absorbente/i, 'bienestar'],
  ['¿Cómo mejoro el acceso a agua de mis gallinas?', /continuamente/, 'gallinas'],
  ['¿Qué alimneto les doy?', /crecimiento o desarrollo/, 'pollitos'],
  ['¿Por qué sale delgado el cascarn?', /calidad del cascarón/, 'calcio'],
  ['¿Cuántas horas de luz?', /periodo de oscuridad/, 'bienestar'],
  ['¿Cómo mejoro la ventilasión?', /recambio de aire/, 'calor'],
  ['¿Cuántas gayinas por metro?', /superficie útil accesible/, 'registros'],
  ['¿Por qué ponen en el piso?', /nidos accesibles/, 'gallinas'],
  ['Mis gallinas se picotean', /escarbar/, 'enriquecimiento'],
  ['¿Cómo calculo el porcentaje de postura?', /75 %/, 'registros'],
  ['¿Cuánto me cuesta producir un guevo?', /\$2\.50 por huevo/, 'presupuesto']
];

for (const [pregunta, fragmento, fuente] of consultas) {
  test(`recupera una ficha documentada para «${pregunta}»`, () => {
    const respuesta = consultarBiblioteca(pregunta);
    assert.match(respuesta?.texto || '', fragmento);
    assert.equal(respuesta.reformular, false);
    assert.ok(respuesta.fuentes.some(({ url }) => url === fuentes[fuente].url));
    assert.ok(respuesta.fuentes.every(f => Object.keys(f).sort().join(',') === 'titulo,url'));
  });
}

test('usa el turno más reciente para precisar calor, consumo o mantenimiento', () => {
  assert.match(consultarBiblioteca('y a cuantos grados', ['me llegan pollitos de un dia']).texto, /32–35 °C/);
  assert.match(consultarBiblioteca('y cuanta al dia', ['que bevedero necesito', 'alimento']).texto, /0\.2 litros/);
  assert.match(consultarBiblioteca('y cada cuanto la cambio', ['puedo usar aserrin en la cama']).texto, /Revisa la cama a diario/);
});

test('prioriza el tema directo y deja pasar otros temas o consultas sin evidencia', () => {
  assert.match(consultarBiblioteca('y cuantas horas de luz', ['cama']).texto, /temporizador/);
  assert.equal(consultarBiblioteca('como cambio mi contrasena', ['cama']), null);
  assert.equal(consultarBiblioteca('y cual es mi certifcado', ['cama']), null);
  assert.equal(consultarBiblioteca('cuanto cuesta producir chorizo', ['costo por huevo']), null);
  assert.equal(consultarBiblioteca('cuanto cuesta el curso', ['cama']), null);
  assert.equal(consultarBiblioteca('y como', ['mi cuenta', 'cama']), null);
  assert.equal(consultarBiblioteca('buenas tardes', ['calcio']), null);
  assert.equal(consultarBiblioteca(null), null);
});

test('cada ficha conserva sus citas y los PDF de referencia tienen licencia abierta', () => {
  for (const ficha of fichas) {
    assert.ok(ficha.fuentes.length > 0);
    assert.ok(ficha.fuentes.every(id => fuentes[id]?.url.startsWith('https://')));
  }
  const documentos = Object.values(fuentes).filter(fuente => fuente.pdf);
  assert.equal(documentos.length, 3);
  for (const documento of documentos) {
    assert.equal(documento.licencia, 'https://creativecommons.org/licenses/by/4.0/');
    assert.ok(documento.autor && documento.publicacion && documento.urlPdf.startsWith('https://'));
    const bytes = readFileSync(path.join(__dirname, '..', 'gallo-biblioteca', 'referencias', documento.pdf));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  }
});

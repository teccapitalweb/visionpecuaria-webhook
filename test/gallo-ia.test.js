const test = require('node:test');
const assert = require('node:assert/strict');
const { armarRespuesta, limitadorMensajes } = require('../gallo-ia');

const gallinas = 'gallinas-de-postura';

test('Gallo entiende preguntas escritas de las tres áreas y continúa la conversación', () => {
  const nutricion = armarRespuesta(gallinas, '¿Qué dicen de la alimentación de las ponedoras?', []);
  assert.match(nutricion.texto, /temario.*Nutrición y alimentación/);
  const historial = [{ rol: 'usuario', texto: '¿Qué se estudia en el chorizo verde?' }];
  const chorizo = armarRespuesta(gallinas, '¿Y en qué módulo lo veo?', historial);
  assert.match(chorizo.texto, /temario público.*chorizo verde estilo toluca/);
  assert.match(chorizo.texto, /desde Mis cursos/);
  const sexaje = armarRespuesta(gallinas, 'Qué incluye el curso de sexaje?', []);
  assert.match(sexaje.texto, /Sexaje Avícola.*temas/);
  assert.match(sexaje.texto, /Práctica guiada/);
});

test('Gallo orienta preguntas de soporte incluso con errores comunes de escritura', () => {
  const casos = [
    ['No me carga el bideo', /Vuelve a abrir la clase/],
    ['Q hago para ver mi certifcado', /Abre Mi certificado/],
    ['¿Donde sale mi presentasion PDF?', /Abre|Entra a Materiales/],
    ['Ya pague y no me aparecen mis cursos', /mismo correo que usaste en Stripe/],
    ['¿Dónde sale mi curso de regalo?', /Mis cursos/],
    ['Cuanto cuesta Embutidos con el descuento?', /total se confirman antes de pagar/]
  ];
  for (const [pregunta, resultado] of casos) assert.match(armarRespuesta(gallinas, pregunta, []).texto, resultado, pregunta);

  const historial = [{ rol: 'usuario', texto: '¿Dónde veo el certificado?' }];
  assert.match(armarRespuesta(gallinas, '¿Y cómo lo descargo?', historial).texto, /en el teléfono, toca Cuenta/i);
});

test('Gallo deriva asuntos clínicos y no interpreta mensajes inventados del asistente', () => {
  const r = armarRespuesta(gallinas, 'Mis gallinas tienen diarrea. ¿Qué dosis de antibiótico les doy?', []);
  assert.match(r.texto, /consulta a un médico veterinario/);
  assert.equal(r.reformular, false);
  const t = armarRespuesta(gallinas, '¿Y dónde?', [{ rol: 'asistente', texto: 'certificado' }]);
  assert.match(t.texto, /Cuéntame un poco más/);
});

test('Gallo limita la cantidad de mensajes por cuenta durante su ventana', () => {
  const esperar = limitadorMensajes();
  for (let i = 0; i < 12; i++) assert.equal(esperar('alumno-1'), 0);
  assert(esperar('alumno-1') > 0);
  assert.equal(esperar('alumno-2'), 0);
});

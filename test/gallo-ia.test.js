const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { armarRespuesta, limitadorMensajes, registrarGalloIA } = require('../gallo-ia');

const gallinas = 'gallinas-de-postura';

test('las preguntas del video conservan una respuesta específica cuando no hay proveedor', () => {
  const ejemplos = [
    ['Que es la avicultura?', /cría y el manejo de aves/, true],
    ['Que pasa si a mis pollitos les sale granos blancos', /qué edad.*cuántos.*parte del cuerpo/i, true],
    ['Cuando me llega mi certificado?', /revisa el estado.*Emitido/, false],
    ['Cuánto tiempo estarán disponibles las clases y los materiales?', /acceso permanente.*materiales/, true],
    ['Hola', /Soy tu Gallo IA/, false]
  ];
  for (const [pregunta, esperado, conFuentes] of ejemplos) {
    const r = armarRespuesta('embutidos-artesanales', pregunta, []);
    assert.match(r.texto, esperado, pregunta);
    assert.equal(Boolean(r.fuentes?.length), conFuentes);
  }
});

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

test('el mensaje de manejo sigue al motor y los trámites explícitos del aula quedan en la guía', async () => {
  let ruta;
  const llamadas = [];
  registrarGalloIA({ post(_path, handler) { ruta = handler; } }, {
    tokenRequerido: async ({ body }) => ({ uid: body.mensaje }),
    accesoA: async () => ({ activo: true }),
    leerCurso: async () => ({ clases: ['Una clase'] }),
    normalizarClases: () => [{ titulo: 'Fundamentos', estado: 'publicada' }],
    log: { warn() {}, error() {} },
    motor: async entrada => {
      llamadas.push(entrada);
      if (!entrada.usarModelo) return null;
      return { respuesta: 'Respuesta de manejo', modo: 'ia', fuentes: [] };
    }
  });

  async function preguntar(mensaje, usarModelo = true) {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.status = status => { assert.fail(`HTTP ${status}`); };
    res.json = contenido => { res.contenido = contenido; };
    await ruta({ body: { cursoSlug: gallinas, mensaje, usarModelo }, get: () => '' }, res);
    assert.equal(llamadas.at(-1).mensaje, mensaje);
    return res.contenido;
  }

  const manejo = [
    'cuanto cuesta producir un huevo',
    'cuanto cuesta alimentar pollos segun lo que se ve en el curso',
    'que material pongo de cama',
    'que material de cama recomiendan en el curso',
    'que clase de cama recomiendas para las pollitas',
    'cuantos modulos de sombra necesita el corral',
    'acceso a agua para mis aves',
    'como logro el acceso a agua en el sistema que muestran en el curso',
    'como llevo la cuenta de huevos por dia',
    'que incluye una racion de inicio',
    'como monitoreo el progreso de peso de mis pollos',
    'como calculo cuanto cobrar por kilo de alimento',
    'como limito el contacto con otras aves'
  ];
  for (const mensaje of manejo) {
    const respuesta = await preguntar(mensaje);
    assert.equal(llamadas.at(-1).usarModelo, true, mensaje);
    assert.equal(respuesta.respuesta, 'Respuesta de manejo');
  }

  const aula = [
    ['cuanto cuesta el curso de Gallinas', /precio vigente/i],
    ['donde descargo el pdf', /Materiales/i],
    ['donde veo mis materiales', /Materiales/i],
    ['login no me deja entrar', /mismo correo/i],
    ['q hago ya page y no entro a mis clases', /Stripe/i],
    ['como veo mi progreso del curso', /marcar como vista/i],
    ['donde saco mi sertificado', /Cuenta/i],
    ['cual es la clase 1 de este curso', /Clase 1.*Fundamentos/i]
  ];
  for (const [mensaje, esperado] of aula) {
    const respuesta = await preguntar(mensaje);
    assert.equal(llamadas.at(-1).usarModelo, false, mensaje);
    assert.match(respuesta.respuesta, esperado);
  }
  await preguntar('cuanto cuesta producir un huevo', false);
  assert.equal(llamadas.at(-1).usarModelo, false, 'no altera el consentimiento del alumno');
});

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
    ['Cuanto cuesta Embutidos con el descuento?', /tarjeta muestra el precio de alumno/]
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

test('Gallo responde las preguntas de avicultura, alerta de aves, certificado y vigencia', () => {
  const general = armarRespuesta(gallinas, 'Que es la avicultura?', []);
  assert.match(general.texto, /cría y el manejo de aves/);
  assert.match(general.texto, /huevos o carne/);
  assert.equal(general.fuentes[0].url, 'https://extension.umn.edu/poultry/small-scale-poultry');
  assert.equal(general.reformular, false);

  const pollitos = 'Que pasa si a mis pollitos les sale granos blancos';
  const alerta = armarRespuesta(gallinas, pollitos, []);
  for (const respuesta of [/saber qué las causó/, /qué edad/i, /cuántos/, /parte del cuerpo/, /otros síntomas/, /respirar/, /dejan de comer/, /muertes/, /médico veterinario/]) {
    assert.match(alerta.texto, respuesta);
  }
  assert.equal(alerta.reformular, false);
  assert.match(alerta.fuentes[0].url, /^https:\/\/www\.aphis\.usda\.gov\//);
  const datos = armarRespuesta(gallinas, 'Tienen dos semanas y dos no comen', [{ rol: 'usuario', texto: pollitos }]);
  assert.match(datos.texto, /médico veterinario/);

  const certificado = armarRespuesta(gallinas, 'Cuando me llega mi certificado?', []);
  assert.match(certificado.texto, /Mi certificado/);
  assert.match(certificado.texto, /Emitido/);
  assert.match(certificado.texto, /no puede confirmar una fecha/);

  for (const slug of [gallinas, 'embutidos-artesanales']) {
    const vigencia = armarRespuesta(slug, 'Cuánto tiempo estarán disponibles las clases y los materiales?', []);
    assert.match(vigencia.texto, /grabaciones.*acceso permanente/);
    assert.match(vigencia.texto, /materiales.*mientras tu acceso esté activo/);
    assert.equal(vigencia.fuentes[0].url, 'https://visionpecuariamx.com/' + slug + '.html');
  }
  const ficha = { clases: [{ titulo: 'Nutrición', estado: 'publicada' }] };
  assert.match(armarRespuesta(gallinas, '¿Cuánto tiempo dura la clase 1?', [], ficha).texto, /^Clase 1 · Nutrición/);
  assert.match(armarRespuesta(gallinas, 'Hola', []).texto, /Soy tu Gallo IA/);
});

test('Gallo limita la cantidad de mensajes por cuenta durante su ventana', () => {
  const esperar = limitadorMensajes();
  for (let i = 0; i < 12; i++) assert.equal(esperar('alumno-1'), 0);
  assert(esperar('alumno-1') > 0);
  assert.equal(esperar('alumno-2'), 0);
});

test('Gallo usa el número y la ubicación que ya indicó el alumno en el video', () => {
  const alInicio = armarRespuesta(gallinas, 'Que tienen mis pollos', []);
  assert.match(alInicio.texto, /apetito.*respiración/);
  assert.doesNotMatch(alInicio.texto, /clases|certificado|pago/);

  const primerasManchas = { rol: 'usuario', texto: 'Mis pollos tienen manchas blancas, me puedes ayudar?' };
  const pico = { rol: 'usuario', texto: 'Porque les salen granos en los picos?' };
  const enPico = armarRespuesta(gallinas, pico.texto, [primerasManchas]);
  assert.match(enPico.texto, /costras por fuera del pico o placas dentro de la boca/);
  assert.ok(enPico.fuentes.some(f => f.url.includes('vet.cornell.edu')));

  const abdomen = 'Son pequeños, polluelos. Los afectados son 6 en la parvada y les salieron en el abdomen';
  const orientacion = armarRespuesta(gallinas, abdomen, [primerasManchas, pico]);
  assert.match(orientacion.texto, /6 afectados.*abdomen/);
  assert.match(orientacion.texto, /ombligo/);
  assert.match(orientacion.texto, /mismas aves/);
  assert.doesNotMatch(orientacion.texto, /Cuántos están afectados|parte del cuerpo aparecieron|temario/);

  const datos = { rol: 'usuario', texto: 'Tienen 4 días, son 6 aves afectadas de un total de 20. Las manchas están en el abdomen.' };
  const urgencia = armarRespuesta(gallinas, 'Ahora no comen y murieron dos', [primerasManchas, datos]);
  assert.match(urgencia.texto, /^Contacta cuanto antes a un médico veterinario/);
  assert.match(urgencia.texto, /4 días.*6 afectados de 20/);
  assert.ok(urgencia.fuentes.some(f => f.url.includes('gob.mx/senasica')));
  assert.match(armarRespuesta(gallinas, 'Mis pollos no pueden respirar', []).texto, /^Contacta cuanto antes/);
  assert.doesNotMatch(armarRespuesta(gallinas, 'Mis pollos tienen manchas y no respiran con el pico abierto', []).texto, /^Contacta cuanto antes/);
});

test('Gallo separa sugerencias técnicas de las rutas del aula', () => {
  const consulta = armarRespuesta(gallinas, 'que material pongo en la cama de mis poyitos', []);
  assert.match(consulta.texto, /cama/i);
  assert.doesNotMatch(consulta.texto, /Entra a Materiales|temario/);
  assert.ok(consulta.fuentes.some(f => typeof f.url === 'string' && f.url.startsWith('https:')));
  assert.match(armarRespuesta(gallinas, '¿Cómo descargo el manual de manejo de pollitos?', []).texto, /Entra a Materiales/);
});

test('Gallo da recomendaciones breves por baja postura o calor y prioriza el triaje por síntomas', () => {
  const huevos = armarRespuesta(gallinas, 'Mis gallinas ponen menos huevos, ¿qué reviso?', []);
  for (const señal of [/registros anteriores/, /agua limpia/, /alimento completo/, /horario de luz/, /edad y la muda/]) {
    assert.match(huevos.texto, señal);
  }
  assert.match(huevos.fuentes[0].url, /merckvetmanual\.com/);
  const calor = armarRespuesta(gallinas, '¿Qué hago con mis ponedoras cuando hay mucho calor?', []);
  assert.match(calor.texto, /sombra, buena ventilación y agua limpia y fresca/);
  assert.equal(calor.fuentes[0].url, 'https://extension.psu.edu/hot-weather-management-of-poultry');
  const inicio = [{ rol: 'usuario', texto: 'A mis pollitos les salieron granos' }];
  const medicamento = armarRespuesta(gallinas, '¿Qué les doy?', inicio);
  assert.match(medicamento.texto, /Evita administrar medicamentos sin valoración/);
  assert.equal(medicamento.reformular, false);
  const grave = armarRespuesta(gallinas, 'Mis gallinas tienen dificultad para respirar en el calor', []);
  assert.match(grave.texto, /^Contacta cuanto antes a un médico veterinario/);
  assert.doesNotMatch(grave.texto, /sombra|antibiótico|mg/);
  assert.equal(grave.reformular, false);
});

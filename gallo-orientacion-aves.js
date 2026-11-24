const AVES = /\b(?:pollit\w*|pollos?|polluel\w*|gallinas?|avi(?:cola|ar)|aves?|parvada|ponedoras?)\b/;
const LESIONES = /\b(?:granos?|granit\w*|bolitas?|puntitos?|costras?|lesion\w*|placas?|manchas?|bultos?)\b/;
const DOLENCIA = /\b(?:enferm\w*|diarrea|decaid\w*|sintoma\w*|muert[ao]s|jade\w*|moco)\b/;
const ALARMA = /\b(?:dificultad (?:para|al) respirar|no (?:pueden? respirar|comen?|se levanta(?:n)?)|les cuesta respirar|respiran? con el pico abierto|boquean?|dej(?:o|aron) de comer|muri[oó]|murieron|muriendo|se me mueren|muertes? (?:subitas?|repentinas?)|convulsion\w*)\b/;
const MEDICAMENTO = /\b(?:dosis|medicament\w*|medicina\w*|antibio\w*|farmaco\w*|que l(?:e|es) (?:doy|pongo|inyecto)|cuanto l(?:e|es) doy|como (?:las?|los?) curo)\b/;
const AULA = /\b(?:en que clase|que clase (?:ense|habla|aborda)|certific\w*|presentacion|descarg\w*|aula|stripe)\b/;
const INTAKE = /\b(?:que tienen? mis|que l(?:e|es) (?:pasa|sucede)|me puedes ayudar con mis)\b/;
const SEGUIMIENTO = /\b(?:son|tienen?|afectad\w*|semanas?|desde|ayer|sali(?:eron|o)|manchas?|granos?|picos?|abdomen|ombligo|toma[n]? agua)\b/;
const ALIMENTO = /\b(?:comer|comida|alimento|racion|pienso|concentrado)\b/;

const FUENTES = {
  alerta: { titulo: 'Señales de enfermedad en aves · USDA APHIS', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/defend-the-flock/how-to-spot-sickness' },
  pico: { titulo: 'Lesiones externas y orales en aves · Facultad de Veterinaria de Cornell', url: 'https://cwhl.vet.cornell.edu/sites/default/files/2024-12/cwhl-fact-sheets-avian-pox.pdf' },
  abdomen: { titulo: 'Signos en el ombligo de pollitos recién nacidos · Manual Veterinario Merck', url: 'https://www.merckvetmanual.com/poultry/omphalitis/omphalitis-in-poultry' },
  cama: { titulo: 'Humedad de la cama de pollos · Mississippi State University Extension', url: 'https://www.extension.msstate.edu/publications/broiler-litter-odor-and-moisture-concerns' },
  senasica: { titulo: 'Canal de reporte sanitario en México · Senasica', url: 'https://www.gob.mx/senasica/acciones-y-programas/reporte-de-enfermedades-y-plagas-exoticas-de-los-animales-395978' }
};

function signo(texto) {
  return LESIONES.test(texto) || DOLENCIA.test(texto) || INTAKE.test(texto) || alarma(texto);
}

function alarma(texto) {
  const sinNegaciones = texto
    .replace(/\b(?:sin|no hay|no hubo|no han tenido|no tienen) (?:dificultad (?:para|al) respirar|muertes? \w+|convulsion\w*)\b/g, '')
    .replace(/\bno respiran? con el pico abierto\b/g, '');
  return ALARMA.test(sinNegaciones);
}

function ubicacion(texto) {
  const pico = /\b(?:picos?|boca|narinas?|fosas nasales)\b/.test(texto);
  const abdomen = /\b(?:abdomen|panza|vientre|ombligo)\b/.test(texto);
  return pico && abdomen ? 'pico y abdomen' : pico ? 'pico' : abdomen ? 'abdomen' : '';
}

const NUMERO = '(?:\\d{1,4}|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';
const EDAD = new RegExp('\\b(?:tienen?|edad (?:de|es)|polluel\\w* de|pollit\\w* de|de)\\s+(' + NUMERO + '\\s+(?:dias?|semanas?|mes(?:es)?))\\b');
const AFECTADOS = new RegExp('\\b(?:afectad[oa]s(?: son)?|afecta(?:n)? a)\\s+(' + NUMERO + ')\\b|\\b(' + NUMERO + ')\\s+(?:aves? |pollitos? )?afectad[oa]s?\\b');
const TOTAL = new RegExp('\\b(?:de un total de|en total son|lote de|parvada de|hay en total)\\s+(' + NUMERO + ')\\b');

function primerDato(turnos, patron) {
  for (const turno of turnos) {
    const match = turno.match(patron);
    if (match) return match[1] || match[2];
  }
  return '';
}

function orientarAves(texto, historial = []) {
  if (AULA.test(texto)) return null;
  const previos = historial.slice(0, 4);
  const casoPrevio = previos.findIndex(t => AVES.test(t) && signo(t));
  const vuelveAlCaso = casoPrevio !== -1 && (signo(texto) || SEGUIMIENTO.test(texto) ||
    MEDICAMENTO.test(texto) && !ALIMENTO.test(texto));
  const casoActual = AVES.test(texto) && signo(texto);
  if (!casoActual && !vuelveAlCaso) return null;

  const turnos = [texto, ...(casoPrevio < 0 ? [] : previos.slice(0, casoPrevio + 1))];
  const afectados = primerDato(turnos, AFECTADOS);
  const total = primerDato(turnos, TOTAL);
  const edad = primerDato(turnos, EDAD).replace(/\bdia(s?)\b/, 'día$1');
  const esPolluelo = turnos.some(t => /\b(?:pollit\w*|polluel\w*|recien nacid\w*)\b/.test(t));
  const donde = turnos.map(ubicacion).find(Boolean) || '';
  const ubicacionAnterior = turnos.slice(1).map(ubicacion).find(Boolean);
  const sitioCambio = ubicacion(texto) && ubicacionAnterior && donde !== ubicacionAnterior;
  const hayLesiones = turnos.some(t => LESIONES.test(t));
  const datos = [edad && 'tienen ' + edad, afectados && 'hay ' + afectados + ' afectados' + (total ? ' de ' + total : ''),
    donde && hayLesiones && 'las marcas están en el ' + donde].filter(Boolean);
  const resumen = datos.length ? 'Me dices que ' + datos.join(', ') + '. ' : '';

  if (alarma(texto) || MEDICAMENTO.test(texto) && !ALIMENTO.test(texto)) {
    const urgente = alarma(texto);
    const prioridad = urgente ? 'Contacta cuanto antes a un médico veterinario que atienda aves.' :
      'Para decidir si requieren tratamiento, consulta a un médico veterinario que atienda aves.';
    return {
      texto: prioridad + ' ' + resumen + 'Evita administrar medicamentos sin valoración. Anota cuándo empezaron los signos, si hay más aves afectadas y qué cambios has visto en comida, agua o respiración.' +
        (urgente && /\b(?:murieron|muertes?|se me mueren)\b/.test(texto) ? ' Si las muertes son repentinas o se sospecha un brote en México, consulta también el canal de Senasica.' : ''),
      reformular: false,
      fuentes: urgente && /\b(?:murieron|muertes?|se me mueren)\b/.test(texto) ? [FUENTES.alerta, FUENTES.senasica] : [FUENTES.alerta]
    };
  }

  const partes = [];
  const fuentes = [FUENTES.alerta];
  if (hayLesiones && donde.includes('abdomen')) {
    if (esPolluelo) {
      partes.push('En polluelos, fíjate si las marcas están alrededor del ombligo o repartidas en la piel. Si el ombligo se ve abierto, húmedo, hinchado o con secreción, pide valoración veterinaria pronto.');
      fuentes.push(FUENTES.abdomen);
    }
    partes.push('Si las marcas son superficiales, revisa si la cama está húmeda, apelmazada o áspera, sobre todo cerca de los bebederos.');
    fuentes.push(FUENTES.cama);
  }
  if (hayLesiones && donde.includes('pico')) {
    partes.push('Distingue si son costras por fuera del pico o placas dentro de la boca. Observa si pueden comer y beber por su cuenta. Evita despegar las costras o forzarles el pico.');
    fuentes.push(FUENTES.pico);
  }

  const preguntas = [];
  if (sitioCambio) preguntas.push('¿Las marcas del pico y del abdomen aparecen en las mismas aves?');
  if (hayLesiones && !donde) preguntas.push('¿En qué parte del cuerpo aparecieron y son costras secas, placas o bultos?');
  if (!edad) preguntas.push('¿Qué edad tienen en días o semanas?');
  if (!afectados) preguntas.push('¿Cuántos están afectados y cuántos hay en total?');
  if (afectados && !total) preguntas.push('¿Cuántas aves hay en total?');
  if (preguntas.length < 2 || hayLesiones && !donde) preguntas.push('¿Desde cuándo empezó y qué otros síntomas has notado?');

  const intro = hayLesiones ? 'La descripción de las marcas no basta para saber qué las causó.' :
    'Puedo ayudarte a revisar lo que observas en tus aves. Cuéntame si hay cambios en apetito, respiración, energía, heces o en la piel.';
  const observacion = hayLesiones ? 'Si puedes, toma una foto clara sin manipularlos de más para mostrarla a un médico veterinario.' : '';
  return {
    texto: [resumen + intro, ...partes, observacion, preguntas.slice(0, hayLesiones && !donde ? 4 : 2).join(' '),
      'Si les cuesta respirar, dejan de comer o hay muertes, contacta cuanto antes a un médico veterinario que atienda aves.'].filter(Boolean).join('\n\n'),
    reformular: false,
    fuentes
  };
}

module.exports = { orientarAves };

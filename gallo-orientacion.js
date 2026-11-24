const FUENTES_AVICULTURA = [{
  titulo: 'Avicultura a pequeña escala · University of Minnesota Extension',
  url: 'https://extension.umn.edu/poultry/small-scale-poultry'
}];
const FUENTES_ALERTA_AVES = [{
  titulo: 'Señales de enfermedad y cuidado de la parvada · USDA APHIS',
  url: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/defend-the-flock/resources/how-protect-your-flock-avian-influenza'
}];
const FUENTES_POSTURA = [{
  titulo: 'Manejo de gallinas ponedoras · Manual veterinario Merck',
  url: 'https://www.merckvetmanual.com/poultry/nutrition-and-management-poultry/management-of-laying-chickens'
}, {
  titulo: 'Cría de gallinas para huevo · University of Minnesota Extension',
  url: 'https://extension.umn.edu/agriculture/animals-and-livestock/poultry/raising-chickens-for-eggs'
}];
const FUENTES_CALOR = [{
  titulo: 'Manejo de aves en clima caluroso · Penn State Extension',
  url: 'https://extension.psu.edu/hot-weather-management-of-poultry'
}];
const PUBLICACION_CURSO = {
  'gallinas-de-postura': {
    nombre: 'Gallinas de Postura',
    url: 'https://visionpecuariamx.com/gallinas-de-postura.html'
  },
  'embutidos-artesanales': {
    nombre: 'Embutidos Artesanales y Chorizos',
    url: 'https://visionpecuariamx.com/embutidos-artesanales.html'
  }
};

function pideVigencia(texto) {
  const contenido = /\b(curso|aula|clase\w*|grabacion\w*|video\w*|material\w*|archiv\w*|acceso)\b/.test(texto);
  const disponibilidad = /\b(disponibl\w*|acceso|vigenc\w*|caduc\w*|venc\w*|permanen\w*|expir\w*|siempre|pierdo|perdere)\b/.test(texto);
  const plazo = /\b(cuanto tiempo|hasta cuando|por cuanto|cuant[oa]s (?:dias|meses|semanas)|cuanto dura|fecha limite|tiene fecha|caduc\w*|venc\w*|expir\w*|permanen\w*|siempre|vigenc\w*|pierdo|perdere)\b/.test(texto);
  return contenido && disponibilidad && plazo;
}

function orientacionBase(textoNormalizado, cursoSlug, historialNormalizado = []) {
  const texto = textoNormalizado;
  const anterior = historialNormalizado[0] || '';
  const aves = /\b(pollit\w*|pollos?|gallinas?|aves?|parvada|ponedoras?)\b/;
  const lesiones = /\b(granos?|granit\w*|bolitas?|puntitos?|costras?|lesion\w*|placas?|manchas?)\b/;
  const enfermedad = /\b(enferm\w*|diarrea|decaid\w*|sintoma\w*|no comen?|muri[oó]|murieron|muertes?|dificultad para respirar|les cuesta respirar)\b/;
  const alarma = /\b(dificultad para respirar|no (puede[n]? respirar|come[n]?)|les cuesta respirar|dejo de comer|dejaron de comer|muri[oó]|murieron|mortalidad|muertes? subitas?)\b/;
  const indicaMedicamento = /\b(dosis|medicament\w*|medicina\w*|antibio\w*|que (le|les) (doy|pongo)|cuanto (le|les) doy|que tomo)\b/;
  const contextoClinico = (aves.test(texto) && (lesiones.test(texto) || enfermedad.test(texto))) ||
    (aves.test(anterior) && (lesiones.test(anterior) || enfermedad.test(anterior)));
  const esUrgente = alarma.test(texto) && (aves.test(texto) || contextoClinico);
  if ((esUrgente || indicaMedicamento.test(texto)) && contextoClinico) {
    const prioridad = esUrgente ? 'Contacta cuanto antes a un médico veterinario que atienda aves. Lo que describes requiere valoración pronta.' :
      'Para este caso, consulta a un médico veterinario que atienda aves y pueda decidir si hace falta un tratamiento.';
    return {
      texto: prioridad + ' Evita administrar medicamentos sin valoración. Ten a mano la edad de las aves, cuántas están afectadas, desde cuándo y qué otros signos observaste.',
      reformular: false,
      fuentes: FUENTES_ALERTA_AVES
    };
  }

  const continuacionClinica = /\b(tienen|tiene|salen|empezaron|empezo|comen|respir\w*|murio|murieron|semanas?)\b/.test(texto);
  const retomaLesiones = aves.test(anterior) && lesiones.test(anterior) && continuacionClinica &&
    !/\b(certific\w*|clase\w*|receta\w*|material\w*)\b/.test(texto);
  if ((aves.test(texto) && lesiones.test(texto)) || retomaLesiones) {
    const detalle = retomaLesiones ? 'Para entender lo que observas en las aves, todavía hace falta una valoración.' :
      'La descripción de esas marcas en las aves no alcanza por sí sola para saber qué las causó.';
    return {
      texto: detalle + ' ¿Qué edad tienen, cuántos de la parvada están afectados, en qué parte del cuerpo aparecieron y qué otros síntomas has notado?\n\nSi les cuesta respirar, dejan de comer o hay muertes, contacta cuanto antes a un médico veterinario que atienda aves. No les des medicamentos sin valoración.',
      reformular: false,
      fuentes: FUENTES_ALERTA_AVES
    };
  }

  const certificado = /\b([cs]ertif\w*|constancia|diploma)\b/;
  const retraso = /\b(cuando|cuanto tarda|cuanto tiempo|cuanto demoran|fecha|plazo|lleg\w*|tard\w*)\b/;
  if ((certificado.test(texto) || certificado.test(anterior) && /^(y )?cuando\b/.test(texto)) && retraso.test(texto)) {
    return {
      texto: 'El equipo emite el certificado después de revisar tu solicitud. En tu curso, abre Mi certificado. Si estás en el teléfono, toca Cuenta y luego Ir a mi certificado. Si aún no lo solicitaste, envía tus datos desde ahí. Si ya enviaste la solicitud, revisa el estado en la misma pantalla. Cuando diga «Emitido», podrás abrirlo y recibirás el aviso por correo.\n\nEl chat no puede confirmar una fecha de entrega. Si necesitas seguimiento, usa Soporte WhatsApp desde el panel.',
      reformular: false
    };
  }

  const publicacion = PUBLICACION_CURSO[cursoSlug];
  if (publicacion && pideVigencia(texto)) {
    return {
      texto: 'Las grabaciones de ' + publicacion.nombre + ' tienen acceso permanente, según la página del curso. Puedes consultar los materiales desde el aula mientras tu acceso esté activo. Si caduca un enlace de archivo, vuelve a abrir el material desde el aula para obtener un enlace disponible.',
      reformular: false,
      fuentes: [{ titulo: 'Visión Pecuaria · ' + publicacion.nombre, url: publicacion.url }]
    };
  }

  if (/\b(?:que es|que significa|definicion de|en que consiste|explica\w*) (?:la )?avicultura\b|^avicultura$/.test(texto)) {
    return {
      texto: 'La avicultura es la cría y el manejo de aves domésticas, como gallinas, pavos y patos. Una de sus actividades principales es criar aves para producir huevos o carne. Incluye su alimentación, alojamiento, sanidad y bienestar. Por ejemplo, una granja de gallinas ponedoras que produce huevo se dedica a la avicultura.',
      reformular: false,
      fuentes: FUENTES_AVICULTURA
    };
  }

  const pideClase = /\b(que clase|en que (?:clase|modulo)|cual (?:clase|modulo)|que modulo)\b/.test(texto);
  const bajaPostura = (aves.test(texto) || aves.test(anterior) || /\b(huevos?|postura)\b/.test(texto)) &&
    /\b(?:baj\w* (?:la |de )?postura|baj\w* (?:la )?produccion de huevos?|ponen menos huevos|dej\w* de poner|no ponen?|menos huevos)\b/.test(texto);
  if (!pideClase && bajaPostura) {
    return {
      texto: 'Si tus gallinas están poniendo menos, compara el número de huevos que recoges cada día con los registros anteriores y revisa si cambió el número de ponedoras. Comprueba que tengan agua limpia, alimento completo para su etapa y que no haya cambiado su horario de luz. La edad y la muda también pueden reducir la postura.\n\n¿Cuántas gallinas tienes, qué edad tienen y desde cuándo bajó la producción? Si el cambio fue brusco y observas aves decaídas o enfermas, consulta a un veterinario.',
      reformular: false,
      fuentes: FUENTES_POSTURA
    };
  }
  const manejoCalor = /\b(calor|ola de calor|temperatura alta|estres termico)\b/.test(texto);
  const contextoAvicola = aves.test(texto) || aves.test(anterior) || /\b(gallinero|parvada|estres termico|manejo del calor)\b/.test(texto);
  if (!pideClase && manejoCalor && contextoAvicola) {
    return {
      texto: 'En días de calor, asegúrate de que tus aves tengan sombra, buena ventilación y agua limpia y fresca todo el día. Revisa los bebederos durante las horas más calientes y evita mover o manipular a las aves cuando más calor hace. Si alguna tiene dificultad para respirar o está muy decaída, consulta cuanto antes a un veterinario. ¿El gallinero recibe sol directo por la tarde?',
      reformular: false,
      fuentes: FUENTES_CALOR
    };
  }
  return null;
}

module.exports = { orientacionBase };

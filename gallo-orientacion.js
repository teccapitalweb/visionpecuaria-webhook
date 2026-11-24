const { orientarAves } = require('./gallo-orientacion-aves');

const FUENTES_AVICULTURA = [{
  titulo: 'Avicultura a pequeña escala · University of Minnesota Extension',
  url: 'https://extension.umn.edu/poultry/small-scale-poultry'
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
  const salud = orientarAves(texto, historialNormalizado);
  if (salud) return salud;

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

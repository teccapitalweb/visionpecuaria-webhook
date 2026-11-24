const fichas = require('./gallo-biblioteca/fichas');
const fuentes = require('./gallo-biblioteca/fuentes');

const VARIANTES = new Map([
  ['alientacion', 'alimentacion'], ['alimneto', 'alimento'],
  ['bebdero', 'bebedero'], ['bevedero', 'bebedero'], ['bevederos', 'bebederos'],
  ['certifcado', 'certificado'], ['certficado', 'certificado'],
  ['galyinas', 'gallinas'], ['gayinas', 'gallinas'], ['gallna', 'gallina'],
  ['gayinero', 'gallinero'], ['gallnero', 'gallinero'],
  ['polltios', 'pollitos'], ['poyitos', 'pollitos'], ['poyitas', 'pollitas'],
  ['ponedras', 'ponedoras'], ['postrua', 'postura'], ['postra', 'postura'],
  ['cascarn', 'cascaron'], ['cascarom', 'cascaron'],
  ['tempratura', 'temperatura'], ['temperatrua', 'temperatura'],
  ['ventilasion', 'ventilacion'], ['ventilasor', 'ventilador'],
  ['fotoperido', 'fotoperiodo'], ['iluminasion', 'iluminacion'],
  ['aserrim', 'aserrin'], ['serrin', 'aserrin'],
  ['costoos', 'costos'], ['huebos', 'huevos'], ['guevo', 'huevo'], ['guevos', 'huevos']
]);
const SEGUIMIENTO = /^(?:y\b|entonces\b|tambien\b|cada cuanto\b|cuant[oa]s?\b|a (?:que|cuant[oa]s?)\b|en que\b|por que\b|como\b|cuando\b|que (?:hago|mas)\b|dame (?:un )?ejempl[oa]\b|explica(?:me)? mas\b)/;
const OTRO_TEMA = /\b(?:chorizos?|embutidos?|longanizas?|salchichas?|ganado|vacas?|cerdos?|conejos?|perros?|gatos?|cocinar|hornear|pasteles?)\b/;
const AVES = /\b(?:gallin\w*|pollit\w*|pollos?|parvada|ponedoras?|aves|avicola|avicultura|lote)\b/;
const CONSULTA_DE_AULA = /\b(?:contrasena|certificado|reembolso|stripe|comprobante de pago|precio del curso|cuanto (?:me )?(?:cuesta|sale|vale) (?:el |este )?curso|(?:clase|sesion|modulo) \d+)\b/;

function normalizar(texto) {
  if (typeof texto !== 'string') return '';
  return texto.slice(0, 1000).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .match(/[a-z0-9]+/g)?.map(palabra => VARIANTES.get(palabra) || palabra).join(' ') || '';
}

function puntuar(ficha, texto) {
  const frase = ` ${texto} `;
  const coincide = palabra => frase.includes(` ${palabra} `);
  const claves = ficha.claves.filter(coincide);
  const pistas = ficha.pistas.filter(coincide);

  if (!claves.length) return pistas.length >= 2 ? pistas.length : 0;
  const mejorClave = Math.max(...claves.map(clave => clave.split(' ').length));
  return 3 + 2 * mejorClave + Math.min(claves.length - 1, 2) + Math.min(pistas.length, 2);
}

function encontrarFicha(texto) {
  const opciones = fichas.map(ficha => ({ ficha, puntaje: puntuar(ficha, texto) }))
    .sort((a, b) => b.puntaje - a.puntaje);
  const [primera, segunda] = opciones;
  if (primera.puntaje < 2 || primera.puntaje === segunda.puntaje) return null;
  return primera.ficha;
}

function correspondeABiblioteca(texto) {
  return Boolean(texto) && !CONSULTA_DE_AULA.test(texto) && (!OTRO_TEMA.test(texto) || AVES.test(texto));
}

function consultarBiblioteca(textoNormalizado, historialNormalizado = []) {
  const texto = normalizar(textoNormalizado);
  if (!correspondeABiblioteca(texto)) return null;
  let ficha = encontrarFicha(texto);
  const seguimiento = SEGUIMIENTO.test(texto) && texto.split(' ').length <= 12;
  if (!ficha && seguimiento && Array.isArray(historialNormalizado)) {
    const anterior = normalizar(historialNormalizado[0]);
    if (correspondeABiblioteca(anterior)) ficha = encontrarFicha(anterior);
    if (ficha?.id === 'arranque' && /\b(temperatura|grados?|foco|lampara|criadora)\b/.test(texto)) {
      ficha = encontrarFicha('temperatura para pollitos');
    }
  }
  if (!ficha) return null;

  const ajuste = ficha.seguimientos?.find(({ patron }) => patron.test(texto));
  return {
    texto: ajuste?.texto || ficha.texto.join('\n\n'),
    fuentes: ficha.fuentes.map(id => {
      const { titulo, url } = fuentes[id];
      return { titulo, url };
    }),
    reformular: false
  };
}

module.exports = { consultarBiblioteca };

const { parentPort, workerData } = require('node:worker_threads');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');

const MAX_TEXTO = 160000;
const MAX_XML = 1024 * 1024;
const WORD_NS = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main'
]);

function textoDocx(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', () => reject(new Error('No encontramos el documento de Word')));
      zip.on('entry', entry => {
        if (entry.fileName !== 'word/document.xml') return zip.readEntry();
        if (entry.uncompressedSize > MAX_XML) {
          zip.close();
          return reject(new Error('El documento supera el límite de texto'));
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err) { zip.close(); return reject(err); }
          const parser = new SaxesParser({ xmlns: true });
          let texto = '';
          let leyendo = false;
          const abortar = error => { stream.destroy(); zip.close(); reject(error); };
          parser.on('error', abortar);
          parser.on('doctype', () => abortar(new Error('El documento contiene declaraciones XML no admitidas')));
          parser.on('opentag', ({ uri, local }) => {
            if (WORD_NS.has(uri) && local === 't') leyendo = true;
          });
          parser.on('text', parte => {
            if (leyendo) texto += parte;
            if (texto.length > MAX_TEXTO) abortar(new Error('El documento supera el límite de texto'));
          });
          parser.on('closetag', ({ uri, local }) => {
            if (!WORD_NS.has(uri)) return;
            if (local === 't') leyendo = false;
            if (local === 'p') texto += '\n';
          });
          stream.setEncoding('utf8');
          stream.on('error', abortar);
          stream.on('data', fragmento => {
            try { parser.write(fragmento); } catch (error) { abortar(error); }
          });
          stream.on('end', () => {
            try { parser.close(); resolve(texto); } catch (error) { reject(error); }
            zip.close();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function textoPdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarea = getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, stopAtErrors: true
  });
  try {
    const pdf = await tarea.promise;
    if (pdf.numPages > 80) throw new Error('Usa un PDF de hasta 80 páginas');
    let texto = '';
    for (let pagina = 1; pagina <= pdf.numPages; pagina++) {
      const page = await pdf.getPage(pagina);
      const contenido = await page.getTextContent();
      texto += contenido.items.map(item => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') + '\n\n';
      if (texto.length > MAX_TEXTO) throw new Error('El documento supera el límite de texto');
      page.cleanup();
    }
    return texto;
  } finally {
    await tarea.destroy();
  }
}

async function extraer() {
  const { extension, datos } = workerData;
  const bytes = Buffer.from(datos);
  if (extension === 'docx') return textoDocx(bytes);
  if (extension === 'pdf') return textoPdf(bytes);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

extraer().then(
  texto => parentPort.postMessage({ texto }),
  () => parentPort.postMessage({ error: true })
);

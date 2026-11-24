const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');

const ORGANIZACION = 'visionpecuaria';
const ESPECIALIDADES = new Set([
  'avicultura', 'pollos-engorda', 'gallinas-postura', 'incubacion-sexaje', 'bovinos-leche-carne',
  'porcicultura', 'ovinocultura', 'caprinocultura', 'nutricion', 'reproduccion',
  'bioseguridad-sanidad', 'administracion-economia'
]);
const EXTENSIONES = new Set(['pdf', 'docx', 'txt']);
const ARCHIVO_MAX = 2 * 1024 * 1024;
const TEXTO_MAX = 160000;
const REVISIONES_MAX = 40;
const INDICES_MAX = 120;
const calendario = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City', calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit'
});
const STOPWORDS = new Set('para como cual cuales cuando donde sobre desde esta esto estas estos este puede pueden tengo tienen saber hacer seria tengo unas unos que del las los una uno con sin por hay mis les sus mas muy entre entre'.split(' '));
let procesandoArchivos = 0;

function error(status, mensaje, datos) {
  return Object.assign(new Error(mensaje), { status, datos });
}

function textoLimpio(valor) {
  return typeof valor === 'string' ? valor.replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim() : '';
}

function breve(valor, maximo) {
  return textoLimpio(valor).slice(0, maximo);
}

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokenizar(valor) {
  return (normalizar(valor).match(/[a-z0-9]{3,}/g) || [])
    .filter(p => !STOPWORDS.has(p)).map(p => p.length > 5 && p.endsWith('s') ? p.slice(0, -1) : p);
}

function identidad(admin) {
  return { uid: admin.uid, email: breve(admin.email, 320), nombre: breve(admin.name, 160) };
}

function refs(db, id) {
  const raiz = db.collection('galloIAConocimiento').doc(ORGANIZACION);
  const fuentes = raiz.collection('fuentes');
  if (!id) return { fuentes, indices: raiz.collection('indice') };
  const fuente = fuentes.doc(id);
  return {
    fuente, revision: numero => fuente.collection('revisiones').doc(String(numero)),
    indice: raiz.collection('indice').doc(id), huella: hash => raiz.collection('huellas').doc(hash)
  };
}

function validarId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw error(400, 'Identificador de fuente inválido');
}

function validarContenidoSeguro(texto) {
  const normal = normalizar(texto);
  const patogeno = '\\b(?:virus|virion|patogeno|pathogen|toxina|toxin|bacteria|anthrax|antrax|influenza|botulin|brucell|h5n1|salmonell)';
  const actividad = '\\b(?:aislamient|isolation|cultiv|cultur|propaga|amplifica|amplify|aerosoli|recombin|mutagene|transfecc|transfect|reverse.genetic|ganancia.de.funcion|gain.of.function|rescue|rescat|infectivi|transmisibili|evasi[oó]n|evasio)';
  const proximidad = new RegExp(actividad + '[^.!?\\n]{0,75}' + patogeno + '|' + patogeno + '[^.!?\\n]{0,75}' + actividad, 'i');
  const operativa = /(?:protocolo|protocol|paso.a.paso|procedimiento|metodologia|reactivos|inocula|incuba|microlitro|metodo|concentraci[oó]n|cep[aá]|strain|step.by.step|medium|plasmid|plasmido|guide.rna)/i;
  if ((proximidad.test(normal) && operativa.test(normal)) ||
      /(?:ignora|ignore|olvida|forget|sobrescribe|override).{0,35}(?:instruccion|instruction|system prompt)|<\|(?:system|assistant|user)\|>/i.test(normal)) {
    throw error(422, 'La fuente requiere otra selección de contenido para su incorporación');
  }
}

function validarEnlace(valor) {
  let url;
  try { url = new URL(breve(valor, 1500)); } catch (_) { throw error(400, 'Enlace de fuente inválido'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(url.hostname) ||
      /\.(?:internal|localhost|local|test|invalid)$/i.test(url.hostname)) {
    throw error(400, 'La fuente debe enlazar a un sitio público con HTTPS');
  }
  return url.toString();
}

function extraerArchivo(extension, bytes) {
  if (procesandoArchivos >= 2) throw error(429, 'Hay otros documentos en proceso. Intenta de nuevo en unos segundos.');
  const worker = new Worker(join(__dirname, 'gallo-extraer-documento.js'), {
    workerData: { extension, datos: bytes },
    resourceLimits: { maxOldGenerationSizeMb: 96 },
    stdout: true, stderr: true
  });
  worker.stdout.resume();
  worker.stderr.resume();
  procesandoArchivos++;
  return new Promise((resolve, reject) => {
    let completado = false;
    const completar = (err, resultado) => {
      if (completado) return;
      completado = true;
      clearTimeout(timeout);
      worker.terminate().catch(() => {});
      if (err) reject(err);
      else resolve(resultado);
    };
    const timeout = setTimeout(() => completar(error(422, 'El archivo supera el tiempo de procesamiento')), 12000);
    timeout.unref();
    const fallar = () => completar(error(422, 'No pudimos leer texto en el archivo. Usa un documento con texto seleccionable.'));
    worker.once('message', ({ texto, error: fallo }) => fallo ? fallar() : completar(null, texto));
    worker.once('error', fallar);
    worker.once('exit', () => { procesandoArchivos--; fallar(); });
  });
}

async function leerArchivo(body) {
  const archivoNombre = breve(body.archivoNombre, 180);
  const extension = archivoNombre.toLowerCase().split('.').at(-1);
  const base64 = body.archivoBase64;
  if (!archivoNombre.includes('.') || !EXTENSIONES.has(extension)) throw error(400, 'Usa un archivo PDF, DOCX o TXT');
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(ARCHIVO_MAX / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw error(400, 'El archivo debe pesar como máximo 2 MB y tener un formato válido');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > ARCHIVO_MAX) throw error(400, 'El archivo debe pesar como máximo 2 MB');
  if ((extension === 'pdf' && !bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-')) ||
      (extension === 'docx' && !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])))) {
    throw error(400, 'El formato del archivo no coincide con su extensión');
  }
  return { archivoNombre, texto: await extraerArchivo(extension, bytes) };
}

async function prepararRevision(body, anterior) {
  if (body.autorizado !== true) throw error(400, 'Confirma que tienes autorización para incorporar este contenido');
  const tipo = body.conservarContenido === true ? anterior?.tipo : body.tipo;
  if (!['texto', 'archivo', 'qa', 'url'].includes(tipo)) throw error(400, 'Tipo de fuente inválido');
  const titulo = breve(body.titulo, 160);
  const origen = breve(body.origen, 500);
  const autor = breve(body.autor, 180);
  const fecha = breve(body.fecha, 30);
  const especialidad = body.especialidad;
  const visibilidad = body.visibilidad === 'alumnos' ? 'alumnos' : 'privada';
  const permiso = body.permitirModeloExterno ?? body.enviarModelo;
  const permitirModeloExterno = visibilidad === 'alumnos' && permiso === true;
  const cursoSlug = visibilidad === 'alumnos' ? breve(body.cursoSlug, 120) : '';
  if (!titulo || !origen || !ESPECIALIDADES.has(especialidad) ||
      (fecha && !/^\d{4}(?:-\d{2}-\d{2})?$/.test(fecha)) ||
      (cursoSlug && !/^[a-z0-9-]+$/.test(cursoSlug))) {
    throw error(400, 'Indica título, origen y especialidad válidos y revisa la fecha o el curso');
  }
  let contenido;
  if (body.conservarContenido === true) {
    const { texto, archivoNombre, pregunta, respuesta, url } = anterior;
    contenido = { texto, ...(archivoNombre ? { archivoNombre } : {}), ...(pregunta ? { pregunta, respuesta } : {}), ...(url ? { url } : {}) };
  } else if (tipo === 'archivo') {
    contenido = await leerArchivo(body);
  } else if (tipo === 'qa') {
    const pregunta = breve(body.pregunta, 1000);
    const respuesta = textoLimpio(body.respuesta);
    if (!pregunta || !respuesta) throw error(400, 'Agrega una pregunta y su respuesta verificada');
    contenido = { pregunta, respuesta, texto: pregunta + '\n\n' + respuesta };
  } else {
    contenido = { texto: body.texto, ...(tipo === 'url' ? { url: validarEnlace(body.url) } : {}) };
  }
  const texto = textoLimpio(contenido.texto);
  if (texto.length < 25 || texto.length > TEXTO_MAX) throw error(422, 'Agrega entre 25 y 160,000 caracteres de texto extraíble');
  validarContenidoSeguro(texto);
  if (contenido.url) contenido.url = validarEnlace(contenido.url);
  const huella = createHash('sha256').update(normalizar(texto).replace(/\s+/g, ' ')).digest('hex');
  return {
    metadata: { tipo, titulo, autor, fecha, origen, especialidad, visibilidad, cursoSlug, permitirModeloExterno, autorizado: true },
    contenido: { ...contenido, texto, huella }
  };
}

function registrarCambio(anterior, { version, accion, estado, por, motivo = '', fechaEn }) {
  return [{ version, accion, estado, por, motivo, fechaEn }, ...(anterior || [])].slice(0, 80);
}

async function guardarRevision(db, id, body, admin) {
  const ruta = refs(db, id);
  const existente = id ? (await ruta.fuente.get()).data() : null;
  if (id && (!existente || existente.estado === 'eliminado')) throw error(404, 'Fuente no encontrada');
  if (body.versionEsperada != null && body.versionEsperada !== existente?.version) throw error(409, 'La fuente cambió. Recarga para guardar.');
  if (body.conservarContenido === true && !existente) throw error(400, 'La fuente todavía no tiene contenido');
  const anterior = body.conservarContenido === true ? (await ruta.revision(existente.version).get()).data() : null;
  const { metadata, contenido } = await prepararRevision(body, anterior);
  const fuenteId = id || ruta.fuentes.doc().id;
  const destino = refs(db, fuenteId);
  const usuario = identidad(admin);
  const fechaEn = new Date().toISOString();
  const resultado = await db.runTransaction(async tx => {
    const snap = await tx.get(destino.fuente);
    const fuente = snap.data();
    if (fuente?.version !== existente?.version || fuente?.estado !== existente?.estado) throw error(409, 'La fuente cambió. Recarga para guardar.');
    const marca = destino.huella(contenido.huella);
    const duplicado = (await tx.get(marca)).data();
    if (duplicado && duplicado.fuenteId !== fuenteId) {
      const original = (await tx.get(refs(db, duplicado.fuenteId).fuente)).data();
      if (original && original.estado !== 'eliminado') throw error(409, 'Este contenido ya existe en el centro de conocimiento', { codigo: 'fuente_duplicada', fuenteId: duplicado.fuenteId });
    }
    const version = (fuente?.version || 0) + 1;
    if (version > REVISIONES_MAX) throw error(409, 'La fuente alcanzó el límite de revisiones');
    const estado = 'pendiente';
    const nuevo = {
      ...metadata, estado, version, versionActiva: fuente?.versionActiva || null, indice: 'pendiente',
      actualizadoEn: fechaEn, actualizadoPor: usuario, creadoEn: fuente?.creadoEn || fechaEn,
      aprobadoPor: fuente?.aprobadoPor || null, aprobadoEn: fuente?.aprobadoEn || null,
      historial: registrarCambio(fuente?.historial, { version, accion: id ? 'editar' : 'crear', estado, por: usuario, fechaEn })
    };
    tx.set(destino.fuente, nuevo);
    tx.set(destino.revision(version), { ...metadata, ...contenido, version, estado, actualizadoEn: fechaEn, actualizadoPor: usuario });
    tx.set(marca, { fuenteId });
    return nuevo;
  });
  return { id: fuenteId, ...resultado, ...contenido };
}

function configEmbeddings() {
  const model = process.env.GALLO_EMBEDDING_MODEL;
  const key = process.env.OPENAI_API_KEY;
  if (!['text-embedding-3-small', 'text-embedding-3-large'].includes(model) || !key) return null;
  return { model, key };
}

async function vectorizar(texto, config) {
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(4000), redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key },
      body: JSON.stringify({ model: config.model, dimensions: 256, input: texto })
    });
    if (!r.ok) return null;
    const v = (await r.json()).data?.[0]?.embedding;
    return Array.isArray(v) && v.length === 256 && v.every(Number.isFinite) ? v : null;
  } catch (_) {
    return null;
  }
}

async function reservarIndexacion(db, id, version, ahora = new Date()) {
  const limite = Number(process.env.GALLO_INDEXACIONES_DIA);
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > 500) return false;
  const raiz = db.collection('galloIAConocimiento').doc(ORGANIZACION);
  const partes = Object.fromEntries(calendario.formatToParts(ahora).map(p => [p.type, p.value]));
  const dia = partes.year + '-' + partes.month + '-' + partes.day;
  const contador = raiz.collection('usoIndexacion').doc(dia);
  const reserva = raiz.collection('reservasIndexacion').doc(id + '-v' + version);
  return db.runTransaction(async tx => {
    const [conteoSnap, reservaSnap] = await Promise.all([tx.get(contador), tx.get(reserva)]);
    if (reservaSnap.exists) {
      const edad = ahora.getTime() - Date.parse(reservaSnap.data().fechaEn);
      if (edad < 15000) throw error(409, 'Esta versión se está indexando. Intenta de nuevo en unos segundos.');
      return false;
    }
    const total = conteoSnap.data()?.total || 0;
    if (total >= limite) return false;
    tx.set(reserva, { fechaEn: ahora.toISOString() });
    tx.set(contador, { total: total + 1 });
    return true;
  });
}

function terminosIndice(revision) {
  const pesos = new Map();
  for (const p of tokenizar(revision.titulo + ' ' + revision.especialidad)) pesos.set(p, 100);
  for (const p of tokenizar(revision.texto)) pesos.set(p, (pesos.get(p) || 0) + 1);
  return [...pesos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 700).map(([p]) => p);
}

async function cambiarEstado(db, id, body, admin) {
  const { accion, versionEsperada } = body;
  if (!['aprobar', 'rechazar', 'desactivar', 'eliminar'].includes(accion) || !Number.isSafeInteger(versionEsperada)) {
    throw error(400, 'Indica una acción y versión válidas');
  }
  const ruta = refs(db, id);
  const fuente = (await ruta.fuente.get()).data();
  if (!fuente || fuente.estado === 'eliminado') throw error(404, 'Fuente no encontrada');
  if (fuente.version !== versionEsperada) throw error(409, 'La fuente cambió. Recarga para guardar.');
  if ((accion === 'aprobar' || accion === 'rechazar') && fuente.estado !== 'pendiente') {
    throw error(409, 'Sólo se revisan versiones pendientes');
  }
  const version = fuente.version;
  const aprobar = accion === 'aprobar';
  const revision = (await ruta.revision(version).get()).data();
  if (!revision?.texto || !revision.autorizado) throw error(409, 'Esta revisión quedó incompleta');
  let vector = null;
  let config = null;
  if (aprobar) {
    validarContenidoSeguro(revision.texto);
    config = revision.permitirModeloExterno && revision.visibilidad === 'alumnos' ? configEmbeddings() : null;
    if (config && await reservarIndexacion(db, id, version)) {
      vector = await vectorizar(revision.titulo + '\n' + revision.texto.slice(0, 5000), config);
    }
  }
  const usuario = identidad(admin);
  const fechaEn = new Date().toISOString();
  const estados = { aprobar: 'aprobado', rechazar: 'rechazado', desactivar: 'desactivado', eliminar: 'eliminado' };
  const estado = estados[accion];
  const ocultar = accion === 'desactivar' || accion === 'eliminar';
  const estadoIndice = aprobar
    ? (revision.visibilidad === 'privada' ? 'desactivado' : (vector ? 'semantico' : 'lexico'))
    : (ocultar ? 'desactivado' : 'pendiente');
  return db.runTransaction(async tx => {
    const vigente = (await tx.get(ruta.fuente)).data();
    if (vigente?.version !== version || vigente?.estado !== fuente.estado) throw error(409, 'La fuente cambió. Recarga para guardar.');
    const actualizado = {
      ...vigente, estado, indice: estadoIndice,
      versionActiva: aprobar ? version : (ocultar ? null : vigente.versionActiva),
      actualizadoEn: fechaEn, actualizadoPor: usuario,
      aprobadoPor: aprobar ? usuario : vigente.aprobadoPor,
      aprobadoEn: aprobar ? fechaEn : vigente.aprobadoEn,
      historial: registrarCambio(vigente.historial, { version, accion, estado, por: usuario, motivo: breve(body.motivo, 500), fechaEn })
    };
    tx.set(ruta.fuente, actualizado);
    if (accion === 'eliminar') {
      for (let n = 1; n <= version; n++) tx.set(ruta.revision(n), { estado, version: n, eliminadoEn: fechaEn });
    } else {
      tx.set(ruta.revision(version), { estado, actualizadoEn: fechaEn, actualizadoPor: usuario }, { merge: true });
    }
    if (aprobar && revision.visibilidad === 'alumnos') {
      tx.set(ruta.indice, {
        activa: true, version, titulo: revision.titulo, cursoSlug: revision.cursoSlug,
        permitirModeloExterno: revision.permitirModeloExterno, terminos: terminosIndice(revision),
        ...(vector ? { vector, modelo: config.model } : {})
      });
    } else if (aprobar || ocultar) {
      tx.set(ruta.indice, { activa: false });
    }
    return { id, ...actualizado, ...(accion === 'eliminar' ? {} : { texto: revision.texto }) };
  });
}

function aproximacion(a, b) {
  const similitud = a.reduce((suma, x, i) => suma + x * b[i], 0);
  const divisor = Math.hypot(...a) * Math.hypot(...b);
  return divisor ? similitud / divisor : 0;
}

function puntajeLexico(terminos, tokens) {
  const conjunto = new Set(terminos);
  return tokens.reduce((suma, token) => suma + Number(conjunto.has(token)), 0);
}

function fragmentar(texto) {
  const fragmentos = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + 1200);
    if (fin < texto.length) {
      const corte = texto.lastIndexOf(' ', fin);
      if (corte > inicio + 900) fin = corte;
    }
    fragmentos.push(texto.slice(inicio, fin).trim());
    inicio = fin === texto.length ? fin : fin - 100;
  }
  return fragmentos;
}

async function buscarConocimientoGallo(db, { pregunta, cursoSlug, requiereEnvioExterno = true, semantica = false }) {
  const consulta = breve(pregunta, 900);
  const tokens = [...new Set(tokenizar(consulta))].slice(0, 30);
  if (!tokens.length) return [];
  const config = semantica === true && requiereEnvioExterno ? configEmbeddings() : null;
  const indices = refs(db).indices;
  const busquedas = [indices.where('terminos', 'array-contains-any', tokens).limit(INDICES_MAX).get()];
  if (config) busquedas.push(indices.where('modelo', '==', config.model).limit(INDICES_MAX).get());
  const resultados = await Promise.all(busquedas);
  const unicas = new Map(resultados.flatMap(snap => snap.docs).map(doc => [doc.id, { ...doc.data(), id: doc.id }]));
  const fuentes = [...unicas.values()].filter(f => f.activa === true &&
    (!f.cursoSlug || f.cursoSlug === cursoSlug) && (!requiereEnvioExterno || f.permitirModeloExterno === true));
  const vector = config && fuentes.some(f => f.modelo === config.model) ? await vectorizar(consulta, config) : null;
  const candidatas = fuentes.map(f => {
    const lexico = puntajeLexico(f.terminos, tokens);
    const similar = vector && f.modelo === config.model && Array.isArray(f.vector) && f.vector.length === vector.length
      ? aproximacion(vector, f.vector) : 0;
    return { ...f, lexico, similar, puntaje: (lexico * 2) + (similar > 0.55 ? similar * 3 : 0) };
  }).filter(f => f.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje).slice(0, 5);
  const documentos = await Promise.all(candidatas.map(async f => {
    const ruta = refs(db, f.id);
    const [fuenteSnap, revisionSnap] = await Promise.all([ruta.fuente.get(), ruta.revision(f.version).get()]);
    const fuente = fuenteSnap.data();
    const revision = revisionSnap.data();
    if (fuente?.versionActiva !== f.version || revision?.estado !== 'aprobado' || revision.visibilidad !== 'alumnos' ||
        !revision.texto || !revision.autorizado || (revision.cursoSlug && revision.cursoSlug !== cursoSlug) ||
        (requiereEnvioExterno && revision.permitirModeloExterno !== true)) return null;
    try { validarContenidoSeguro(revision.texto); } catch (_) { return null; }
    const mejor = fragmentar(revision.texto).map((texto, i) => ({ texto, i, score: puntajeLexico(tokenizar(texto), tokens) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!mejor) return null;
    return {
      id: f.id + '-v' + f.version + '-f' + mejor.i,
      titulo: revision.titulo, texto: mejor.texto,
      autor: revision.autor, fecha: revision.fecha, version: String(f.version),
      ...(revision.url ? { url: revision.url } : {})
    };
  }));
  return documentos.filter(Boolean);
}

function registrarConocimientoGallo(app, { db, adminRequerido, log = console }) {
  const base = '/admin/gallo/conocimiento';
  function ruta(fn) {
    return async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const admin = await adminRequerido(req, res);
        if (!admin) return;
        if (req.params?.id) validarId(req.params.id);
        await fn(req, res, admin);
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message, ...err.datos });
        log.error('Error en Centro de Conocimiento:', err.code || err.name);
        return res.status(500).json({ error: 'No pudimos procesar la fuente' });
      }
    };
  }

  app.get(base, ruta(async (_req, res) => {
    const snap = await refs(db).fuentes.orderBy('actualizadoEn', 'desc').limit(201).get();
    const fuentes = snap.docs.filter(doc => doc.data().estado !== 'eliminado').slice(0, 200)
      .map(doc => {
        const { historial, ...metadata } = doc.data();
        return { id: doc.id, ...metadata };
      });
    res.json({ fuentes, truncado: snap.docs.length > 200 });
  }));
  app.get(base + '/:id', ruta(async (req, res) => {
    const rutaFuente = refs(db, req.params.id);
    const fuente = (await rutaFuente.fuente.get()).data();
    if (!fuente || fuente.estado === 'eliminado') throw error(404, 'Fuente no encontrada');
    const { texto, pregunta, respuesta, archivoNombre, url } = (await rutaFuente.revision(fuente.version).get()).data() || {};
    res.json({ fuente: { id: req.params.id, ...fuente, texto, pregunta, respuesta, archivoNombre, url } });
  }));
  app.post(base, ruta(async (req, res, admin) => {
    res.status(201).json({ fuente: await guardarRevision(db, null, req.body || {}, admin) });
  }));
  app.post(base + '/:id/revisiones', ruta(async (req, res, admin) => {
    res.status(201).json({ fuente: await guardarRevision(db, req.params.id, req.body || {}, admin) });
  }));
  app.post(base + '/:id/estado', ruta(async (req, res, admin) => {
    res.json({ fuente: await cambiarEstado(db, req.params.id, req.body || {}, admin) });
  }));
}

module.exports = { buscarConocimientoGallo, registrarConocimientoGallo };

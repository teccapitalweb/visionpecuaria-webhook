const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { quitarDatosPersonales } = require('./gallo-motor');

const ORGANIZACION = 'vision-pecuaria';
const CURSOS = new Set(['gallinas-de-postura', 'embutidos-artesanales', 'sexaje-avicola']);
const RETENCION_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
const RETENCION_MS = RETENCION_DIAS * DIA_MS;
const MAX_MENSAJES = 24;
const sha256 = valor => createHash('sha256').update(String(valor)).digest('hex');

function sanearTexto(valor, maximo) {
  return String(valor || '').slice(0, maximo).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

function ocultarDatos(texto) {
  return quitarDatosPersonales(texto)
    .replace(/\b[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}\b/gi, '[correo omitido]')
    .replace(/(?:\+?\d[\s.()-]*){10,19}(?!\d)/g, '[número omitido]')
    .replace(/\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{18,}\b|\b(?:password|contrase(?:ñ|n)a|token)\s*[:=]\s*\S+/gi, '[dato omitido]');
}

const aMs = fecha => typeof fecha?.toMillis === 'function' ? fecha.toMillis() : new Date(fecha).getTime();
const cursoValido = slug => typeof slug === 'string' && CURSOS.has(slug);

function fuentesGuardables(fuentes) {
  if (!Array.isArray(fuentes)) return [];
  return fuentes.slice(0, 6).filter(f => f && typeof f.titulo === 'string').map(f => {
    const dato = { titulo: sanearTexto(f.titulo, 200) };
    for (const campo of ['id', 'autor', 'fecha', 'version']) {
      if (f[campo]) dato[campo] = sanearTexto(f[campo], 140);
    }
    try {
      const url = new URL(f.url);
      if (url.protocol === 'https:' && !url.username && !url.password && url.href.length < 900) dato.url = url.href;
    } catch (_) { /* Fuente sin enlace consultable. */ }
    return dato;
  });
}

function crearMemoriaGallo(db, {
  ahora = Date.now, secreto = process.env.GALLO_SIGNING_SECRET || randomBytes(32), retencionHabilitada = true
} = {}) {
  const memoria = db.collection('galloIAMemoria');
  const calidad = db.collection('galloIACalidad');
  const referencia = (uid, slug) => memoria.doc(sha256([ORGANIZACION, uid, slug].join('|')));
  const owner = uid => sha256(ORGANIZACION + '|' + uid);
  const valida = (dato, uid, slug, ms) => dato?.org === ORGANIZACION && dato.propietario === owner(uid) &&
    dato.cursoSlug === slug && aMs(dato.venceEn) > ms && typeof dato.generacion === 'string';

  function firmar(data) {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return payload + '.' + createHmac('sha256', secreto).update(payload).digest('base64url');
  }

  function verificar(turnoId, uid, slug) {
    if (typeof turnoId !== 'string' || turnoId.length > 1100 || !/^[\w-]+\.[\w-]{43}$/.test(turnoId)) return null;
    const [payload, firma] = turnoId.split('.');
    const provista = Buffer.from(firma, 'base64url');
    const original = createHmac('sha256', secreto).update(payload).digest();
    if (provista.length !== original.length || !timingSafeEqual(provista, original)) return null;
    let dato;
    try { dato = JSON.parse(Buffer.from(payload, 'base64url')); } catch (_) { return null; }
    if (dato.org !== ORGANIZACION || dato.p !== owner(uid) || dato.s !== slug ||
        !Number.isSafeInteger(dato.t) || dato.t > ahora() || ahora() - dato.t > DIA_MS) return null;
    return dato;
  }

  async function leerContexto(uid, slug) {
    const dato = (await referencia(uid, slug).get()).data();
    if (!valida(dato, uid, slug, ahora())) return { generacion: null, mensajes: [], venceEn: null };
    return { generacion: dato.generacion, mensajes: dato.mensajes || [],
      venceEn: new Date(aMs(dato.venceEn)).toISOString() };
  }

  async function activar(uid, slug) {
    const ref = referencia(uid, slug);
    const ms = ahora();
    await db.runTransaction(async tx => {
      const dato = (await tx.get(ref)).data();
      if (valida(dato, uid, slug, ms)) return;
      tx.set(ref, {
        org: ORGANIZACION, propietario: owner(uid), cursoSlug: slug, generacion: randomUUID(), mensajes: [],
        autorizadoEn: new Date(ms), venceEn: new Date(ms + RETENCION_MS)
      });
    });
    return leerContexto(uid, slug);
  }

  async function borrar(uid, slug) {
    await referencia(uid, slug).delete();
  }

  async function guardarTurno(uid, slug, generacion, resultado) {
    if (!retencionHabilitada) return null;
    const ms = ahora();
    const pregunta = sanearTexto(resultado.mensaje, 1000);
    const respuesta = sanearTexto(resultado.respuesta, 8000);
    const recibo = {
      org: ORGANIZACION, p: owner(uid), s: slug, t: ms, n: randomUUID(), qh: sha256(pregunta), rh: sha256(respuesta),
      v: sanearTexto(resultado.version, 80), m: sanearTexto(resultado.modo, 30), e: resultado.sinEvidencia === true
    };
    const turnoId = firmar(recibo);
    const tareas = [];
    if (generacion) {
      const ref = referencia(uid, slug);
      tareas.push(db.runTransaction(async tx => {
        const dato = (await tx.get(ref)).data();
        if (!valida(dato, uid, slug, ms) || dato.generacion !== generacion) return;
        const nuevos = [
          { rol: 'usuario', texto: ocultarDatos(pregunta) },
          { rol: 'asistente', texto: ocultarDatos(respuesta), modo: recibo.m, turnoId, fuentes: fuentesGuardables(resultado.fuentes) }
        ];
        tx.set(ref, { mensajes: [...(dato.mensajes || []), ...nuevos].slice(-MAX_MENSAJES),
          venceEn: new Date(ms + RETENCION_MS) }, { merge: true });
      }));
    }
    if (recibo.e) {
      tareas.push(calidad.doc(sha256(turnoId)).set(filaBase(recibo), { merge: true }));
    }
    await Promise.all(tareas);
    return turnoId;
  }

  function filaBase(recibo) {
    return { org: ORGANIZACION, cursoSlug: recibo.s, version: recibo.v, modo: recibo.m,
      sinEvidencia: recibo.e, creadoEn: new Date(recibo.t).toISOString(), venceEn: new Date(recibo.t + RETENCION_MS) };
  }

  async function valorar(uid, entrada) {
    if (!retencionHabilitada) return false;
    const { cursoSlug, turnoId, voto, compartir } = entrada;
    const recibido = verificar(turnoId, uid, cursoSlug);
    if (!recibido || !['util', 'no_util'].includes(voto) || (compartir !== undefined && typeof compartir !== 'boolean')) return false;
    const datos = { ...filaBase(recibido), voto };
    if (compartir === true) {
      const pregunta = sanearTexto(entrada.pregunta, 1000);
      const respuesta = sanearTexto(entrada.respuesta, 8000);
      if (sha256(pregunta) !== recibido.qh || sha256(respuesta) !== recibido.rh) return false;
      datos.pregunta = ocultarDatos(pregunta);
      datos.respuesta = ocultarDatos(respuesta);
    }
    // Reemplazar una valoración también permite retirar el texto previamente compartido.
    await calidad.doc(sha256(turnoId)).set(datos);
    return true;
  }

  async function listarCalidad() {
    const limite = ahora() - RETENCION_MS;
    const snap = await calidad.orderBy('creadoEn', 'desc').limit(100).get();
    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(d => d.org === ORGANIZACION && Date.parse(d.creadoEn) > limite)
      .map(({ id, voto, pregunta, respuesta, sinEvidencia, modo, version, creadoEn, cursoSlug }) =>
        ({ id, voto: voto || null, pregunta, respuesta, sinEvidencia, modo, version, creadoEn, cursoSlug }));
    const conteos = { util: 0, no_util: 0, sinEvidencia: 0 };
    for (const item of items) {
      if (item.voto) conteos[item.voto]++;
      if (item.sinEvidencia) conteos.sinEvidencia++;
    }
    return { items, conteos, retencionDias: RETENCION_DIAS };
  }

  return { leerContexto, activar, borrar, guardarTurno, valorar, listarCalidad, retencionHabilitada };
}

function registrarMemoriaGallo(app, { memoria, tokenRequerido, accesoA, adminRequerido,
  modeloDisponible = () => false, leerConsumo = async () => null, log = console }) {
  const ruta = '/alumno/gallo-ia/memoria';
  const vista = contexto => ({
    activada: Boolean(contexto.generacion), mensajes: contexto.mensajes,
    venceEn: contexto.venceEn, retencionDias: RETENCION_DIAS, modeloDisponible: Boolean(modeloDisponible()),
    retencionDisponible: memoria.retencionHabilitada
  });
  const privado = (fn) => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { return await fn(req, res); }
    catch (e) {
      log.error('Mi Gallo IA: memoria o calidad no disponible', e.code || e.name);
      return res.status(500).json({ error: 'No pudimos completar esta acción. Intenta otra vez.' });
    }
  };
  async function permiso(req, res, slug, necesitaAcceso = true) {
    const usuario = await tokenRequerido(req, res);
    if (!usuario) return null;
    if (!cursoValido(slug)) { res.status(400).json({ error: 'Curso inválido.' }); return null; }
    if (necesitaAcceso) {
      const acceso = await accesoA(usuario, slug);
      if (!acceso || acceso.revocado) { res.status(403).json({ error: 'Sin acceso a este curso.' }); return null; }
    }
    return usuario;
  }
  app.get(ruta, privado(async (req, res) => {
    const slug = req.query.cursoSlug;
    const usuario = await permiso(req, res, slug);
    if (usuario) return res.json(vista(await memoria.leerContexto(usuario.uid, slug)));
  }));
  app.put(ruta, privado(async (req, res) => {
    const { cursoSlug, activar } = req.body || {};
    if (activar !== true) return res.status(400).json({ error: 'Confirma si quieres guardar el historial.' });
    const usuario = await permiso(req, res, cursoSlug);
    if (!usuario) return;
    if (!memoria.retencionHabilitada) return res.status(503).json({ error: 'El historial todavía no está disponible.' });
    return res.json(vista(await memoria.activar(usuario.uid, cursoSlug)));
  }));
  app.delete(ruta, privado(async (req, res) => {
    const slug = req.query.cursoSlug;
    const usuario = await permiso(req, res, slug, false);
    if (!usuario) return;
    await memoria.borrar(usuario.uid, slug);
    return res.status(204).end();
  }));
  app.post('/alumno/gallo-ia/valorar', privado(async (req, res) => {
    const slug = req.body?.cursoSlug;
    const usuario = await permiso(req, res, slug);
    if (!usuario) return;
    if (!await memoria.valorar(usuario.uid, req.body)) return res.status(400).json({ error: 'La respuesta o la valoración ya no es válida.' });
    return res.status(204).end();
  }));
  app.get('/admin/gallo-ia/calidad', privado(async (req, res) => {
    if (!await adminRequerido(req, res)) return;
    const [calidad, consumo] = await Promise.all([memoria.listarCalidad(), leerConsumo()]);
    return res.json({ ...calidad, ...(consumo ? { consumo } : {}) });
  }));
}

module.exports = { crearMemoriaGallo, registrarMemoriaGallo, ocultarDatos };

// ═════════════════════════════════════════════════════════════════════════════
// VISIÓN PECUARIA · Aula del alumno (compras individuales de cursos)
//
// Todo lo que el alumno ve de un curso comprado pasa por aquí, con el token de
// Firebase Auth. Reglas de negocio:
//
//   · Un curso individual se ve si existe accesosCurso/{uid}/cursos/{slug}
//     activo, o si el alumno tiene el CORREO VERIFICADO y hay una compra
//     confirmada en comprasCurso con ese mismo correo. En ese caso el acceso
//     se materializa (idempotente) bajo su uid real.
//   · La membresía Élite Pecuario NO desbloquea cursos individuales y una
//     compra individual NO activa la membresía. Solo se informa el estado.
//   · Un acceso revocado por un admin (revocado:true) nunca se re-otorga solo.
//   · Las fuentes de video/materiales nunca viajan en el listado: se piden una
//     por una con /video y /material, después de verificar el derecho.
//   · El progreso vive en progresoCurso/{uid}/cursos/{slug} y se fusiona sin
//     retroceder (segundos = máximo, completada nunca vuelve a false, la
//     "última clase" solo cambia con una marca de tiempo más nueva).
// ═════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const BUCKET_DEFAULT = 'visionpecuaria-vip.firebasestorage.app';
const URL_FIRMADA_MS = 2 * 60 * 60 * 1000; // 2 h

function uidSintetico(email) {
  // Mismo cálculo que la landing de Gallinas (checkout sin sesión)
  const hex = crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex');
  return 'ipcil-' + hex.substring(0, 24);
}

function driveId(url) {
  if (!url) return null;
  const m1 = String(url).match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const m2 = String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return (m1 && m1[1]) || (m2 && m2[1]) || null;
}

function urlEmbebible(url) {
  if (!url) return null;
  const id = driveId(url);
  if (id && /drive\.google\.com/.test(url)) return `https://drive.google.com/file/d/${id}/preview`;
  const yt = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const vimeo = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  if (/^https:\/\//.test(url)) return url;
  return null;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Video de Bunny Stream guardado en la clase: { bunny: { biblioteca, id, cdn? } }
function bunnyDe(c) {
  const b = c && c.bunny;
  if (!b || !GUID_RE.test(String(b.id || '')) || !/^\d{1,10}$/.test(String(b.biblioteca || ''))) return null;
  const cdn = /^[a-z0-9-]+\.b-cdn\.net$/i.test(String(b.cdn || '')) ? String(b.cdn) : null;
  return { biblioteca: String(b.biblioteca), id: String(b.id).toLowerCase(), cdn };
}

// URL del reproductor de Bunny; si hay llave de "Embed view token authentication", va firmada
function urlBunny(b, llave, ahoraMs = Date.now(), ttlSeg = 4 * 3600) {
  const base = `https://iframe.mediadelivery.net/embed/${b.biblioteca}/${b.id}`;
  const q = ['autoplay=false', 'preload=true', 'responsive=true'];
  if (llave) {
    const expires = Math.floor(ahoraMs / 1000) + ttlSeg;
    const token = crypto.createHash('sha256').update(llave + b.id + expires).digest('hex');
    q.unshift(`token=${token}`, `expires=${expires}`);
  }
  return `${base}?${q.join('&')}`;
}

// Normaliza el arreglo de clases de cursosVenta (los tres esquemas que existen:
// admin Drive → embedUrl/driveUrl, setup Gallinas → url, Storage → storagePath)
function normalizarClases(clasesRaw) {
  const lista = (Array.isArray(clasesRaw) ? clasesRaw : [])
    .map((c, i) => ({ c: c || {}, i }))
    .sort((a, b) => ((a.c.orden ?? a.i + 1) - (b.c.orden ?? b.i + 1)) || (a.i - b.i));
  const vistos = new Set();
  return lista.map(({ c, i }, pos) => {
    let id = String(c.id || c.claseId || `c${c.orden ?? i + 1}`);
    while (vistos.has(id)) id = id + '-' + (pos + 1);
    vistos.add(id);
    const bunny = bunnyDe(c);
    const fuente = bunny || c.storagePath || c.embedUrl || c.url || c.driveUrl || null;
    const did = bunny ? null : driveId(c.driveUrl || c.embedUrl || c.url);
    const pendiente = c.estado === 'pendiente' || c.publicada === false || !fuente;
    return {
      id,
      orden: c.orden ?? pos + 1,
      titulo: c.titulo || `Clase ${pos + 1}`,
      modulo: c.modulo || null,
      descripcion: c.descripcion || '',
      duracionMin: Number(c.duracionMin) || null,
      fechaEnVivo: c.fechaEnVivo || null,
      miniatura: c.posterPath || c.miniatura || (bunny && bunny.cdn ? `https://${bunny.cdn}/${bunny.id}/thumbnail.jpg` : null) || (did ? `https://drive.google.com/thumbnail?id=${did}&sz=w960` : null),
      estado: pendiente ? 'pendiente' : 'publicada',
      materialesIds: Array.isArray(c.materialesIds) ? c.materialesIds.map(String) : [],
      _raw: c
    };
  });
}

function normalizarMateriales(recursosRaw) {
  return (Array.isArray(recursosRaw) ? recursosRaw : []).map((r, i) => {
    r = r || {};
    const tipo = String(r.tipo || '').toLowerCase() || (/\.xlsx?($|\?)/i.test(r.url || '') ? 'xlsx' : 'pdf');
    return {
      id: String(r.id || `m${i + 1}`),
      titulo: r.titulo || 'Material',
      descripcion: r.descripcion || '',
      tipo,
      claseId: r.claseId ? String(r.claseId) : null,
      disponible: !!(r.storagePath || r.url || r.driveUrl),
      _raw: r
    };
  });
}

const sinRaw = (o) => { const { _raw, ...rest } = o; return rest; };

function fusionarProgreso(actual, entrada) {
  const prog = {
    clases: { ...((actual && actual.clases) || {}) },
    ultimaClaseId: (actual && actual.ultimaClaseId) || null,
    ultimaActividadTs: Number(actual && actual.ultimaActividadTs) || 0
  };
  const id = entrada.claseId;
  const prev = prog.clases[id] || { segundos: 0, completada: false };
  const segundos = Math.max(Number(prev.segundos) || 0, Math.min(Number(entrada.segundos) || 0, 6 * 3600));
  const posicion = Number.isFinite(Number(entrada.posicion)) ? Number(entrada.posicion) : (prev.posicion || 0);
  const ts = Number(entrada.clientTs) || Date.now();
  prog.clases[id] = {
    segundos,
    completada: prev.completada === true || entrada.completada === true,
    // la posición solo se acepta si viene de una acción más nueva
    posicion: ts >= (Number(prev.ts) || 0) ? posicion : (prev.posicion || 0),
    ts: Math.max(Number(prev.ts) || 0, ts)
  };
  if (ts >= prog.ultimaActividadTs) {
    prog.ultimaClaseId = id;
    prog.ultimaActividadTs = ts;
  }
  return prog;
}

function resumenProgreso(prog, clases) {
  const publicadas = clases.filter(c => c.estado === 'publicada');
  const completadas = publicadas.filter(c => prog?.clases?.[c.id]?.completada).length;
  return {
    completadas,
    total: publicadas.length,
    porcentaje: publicadas.length ? Math.round((completadas / publicadas.length) * 100) : 0,
    ultimaClaseId: prog?.ultimaClaseId || null
  };
}

function membresiaVigente(datos) {
  if (!datos) return false;
  if (datos.estado === 'activo') return true;
  const f = datos.fechaFin;
  const fin = f && (typeof f.toDate === 'function' ? f.toDate() : new Date(f.seconds ? f.seconds * 1000 : f));
  return datos.cancelado === true && fin && fin > new Date();
}

function registrarRutasAlumno(app, { admin, db, auth, stripe, bucketName = BUCKET_DEFAULT, log = console, bunnyLlave = process.env.BUNNY_TOKEN_AUTH_KEY || process.env.BUNNY_TOKEN_KEY || '' }) {

  async function tokenRequerido(req, res) {
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) { res.status(401).json({ error: 'Sesión requerida' }); return null; }
    try { return await auth.verifyIdToken(token); }
    catch (e) { res.status(401).json({ error: 'Sesión inválida o vencida' }); return null; }
  }

  async function adminRequerido(req, res) {
    const u = await tokenRequerido(req, res);
    if (!u) return null;
    const a = await db.collection('admins').doc(u.uid).get();
    if (!a.exists) { res.status(403).json({ error: 'Solo administradores' }); return null; }
    return u;
  }

  async function auditar(adminUser, accion, datos) {
    await db.collection('auditoriaCursos').add({
      accion,
      ...datos,
      adminUid: adminUser.uid,
      adminEmail: adminUser.email || null,
      fecha: new Date().toISOString()
    });
  }

  async function leerCurso(slug) {
    const snap = await db.collection('cursosVenta').doc(slug).get();
    if (!snap.exists) return null;
    const curso = snap.data() || {};
    // Contenido privado opcional: si existe, manda sobre lo público
    try {
      const priv = await db.collection('cursosContenidoPrivado').doc(slug).get();
      if (priv.exists) {
        const p = priv.data() || {};
        if (Array.isArray(p.clases)) curso.clases = p.clases;
        if (Array.isArray(p.recursosDescargables)) curso.recursosDescargables = p.recursosDescargables;
      }
    } catch (e) { /* opcional */ }
    return curso;
  }

  async function compraEstaPagada(compra) {
    if (compra.estado === 'confirmado') return true;
    if (compra.estado === 'pendiente' && compra.sessionId && stripe) {
      try {
        const s = await stripe.checkout.sessions.retrieve(compra.sessionId);
        if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') {
          await db.collection('comprasCurso').doc(compra.sessionId).set({ estado: 'confirmado', confirmadoEn: new Date().toISOString() }, { merge: true });
          return true;
        }
      } catch (e) { log.warn('No se pudo revisar compra pendiente:', e.message); }
    }
    return false;
  }

  // Devuelve { slug: datosAcceso } con los cursos individuales vigentes del usuario
  async function resolverDerechos(u) {
    const ref = db.collection('accesosCurso').doc(u.uid);
    const snap = await ref.collection('cursos').get();
    const directos = {};
    snap.docs.forEach(d => { directos[d.id] = d.data() || {}; });

    const vigentes = {};
    for (const [slug, a] of Object.entries(directos)) {
      if (a.activo === true || a.estado === 'activo') vigentes[slug] = a;
    }

    const email = (u.email || '').toLowerCase().trim();
    if (!email || u.email_verified !== true) return vigentes;

    const compras = await db.collection('comprasCurso').where('email', '==', email).get();
    for (const d of compras.docs) {
      const c = { sessionId: d.id, ...(d.data() || {}) };
      if (!c.slug || vigentes[c.slug]) continue;
      if (directos[c.slug] && directos[c.slug].revocado === true) continue;
      if (!(await compraEstaPagada(c))) continue;
      const acceso = {
        slug: c.slug,
        email,
        nombre: c.nombre || '',
        activo: true,
        estado: 'activo',
        fechaCompra: c.fechaCompra || null,
        stripeSessionId: c.sessionId,
        montoPagadoCentavos: c.montoPagadoCentavos || 0,
        origen: 'conciliacion-correo-verificado',
        conciliadoEn: new Date().toISOString()
      };
      await ref.collection('cursos').doc(c.slug).set(acceso, { merge: true });
      await ref.set({ email, ultimaActualizacion: acceso.conciliadoEn }, { merge: true });
      if (c.uid !== u.uid) {
        await db.collection('comprasCurso').doc(c.sessionId).set({ uidVinculado: u.uid }, { merge: true });
      }
      vigentes[c.slug] = acceso;
      log.log(`🔗 Acceso conciliado por correo verificado: ${c.slug} → ${u.uid}`);
    }
    return vigentes;
  }

  async function accesoA(u, slug) {
    const d = await db.collection('accesosCurso').doc(u.uid).collection('cursos').doc(slug).get();
    if (d.exists) {
      const a = d.data() || {};
      if (a.activo === true || a.estado === 'activo') return a;
      if (a.revocado === true) return null;
    }
    const todos = await resolverDerechos(u);
    return todos[slug] || null;
  }

  async function leerProgreso(uid, slug) {
    const p = await db.collection('progresoCurso').doc(uid).collection('cursos').doc(slug).get();
    return p.exists ? p.data() : null;
  }

  async function urlFirmada(path) {
    const [url] = await admin.storage().bucket(bucketName).file(path).getSignedUrl({
      action: 'read', expires: Date.now() + URL_FIRMADA_MS
    });
    return url;
  }

  async function estadoCertificado(u, slug) {
    const email = (u.email || '').toLowerCase().trim();
    try {
      let snap = await db.collection('certificados').where('uid', '==', u.uid).where('cursoSlug', '==', slug).limit(1).get();
      if (snap.empty && email && u.email_verified === true) {
        snap = await db.collection('certificados').where('email', '==', email).where('cursoSlug', '==', slug).limit(1).get();
      }
      if (!snap.empty) {
        const c = snap.docs[0].data() || {};
        return { estado: 'emitido', folio: c.folio || null, url: c.folio ? `/ver-certificado.html?folio=${encodeURIComponent(c.folio)}` : null };
      }
    } catch (e) { log.warn('estadoCertificado:', e.message); }
    return { estado: 'pendiente', folio: null, url: null };
  }

  // ─── ALUMNO ────────────────────────────────────────────────────────────────
  app.get('/alumno/estado', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const derechos = await resolverDerechos(u);
      const cursos = [];
      for (const [slug, a] of Object.entries(derechos)) {
        const curso = await leerCurso(slug);
        if (!curso) continue;
        const clases = normalizarClases(curso.clases);
        const prog = await leerProgreso(u.uid, slug);
        cursos.push({
          slug,
          nombre: curso.nombre || curso.titulo || slug,
          subtitulo: curso.subtitulo || '',
          instructorNombre: curso.instructorNombre || '',
          portada: curso.posterPath || curso.portadaUrl || null,
          fechaCompra: a.fechaCompra || null,
          totalClases: clases.length,
          progreso: resumenProgreso(prog, clases)
        });
      }
      cursos.sort((x, y) => String(y.fechaCompra || '').localeCompare(String(x.fechaCompra || '')));

      let elite = { vigente: false };
      try {
        const m = await db.collection('miembros').doc(u.uid).get();
        if (m.exists) {
          const md = m.data() || {};
          elite = { vigente: membresiaVigente(md), plan: md.plan || null, vence: md.vence || null };
        }
      } catch (e) { /* informativo */ }

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        usuario: { email: u.email || null, verificado: u.email_verified === true },
        cursos,
        elite
      });
    } catch (err) {
      log.error('❌ /alumno/estado:', err);
      res.status(500).json({ error: 'No pudimos cargar tus cursos' });
    }
  });

  app.get('/alumno/curso/:slug', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      const acceso = await accesoA(u, slug);
      if (!acceso) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const curso = await leerCurso(slug);
      if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });

      const clases = normalizarClases(curso.clases);
      const materiales = normalizarMateriales(curso.recursosDescargables);
      const prog = await leerProgreso(u.uid, slug);
      const certificado = await estadoCertificado(u, slug);
      let solicitudCertificado = null;
      try {
        const sol = await db.collection('solicitudesCertificado').doc(`${u.uid}_${slug}`).get();
        if (sol.exists) {
          const sd = sol.data() || {};
          solicitudCertificado = { estado: sd.estado || 'pendiente', fechaSolicitud: sd.fechaSolicitud || null, nombreCompleto: sd.nombreCompleto || '', whatsapp: sd.whatsapp || '', estadoRep: sd.estadoRep || '', ciudad: sd.ciudad || '' };
        }
      } catch (e) { log.warn('solicitudCertificado:', e.message); }

      let calificaciones = { promedio: 0, total: 0, mia: null };
      try {
        const cs = await db.collection('calificacionesCurso').where('slug', '==', slug).get();
        const todas = cs.docs.map(d => d.data() || {}).filter(c => Number(c.estrellas) >= 1 && Number(c.estrellas) <= 5);
        const mia = todas.find(c => c.uid === u.uid) || null;
        calificaciones = {
          promedio: todas.length ? Math.round(todas.reduce((a, c) => a + Number(c.estrellas), 0) / todas.length * 10) / 10 : 0,
          total: todas.length,
          mia: mia ? { estrellas: Number(mia.estrellas), comentario: mia.comentario || '' } : null
        };
      } catch (e) { log.warn('calificaciones:', e.message); }

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        calificaciones,
        curso: {
          slug,
          nombre: curso.nombre || curso.titulo || slug,
          subtitulo: curso.subtitulo || '',
          descripcion: curso.descripcion || '',
          instructorNombre: curso.instructorNombre || '',
          portada: curso.posterPath || curso.portadaUrl || null,
          modalidad: curso.modalidad || null,
          duracionHoras: curso.duracionHoras || null,
          temario: Array.isArray(curso.temario) ? curso.temario.map(t => ({ n: t.n, titulo: t.titulo })) : [],
          claseEnVivo: curso.linkClaseEnVivo ? { url: curso.linkClaseEnVivo, fecha: curso.fechaClaseEnVivo || null } : null
        },
        acceso: { fechaCompra: acceso.fechaCompra || null },
        clases: clases.map(sinRaw),
        materiales: materiales.map(sinRaw),
        progreso: {
          clases: (prog && prog.clases) || {},
          ...resumenProgreso(prog, clases)
        },
        certificado,
        solicitudCertificado
      });
    } catch (err) {
      log.error('❌ /alumno/curso:', err);
      res.status(500).json({ error: 'No pudimos cargar el curso' });
    }
  });

  app.post('/alumno/curso/:slug/video', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      if (!(await accesoA(u, slug))) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const curso = await leerCurso(slug);
      const clase = normalizarClases(curso && curso.clases).find(c => c.id === String(req.body?.claseId || ''));
      if (!clase) return res.status(404).json({ error: 'Clase no encontrada' });
      if (clase.estado !== 'publicada') return res.status(409).json({ error: 'Esta grabación aún no está publicada' });
      const r = clase._raw;
      const bunny = bunnyDe(r);
      if (bunny) {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ tipo: 'iframe', proveedor: 'bunny', url: urlBunny(bunny, bunnyLlave) });
      }
      if (r.storagePath) return res.json({ tipo: 'video', url: await urlFirmada(r.storagePath) });
      const embed = urlEmbebible(r.embedUrl || r.url || r.driveUrl);
      if (!embed) return res.status(409).json({ error: 'La fuente del video no es válida' });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ tipo: 'iframe', url: embed });
    } catch (err) {
      log.error('❌ /alumno/video:', err);
      res.status(500).json({ error: 'No pudimos abrir el video' });
    }
  });

  app.post('/alumno/curso/:slug/material', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      if (!(await accesoA(u, slug))) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const curso = await leerCurso(slug);
      const m = normalizarMateriales(curso && curso.recursosDescargables).find(x => x.id === String(req.body?.materialId || ''));
      if (!m || !m.disponible) return res.status(404).json({ error: 'Material no disponible' });
      const r = m._raw;
      const url = r.storagePath ? await urlFirmada(r.storagePath) : (r.url || r.driveUrl);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ url });
    } catch (err) {
      log.error('❌ /alumno/material:', err);
      res.status(500).json({ error: 'No pudimos abrir el material' });
    }
  });

  app.post('/alumno/curso/:slug/progreso', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      if (!(await accesoA(u, slug))) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const curso = await leerCurso(slug);
      const clases = normalizarClases(curso && curso.clases);
      const claseId = String(req.body?.claseId || '');
      if (!clases.find(c => c.id === claseId)) return res.status(404).json({ error: 'Clase no encontrada' });

      const ref = db.collection('progresoCurso').doc(u.uid).collection('cursos').doc(slug);
      const resultado = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const nuevo = fusionarProgreso(snap.exists ? snap.data() : null, {
          claseId,
          segundos: req.body?.segundos,
          completada: req.body?.completada === true,
          posicion: req.body?.posicion,
          clientTs: Math.min(Number(req.body?.clientTs) || Date.now(), Date.now() + 60000)
        });
        tx.set(ref, { ...nuevo, slug, actualizadoEn: new Date().toISOString() }, { merge: true });
        return nuevo;
      });
      res.json({ progreso: { clases: resultado.clases, ...resumenProgreso(resultado, clases) } });
    } catch (err) {
      log.error('❌ /alumno/progreso:', err);
      res.status(500).json({ error: 'No pudimos guardar tu progreso' });
    }
  });

  // ─── ALUMNO: solicitar certificado ─────────────────────────────────────────
  const limpio = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

  app.post('/alumno/curso/:slug/certificado/solicitar', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      const acceso = await accesoA(u, slug);
      if (!acceso) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const nombreCompleto = limpio(req.body?.nombreCompleto, 120);
      const whatsapp = limpio(req.body?.whatsapp, 20).replace(/[^\d+]/g, '');
      const estadoRep = limpio(req.body?.estado, 60);
      const ciudad = limpio(req.body?.ciudad, 80);
      const ocupacion = limpio(req.body?.ocupacion, 80);
      const comentarios = limpio(req.body?.comentarios, 400);
      if (nombreCompleto.split(' ').filter(Boolean).length < 2) return res.status(400).json({ error: 'Escribe tu nombre completo como quieres que aparezca en el certificado' });
      if (whatsapp.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Escribe un número de WhatsApp válido (10 dígitos)' });
      if (!estadoRep) return res.status(400).json({ error: 'Indica tu estado' });

      const cert = await estadoCertificado(u, slug);
      if (cert.estado === 'emitido') return res.status(409).json({ error: 'Tu certificado ya fue emitido', certificado: cert });

      const curso = await leerCurso(slug);
      const clases = normalizarClases(curso && curso.clases);
      const prog = await leerProgreso(u.uid, slug);
      const resumen = resumenProgreso(prog, clases);
      const ref = db.collection('solicitudesCertificado').doc(`${u.uid}_${slug}`);
      const prev = await ref.get();
      if (prev.exists && prev.data()?.estado === 'emitido') return res.status(409).json({ error: 'Tu certificado ya fue emitido' });
      const ahora = new Date().toISOString();
      const datos = {
        uid: u.uid,
        email: (u.email || '').toLowerCase(),
        emailVerificado: u.email_verified === true,
        slug,
        cursoNombre: (curso && (curso.nombre || curso.titulo)) || slug,
        nombreCompleto, whatsapp, estadoRep, ciudad, ocupacion, comentarios,
        progresoPorcentaje: resumen.porcentaje,
        clasesCompletadas: resumen.completadas,
        clasesTotales: resumen.total,
        fechaCompra: acceso.fechaCompra || null,
        estado: 'pendiente',
        actualizadoEn: ahora
      };
      if (!prev.exists) datos.fechaSolicitud = ahora;
      await ref.set(datos, { merge: true });
      res.json({ ok: true, solicitud: { estado: 'pendiente', fechaSolicitud: prev.exists ? (prev.data().fechaSolicitud || ahora) : ahora, nombreCompleto, whatsapp, estadoRep, ciudad } });
    } catch (err) {
      log.error('❌ /alumno/certificado/solicitar:', err);
      res.status(500).json({ error: 'No pudimos registrar tu solicitud' });
    }
  });

  // ─── ALUMNO: calificar el curso ────────────────────────────────────────────
  app.post('/alumno/curso/:slug/calificacion', async (req, res) => {
    try {
      const u = await tokenRequerido(req, res); if (!u) return;
      const slug = String(req.params.slug || '').slice(0, 120);
      if (!(await accesoA(u, slug))) return res.status(403).json({ error: 'Sin acceso a este curso' });
      const estrellas = Number(req.body?.estrellas);
      if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
      const comentario = limpio(req.body?.comentario, 1000);
      const ref = db.collection('calificacionesCurso').doc(`${slug}_${u.uid}`);
      const prev = await ref.get();
      const ahora = new Date().toISOString();
      await ref.set({
        uid: u.uid, slug, estrellas, comentario,
        email: (u.email || '').toLowerCase(),
        actualizadoEn: ahora,
        ...(prev.exists ? {} : { creadoEn: ahora })
      }, { merge: true });
      const cs = await db.collection('calificacionesCurso').where('slug', '==', slug).get();
      const todas = cs.docs.map(d => d.data() || {}).filter(c => Number(c.estrellas) >= 1);
      res.json({ ok: true, calificaciones: {
        promedio: Math.round(todas.reduce((a, c) => a + Number(c.estrellas), 0) / todas.length * 10) / 10,
        total: todas.length,
        mia: { estrellas, comentario }
      } });
    } catch (err) {
      log.error('❌ /alumno/calificacion:', err);
      res.status(500).json({ error: 'No pudimos guardar tu calificación' });
    }
  });

  app.get('/admin/cursos/calificaciones', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const cs = await db.collection('calificacionesCurso').get();
      const lista = cs.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((x, y) => String(y.actualizadoEn || '').localeCompare(String(x.actualizadoEn || '')));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ calificaciones: lista.slice(0, 2000) });
    } catch (err) {
      log.error('❌ /admin/cursos/calificaciones:', err);
      res.status(500).json({ error: 'No pudimos cargar las calificaciones' });
    }
  });

  // ─── ADMIN: solicitudes de certificado ─────────────────────────────────────
  app.get('/admin/certificados/solicitudes', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const snap = await db.collection('solicitudesCertificado').get();
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((x, y) => String(y.fechaSolicitud || '').localeCompare(String(x.fechaSolicitud || '')));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ solicitudes: lista.slice(0, 1000) });
    } catch (err) {
      log.error('❌ /admin/certificados/solicitudes:', err);
      res.status(500).json({ error: 'No pudimos cargar las solicitudes' });
    }
  });

  app.post('/admin/certificados/solicitudes/estado', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const id = String(req.body?.id || '').slice(0, 200);
      const estado = String(req.body?.estado || '');
      if (!['pendiente', 'en_proceso', 'emitido', 'rechazado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
      const ref = db.collection('solicitudesCertificado').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Solicitud no encontrada' });
      const cambio = { estado, actualizadoEn: new Date().toISOString(), atendidoPor: a.email || a.uid };
      if (req.body?.folio !== undefined) cambio.folio = limpio(req.body.folio, 60);
      if (req.body?.nota !== undefined) cambio.notaAdmin = limpio(req.body.nota, 400);
      await ref.set(cambio, { merge: true });
      await auditar(a, 'solicitud-certificado', { solicitudId: id, slug: snap.data().slug || null, estado, folio: cambio.folio || null });
      res.json({ ok: true });
    } catch (err) {
      log.error('❌ /admin/certificados/solicitudes/estado:', err);
      res.status(500).json({ error: 'No pudimos actualizar la solicitud' });
    }
  });

  // ─── ADMIN: contenido de Bunny por curso ───────────────────────────────────
  // Escribe cursosContenidoPrivado/{slug}: copia las clases públicas (mismos id, títulos y orden,
  // así el progreso de los alumnos se conserva) y les pone su video de Bunny; ya no lleva enlaces de Drive.
  app.post('/admin/cursos/contenido-bunny', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const slug = String(req.body?.slug || '').slice(0, 120);
      const biblioteca = String(req.body?.biblioteca || '');
      const cdn = String(req.body?.cdn || '');
      const videos = Array.isArray(req.body?.videos) ? req.body.videos : [];
      if (!/^\d{1,10}$/.test(biblioteca)) return res.status(400).json({ error: 'Biblioteca de Bunny inválida' });
      const pub = await db.collection('cursosVenta').doc(slug).get();
      if (!pub.exists) return res.status(404).json({ error: 'Curso no encontrado' });
      const base = normalizarClases((pub.data() || {}).clases);
      if (!base.length) return res.status(409).json({ error: 'El curso no tiene clases' });
      const porOrden = new Map();
      for (const v of videos) {
        const n = Number(v && v.orden);
        if (!Number.isInteger(n) || n < 1 || n > base.length) return res.status(400).json({ error: 'Orden fuera de rango: ' + (v && v.orden) });
        if (!GUID_RE.test(String(v.id || ''))) return res.status(400).json({ error: 'ID de video de Bunny inválido en la clase ' + n });
        porOrden.set(n, v);
      }
      const clases = base.map((c, i) => {
        const raw = { ...c._raw };
        delete raw.url; delete raw.embedUrl; delete raw.driveUrl; delete raw.storagePath;
        const v = porOrden.get(i + 1);
        const out = { ...raw, id: c.id, orden: c.orden, titulo: c.titulo };
        if (v) {
          out.bunny = { biblioteca, id: String(v.id).toLowerCase(), ...(cdn ? { cdn } : {}) };
          if (Number(v.duracionSeg) > 0) out.duracionMin = Math.max(1, Math.round(Number(v.duracionSeg) / 60));
          if (out.estado === 'pendiente') delete out.estado;
          if (out.publicada === false) delete out.publicada;
        } else {
          delete out.bunny;
          out.estado = 'pendiente';
        }
        return out;
      });
      const privRef = db.collection('cursosContenidoPrivado').doc(slug);
      const prevPriv = await privRef.get();
      const recursos = prevPriv.exists && Array.isArray(prevPriv.data().recursosDescargables)
        ? prevPriv.data().recursosDescargables
        : ((pub.data() || {}).recursosDescargables || []);
      await privRef.set({ clases, recursosDescargables: recursos, proveedorVideo: 'bunny', bibliotecaBunny: biblioteca, actualizadoEn: new Date().toISOString() }, { merge: true });
      await auditar(a, 'contenido-bunny', { slug, biblioteca, clasesConVideo: porOrden.size, totalClases: clases.length });
      res.json({ ok: true, clases: clases.map(c => ({ orden: c.orden, titulo: c.titulo, bunny: !!c.bunny })) });
    } catch (err) {
      log.error('❌ /admin/cursos/contenido-bunny:', err);
      res.status(500).json({ error: 'No pudimos guardar el contenido' });
    }
  });

  // ─── ADMIN: materiales del curso (archivo a Storage + lista) ───────────────
  app.post('/admin/cursos/material-archivo', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const slug = String(req.body?.slug || '').slice(0, 120);
      const nombre = String(req.body?.nombre || '').trim();
      const contentType = String(req.body?.contentType || 'application/octet-stream').slice(0, 100);
      const b64 = String(req.body?.base64 || '');
      if (!slug || !(await db.collection('cursosVenta').doc(slug).get()).exists) return res.status(404).json({ error: 'Curso no encontrado' });
      if (!/^[\w .()\-]{1,120}\.(pdf|pptx?|docx?|xlsx?|zip)$/i.test(nombre)) return res.status(400).json({ error: 'Nombre de archivo inválido' });
      if (!b64 || b64.length > 2.8e6) return res.status(400).json({ error: 'Archivo vacío o mayor a 2 MB' });
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'Archivo vacío' });
      const storagePath = `cursos/${slug}/materiales/${nombre.replace(/\s+/g, '_')}`;
      await admin.storage().bucket(bucketName).file(storagePath).save(buf, { contentType, resumable: false });
      await auditar(a, 'material-archivo', { slug, storagePath, bytes: buf.length });
      res.json({ ok: true, storagePath, bytes: buf.length });
    } catch (err) {
      log.error('❌ /admin/cursos/material-archivo:', err);
      res.status(500).json({ error: 'No pudimos guardar el archivo' });
    }
  });

  app.post('/admin/cursos/materiales', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const slug = String(req.body?.slug || '').slice(0, 120);
      const lista = Array.isArray(req.body?.recursos) ? req.body.recursos : null;
      if (!slug || !(await db.collection('cursosVenta').doc(slug).get()).exists) return res.status(404).json({ error: 'Curso no encontrado' });
      if (!lista) return res.status(400).json({ error: 'Falta la lista de recursos' });
      const recursos = lista.map((r, i) => {
        const titulo = String(r && r.titulo || '').trim().slice(0, 160);
        const storagePath = String(r && r.storagePath || '').trim();
        if (!titulo) throw Object.assign(new Error('Título vacío en el recurso ' + (i + 1)), { http: 400 });
        if (!/^cursos\/[\w-]+\/materiales\/[\w .()\-]+$/.test(storagePath)) throw Object.assign(new Error('storagePath inválido en el recurso ' + (i + 1)), { http: 400 });
        return { id: 'mat-' + (i + 1), titulo, storagePath };
      });
      await db.collection('cursosContenidoPrivado').doc(slug).set({ recursosDescargables: recursos, actualizadoEn: new Date().toISOString() }, { merge: true });
      await auditar(a, 'materiales', { slug, total: recursos.length });
      res.json({ ok: true, recursos: recursos.map(r => ({ id: r.id, titulo: r.titulo })) });
    } catch (err) {
      if (err.http === 400) return res.status(400).json({ error: err.message });
      log.error('❌ /admin/cursos/materiales:', err);
      res.status(500).json({ error: 'No pudimos guardar los materiales' });
    }
  });

  // ─── ADMIN: conciliación de compras históricas ─────────────────────────────
  app.get('/admin/cursos/buscar', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const email = String(req.query.email || '').toLowerCase().trim();
      const sessionId = String(req.query.sessionId || '').trim();
      if (!email && !sessionId) return res.status(400).json({ error: 'Indica correo o sessionId' });

      const compras = [];
      if (sessionId) {
        const d = await db.collection('comprasCurso').doc(sessionId).get();
        if (d.exists) compras.push({ id: d.id, ...d.data() });
      }
      if (email) {
        const s = await db.collection('comprasCurso').where('email', '==', email).get();
        s.docs.forEach(d => { if (!compras.find(c => c.id === d.id)) compras.push({ id: d.id, ...d.data() }); });
      }
      const cuentas = [];
      const correos = new Set([email, ...compras.map(c => (c.email || '').toLowerCase())].filter(Boolean));
      for (const e of correos) {
        try {
          const usr = await auth.getUserByEmail(e);
          const acc = await db.collection('accesosCurso').doc(usr.uid).collection('cursos').get();
          cuentas.push({
            uid: usr.uid, email: usr.email, verificado: usr.emailVerified,
            proveedores: (usr.providerData || []).map(p => p.providerId),
            accesos: acc.docs.map(d => ({ slug: d.id, ...d.data() }))
          });
        } catch (e2) { /* sin cuenta para ese correo */ }
        const sint = uidSintetico(e);
        const accS = await db.collection('accesosCurso').doc(sint).collection('cursos').get();
        if (!accS.empty) cuentas.push({ uid: sint, email: e, sintetico: true, accesos: accS.docs.map(d => ({ slug: d.id, ...d.data() })) });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ compras, cuentas });
    } catch (err) {
      log.error('❌ /admin/cursos/buscar:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/cursos/conciliar', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const sessionId = String(req.body?.sessionId || '').trim();
      const emailDestino = String(req.body?.emailDestino || '').toLowerCase().trim();
      const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
      if (!sessionId || !emailDestino || motivo.length < 5) {
        return res.status(400).json({ error: 'sessionId, emailDestino y motivo (mín. 5 letras) son obligatorios' });
      }

      // 1) Prueba de pago: comprasCurso confirmado o, si no existe, Stripe pagado
      let compra = null;
      const d = await db.collection('comprasCurso').doc(sessionId).get();
      if (d.exists) compra = { sessionId, ...d.data() };
      if (!compra || compra.estado !== 'confirmado') {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        if (!(s.payment_status === 'paid' || s.payment_status === 'no_payment_required') || s.metadata?.tipo !== 'curso') {
          return res.status(409).json({ error: 'Stripe no reporta este pago de curso como pagado' });
        }
        compra = {
          sessionId, slug: s.metadata.slug, uid: s.metadata.uid || null,
          email: (s.customer_email || s.customer_details?.email || '').toLowerCase(),
          nombre: s.metadata.nombre || '', whatsapp: s.metadata.whatsapp || '',
          estado: 'confirmado', fechaCompra: new Date(s.created * 1000).toISOString(),
          montoPagadoCentavos: s.amount_total || 0, recuperadoDesdeStripe: true
        };
        await db.collection('comprasCurso').doc(sessionId).set(compra, { merge: true });
      }
      if (!compra.slug) return res.status(409).json({ error: 'La compra no indica el curso' });

      // 2) Cuenta destino: debe existir en Firebase Auth
      let usr;
      try { usr = await auth.getUserByEmail(emailDestino); }
      catch (e) { return res.status(404).json({ error: 'No existe una cuenta con ese correo. Pide al alumno que entre primero al aula.' }); }

      const ref = db.collection('accesosCurso').doc(usr.uid).collection('cursos').doc(compra.slug);
      const prev = await ref.get();
      if (prev.exists && prev.data().activo === true) {
        return res.json({ ok: true, yaTenia: true, uid: usr.uid, slug: compra.slug });
      }
      const ahora = new Date().toISOString();
      await ref.set({
        slug: compra.slug, email: emailDestino, nombre: compra.nombre || '',
        activo: true, estado: 'activo', revocado: false,
        fechaCompra: compra.fechaCompra || null, stripeSessionId: sessionId,
        montoPagadoCentavos: compra.montoPagadoCentavos || 0,
        origen: 'conciliacion-admin', conciliadoEn: ahora, conciliadoPor: a.email || a.uid
      }, { merge: true });
      await db.collection('accesosCurso').doc(usr.uid).set({ email: emailDestino, ultimaActualizacion: ahora }, { merge: true });
      await db.collection('comprasCurso').doc(sessionId).set({ uidVinculado: usr.uid }, { merge: true });
      await auditar(a, 'conciliar', { sessionId, slug: compra.slug, uidDestino: usr.uid, emailDestino, emailCompra: compra.email || null, motivo });
      res.json({ ok: true, uid: usr.uid, slug: compra.slug });
    } catch (err) {
      log.error('❌ /admin/cursos/conciliar:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/cursos/revocar', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const uid = String(req.body?.uid || '').trim();
      const slug = String(req.body?.slug || '').trim();
      const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
      if (!uid || !slug || motivo.length < 5) return res.status(400).json({ error: 'uid, slug y motivo son obligatorios' });
      const ref = db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug);
      const prev = await ref.get();
      if (!prev.exists) return res.status(404).json({ error: 'Ese acceso no existe' });
      await ref.set({ activo: false, estado: 'revocado', revocado: true, revocadoEn: new Date().toISOString(), revocadoPor: a.email || a.uid, motivoRevocacion: motivo }, { merge: true });
      await auditar(a, 'revocar', { uidDestino: uid, slug, motivo });
      res.json({ ok: true });
    } catch (err) {
      log.error('❌ /admin/cursos/revocar:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/cursos/auditoria', async (req, res) => {
    try {
      const a = await adminRequerido(req, res); if (!a) return;
      const s = await db.collection('auditoriaCursos').orderBy('fecha', 'desc').limit(100).get();
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ registros: s.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err) {
      log.error('❌ /admin/cursos/auditoria:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  registrarRutasAlumno,
  _internos: { uidSintetico, driveId, urlEmbebible, normalizarClases, normalizarMateriales, fusionarProgreso, resumenProgreso, bunnyDe, urlBunny }
};

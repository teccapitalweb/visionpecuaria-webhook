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
    const fuente = c.storagePath || c.embedUrl || c.url || c.driveUrl || null;
    const did = driveId(c.driveUrl || c.embedUrl || c.url);
    const pendiente = c.estado === 'pendiente' || c.publicada === false || !fuente;
    return {
      id,
      orden: c.orden ?? pos + 1,
      titulo: c.titulo || `Clase ${pos + 1}`,
      modulo: c.modulo || null,
      descripcion: c.descripcion || '',
      duracionMin: Number(c.duracionMin) || null,
      fechaEnVivo: c.fechaEnVivo || null,
      miniatura: c.posterPath || c.miniatura || (did ? `https://drive.google.com/thumbnail?id=${did}&sz=w960` : null),
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

function registrarRutasAlumno(app, { admin, db, auth, stripe, bucketName = BUCKET_DEFAULT, log = console }) {

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

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
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
        certificado
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
  _internos: { uidSintetico, driveId, urlEmbebible, normalizarClases, normalizarMateriales, fusionarProgreso, resumenProgreso }
};

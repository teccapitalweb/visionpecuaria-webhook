const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const app = express();

// ─── Firebase Admin init ─────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

// ─── Stripe init ─────────────────────────────────────────────────────────────
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Price IDs del club VIP (membresías)
const PRICE_MENSUAL = process.env.STRIPE_PRICE_MENSUAL || 'price_1TPb9nPBgqsOPfUYOzCZpX42';
const PRICE_ANUAL   = process.env.STRIPE_PRICE_ANUAL   || 'price_1TPbCQPBgqsOPfUYZhUk9OGQ';

// URL pública del sitio (para return_url de Stripe)
const SITIO_URL = process.env.SITIO_URL || 'https://visionpecuariamx.com';

// ─── Resend (envío de correos) ───────────────────────────────────────────────
// La API key vive en Railway como RESEND_API_KEY.
// El remitente vive en Railway como EMAIL_FROM (debe usar el dominio verificado
// en Resend: visionpecuariamx.com). Ejemplo: "Visión Pecuaria <cursos@visionpecuariamx.com>"
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Visión Pecuaria <cursos@visionpecuariamx.com>';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'contacto@visionpecuariamx.com';

// ─── CORS global ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Raw body para Stripe (DEBE ir antes de express.json) ────────────────────
app.use('/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Helper: buscar miembro por email ────────────────────────────────────────
async function buscarMiembroPorEmail(email) {
  try {
    const user = await auth.getUserByEmail(email);
    const doc  = await db.collection('miembros').doc(user.uid).get();
    if (doc.exists) return { uid: user.uid, ref: doc.ref, userExists: true };
    return { uid: user.uid, ref: db.collection('miembros').doc(user.uid), userExists: true };
  } catch (e) {}

  const snap = await db.collection('miembros').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    return { uid: doc.id, ref: doc.ref, userExists: false };
  }
  return null;
}

// Helper: limpia strings
function sanearTexto(s) {
  if (!s) return '';
  return String(s).normalize('NFC').trim().slice(0, 500);
}

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL — Correo de bienvenida por curso (Resend)
// ═════════════════════════════════════════════════════════════════════════════

// Paletas por curso (fallback si el curso no tiene colorMarca en Firestore)
const PALETAS_CURSO = {
  'embutidos-artesanales': { primary: '#0f3d27', accent: '#d4a017', headerFrom: '#124019', headerTo: '#0d3016' },
  'gallinas-de-postura':   { primary: '#b45309', accent: '#f59e0b', headerFrom: '#c2620a', headerTo: '#9a4a08' }
};
const PALETA_DEFAULT = { primary: '#0f3d27', accent: '#d4a017', headerFrom: '#124019', headerTo: '#0d3016' };

// Aclara/oscurece un hex un porcentaje (para derivar tonos del header)
function ajustarHex(hex, pct) {
  const c = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return hex;
  const f = pct / 100;
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const adj = (n) => {
    const v = f >= 0 ? n + (255 - n) * f : n * (1 + f);
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  };
  return '#' + adj(r) + adj(g) + adj(b);
}

// Construye el HTML del correo de bienvenida
function construirEmailCurso({ nombre, nombreCurso, ponente, sessionId, slug, colorMarca }) {
  // Determinar paleta: colorMarca del curso > paleta predefinida > default
  let paleta;
  if (colorMarca && /^#?[0-9a-fA-F]{6}$/.test(colorMarca)) {
    const base = colorMarca.startsWith('#') ? colorMarca : '#' + colorMarca;
    paleta = { primary: base, accent: '#d4a017', headerFrom: ajustarHex(base, 8), headerTo: ajustarHex(base, -20) };
  } else {
    paleta = PALETAS_CURSO[slug] || PALETA_DEFAULT;
  }

  const linkAcceso = `${SITIO_URL}/curso-acceso.html?slug=${encodeURIComponent(slug)}&session_id=${encodeURIComponent(sessionId)}`;
  const primerNombre = (nombre || '').split(' ')[0] || 'alumno';
  const lineaPonente = ponente
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">Impartido por <b style="color:#1f2937;">${ponente}</b>.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,${paleta.headerFrom},${paleta.headerTo});padding:36px 32px;text-align:center;">
          <div style="color:${paleta.accent};font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">Visión Pecuaria</div>
          <div style="color:#ffffff;font-size:24px;font-weight:800;line-height:1.25;">🎉 ¡Tu inscripción está confirmada!</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 32px;">
          <p style="margin:0 0 18px;font-size:16px;color:#1f2937;">Hola <b>${primerNombre}</b>,</p>

          <p style="margin:0 0 8px;font-size:15px;line-height:1.65;color:#374151;">
            Bienvenido/a al curso <b style="color:#1f2937;">${nombreCurso}</b>. Tu pago se procesó correctamente y ya tienes
            <b>acceso permanente</b> al contenido en video y a los materiales descargables.
          </p>
          ${lineaPonente}

          <!-- Botón acceder -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px;">
            <tr><td style="border-radius:12px;background:${paleta.primary};">
              <a href="${linkAcceso}" style="display:inline-block;padding:15px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:12px;">
                🎬 Acceder al curso
              </a>
            </td></tr>
          </table>

          <!-- Nota certificado -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;margin-top:8px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">📜 Sobre tu certificado</div>
              <div style="font-size:14px;line-height:1.55;color:#4b5563;">
                Tu certificado digital con folio válido IPCIL se te enviará por este medio
                <b>aproximadamente una semana después</b> de que completes el curso. No necesitas hacer nada:
                lo recibirás automáticamente.
              </div>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#9ca3af;">
            Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
            <a href="${linkAcceso}" style="color:${paleta.primary};word-break:break-all;">${linkAcceso}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">© 2026 <b style="color:#374151;">Visión Pecuaria</b> · Excelencia en producción animal</div>
          <div style="font-size:12px;color:#9ca3af;">Este correo se envió porque te inscribiste a un curso en visionpecuariamx.com</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Envía el correo vía la API HTTP de Resend (sin dependencia npm, usa fetch nativo de Node 18+)
async function enviarCorreoCurso({ email, nombre, nombreCurso, ponente, sessionId, slug, colorMarca }) {
  if (!RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY no configurada — se omite el envío de correo');
    return { ok: false, skipped: true };
  }
  if (!email) {
    console.warn('⚠️ Sin email — se omite el envío de correo');
    return { ok: false, skipped: true };
  }

  const html = construirEmailCurso({ nombre, nombreCurso, ponente, sessionId, slug, colorMarca });
  const asunto = `🎉 ¡Bienvenido/a al curso ${nombreCurso}! Ya tienes acceso`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        reply_to: RESEND_REPLY_TO,
        subject: asunto,
        html
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error(`❌ Resend respondió ${resp.status}:`, JSON.stringify(data));
      return { ok: false, status: resp.status, data };
    }
    console.log(`📧 Correo enviado a ${email} (curso ${slug}) — id ${data.id || '?'}`);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('❌ Error enviando correo con Resend:', err.message);
    return { ok: false, error: err.message };
  }
}


// Health check
app.get('/', (req, res) => res.json({ status: 'Visión Pecuaria Webhook OK 🐄', stripe: true, cursos: true }));

// ═════════════════════════════════════════════════════════════════════════════
// 1) CREAR CHECKOUT SESSION — Club VIP (mensual/anual)
// ═════════════════════════════════════════════════════════════════════════════
app.post('/crear-checkout', async (req, res) => {
  try {
    const { plan, email: emailRaw, uid, nombre, whatsapp } = req.body;
    const email = (emailRaw || '').toLowerCase().trim();

    if (!email) return res.status(400).json({ error: 'Email requerido' });
    if (!plan || !['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido (mensual|anual)' });
    }

    const priceId = plan === 'anual' ? PRICE_ANUAL : PRICE_MENSUAL;

    const nombreLimpio = sanearTexto(nombre);
    const whatsappLimpio = sanearTexto(whatsapp).replace(/\D/g, '');
    const uidLimpio = sanearTexto(uid);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      allow_promotion_codes: true,
      metadata: { uid: uidLimpio, nombre: nombreLimpio, whatsapp: whatsappLimpio, plan },
      subscription_data: {
        metadata: { uid: uidLimpio, email, nombre: nombreLimpio, whatsapp: whatsappLimpio, plan }
      },
      return_url: 'https://teccapitalweb.github.io/VisionPecuaria/?pago_exitoso=1&session_id={CHECKOUT_SESSION_ID}'
    });

    console.log('✅ Checkout session (club) creada:', session.id, 'para', email);
    res.json({
      clientSecret: session.client_secret,
      url: session.url || null,
      sessionId: session.id
    });

  } catch (err) {
    console.error('❌ Error crear-checkout:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 1.b) CREAR CHECKOUT SESSION — CURSOS INDIVIDUALES (nuevo)
//     Recibe: { slug, uid, email, nombre, whatsapp }
//     Devuelve: { clientSecret }
// ═════════════════════════════════════════════════════════════════════════════
app.post('/crear-checkout-curso', async (req, res) => {
  try {
    const { slug: slugRaw, uid: uidRaw, email: emailRaw, nombre: nombreRaw, whatsapp: whatsappRaw } = req.body;

    const slug = sanearTexto(slugRaw);
    const email = (emailRaw || '').toLowerCase().trim();
    const uid = sanearTexto(uidRaw);
    const nombre = sanearTexto(nombreRaw);
    const whatsapp = sanearTexto(whatsappRaw).replace(/\D/g, '');

    if (!slug)   return res.status(400).json({ error: 'Slug del curso requerido' });
    if (!email)  return res.status(400).json({ error: 'Email requerido' });
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    // 1) Leer el curso de Firestore
    const cursoSnap = await db.collection('cursosVenta').doc(slug).get();
    if (!cursoSnap.exists) {
      return res.status(404).json({ error: 'Curso no encontrado: ' + slug });
    }
    const curso = cursoSnap.data();

    if (curso.activo === false) {
      return res.status(400).json({ error: 'Este curso no está disponible en este momento' });
    }

    // 2) Determinar precio (lanzamiento si aplica, si no el normal)
    let montoCentavos = curso.precioLanzamientoCentavos ?? curso.precioNormalCentavos;
    if (!montoCentavos && curso.precioLanzamiento) montoCentavos = Math.round(curso.precioLanzamiento * 100);
    if (!montoCentavos && curso.precioNormal)     montoCentavos = Math.round(curso.precioNormal * 100);
    if (!montoCentavos) return res.status(400).json({ error: 'El curso no tiene precio configurado' });

    // 3) ¿Ya compró este curso?
    if (uid) {
      const accesoSnap = await db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug).get();
      if (accesoSnap.exists) {
        const accesoData = accesoSnap.data();
        const yaTieneAcceso = accesoData?.activo === true || accesoData?.estado === 'activo';
        if (yaTieneAcceso) {
          return res.status(400).json({
            yaComprado: true,
            error: 'Ya tienes acceso a este curso',
            sessionId: accesoData?.stripeSessionId || null
          });
        }
      }
    }

    // 4) Crear Stripe Checkout Session (modo payment, no subscription)
    const nombreCurso = curso.nombre || curso.titulo || 'Curso Visión Pecuaria';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: curso.moneda || 'mxn',
          product_data: {
            name: nombreCurso,
            description: curso.subtitulo || 'Curso online Visión Pecuaria'
          },
          unit_amount: montoCentavos
        },
        quantity: 1
      }],
      allow_promotion_codes: true,
      metadata: {
        tipo: 'curso',
        slug,
        uid,
        nombre,
        whatsapp,
        email
      },
      return_url: `${SITIO_URL}/curso-acceso.html?slug=${encodeURIComponent(slug)}&session_id={CHECKOUT_SESSION_ID}`
    });

    console.log(`✅ Checkout de curso creado: ${slug} para ${email} (${montoCentavos / 100})`);
    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id
    });

  } catch (err) {
    console.error('❌ Error crear-checkout-curso:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2) VERIFICAR SESSION
// ═════════════════════════════════════════════════════════════════════════════
app.get('/verificar-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({
      status: session.status,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_email || session.customer_details?.email,
      metadata: session.metadata || {}
    });
  } catch (err) {
    console.error('❌ Error verificar-session:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2.b) VERIFICAR SESSION DE CURSO — llamado por curso-acceso.html
//      GET /verificar-session-curso?session_id=cs_live_XXX&slug=gallinas-de-postura
//      Devuelve { ok: true, slug, nombre, email, whatsapp } si el pago existe
// ═════════════════════════════════════════════════════════════════════════════
app.get('/verificar-session-curso', async (req, res) => {
  try {
    const { session_id, slug } = req.query;

    if (!session_id) {
      return res.json({ ok: false, error: 'session_id requerido' });
    }

    // 1) Buscar en comprasCurso (fuente principal de verdad)
    const compraSnap = await db.collection('comprasCurso').doc(session_id).get();
    if (compraSnap.exists) {
      const compra = compraSnap.data();
      if (slug && compra.slug && compra.slug !== slug) {
        return res.json({ ok: false, error: 'Este pago no corresponde a este curso' });
      }
      if (compra.estado && compra.estado !== 'confirmado') {
        return res.json({ ok: false, error: 'Pago no confirmado aún' });
      }
      return res.json({
        ok: true,
        slug: compra.slug,
        nombre: compra.nombre || '',
        email: compra.email || '',
        whatsapp: compra.whatsapp || '',
        fechaCompra: compra.fechaCompra || null,
        montoPagadoCentavos: compra.montoPagadoCentavos || 0
      });
    }

    // 2) Fallback: consultar directamente a Stripe.
    //    Útil para pagos hechos antes de que el webhook actual estuviera desplegado,
    //    o si el webhook aún no ha procesado el evento (race condition).
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status !== 'paid') {
        return res.json({ ok: false, error: 'Pago no completado en Stripe' });
      }
      const meta = session.metadata || {};
      if (slug && meta.slug && meta.slug !== slug) {
        return res.json({ ok: false, error: 'Este pago no corresponde a este curso' });
      }
      // Como no había registro, lo creamos ahora (recuperación automática)
      const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
      const compraRecuperada = {
        sessionId: session.id,
        slug: meta.slug || slug || null,
        uid: meta.uid || null,
        email,
        nombre: meta.nombre || email.split('@')[0],
        whatsapp: meta.whatsapp || session.customer_details?.phone || '',
        estado: 'confirmado',
        fechaCompra: new Date(session.created * 1000).toISOString(),
        montoPagadoCentavos: session.amount_total || 0,
        stripeCustomerId: session.customer || null,
        recuperadoDesdeStripe: true
      };
      try {
        await db.collection('comprasCurso').doc(session.id).set(compraRecuperada, { merge: true });
        console.log(`♻️ Compra recuperada desde Stripe: ${session.id}`);
      } catch (e) {
        console.warn('No se pudo guardar la compra recuperada:', e.message);
      }
      return res.json({
        ok: true,
        slug: compraRecuperada.slug,
        nombre: compraRecuperada.nombre,
        email: compraRecuperada.email,
        whatsapp: compraRecuperada.whatsapp,
        fechaCompra: compraRecuperada.fechaCompra,
        montoPagadoCentavos: compraRecuperada.montoPagadoCentavos,
        _fromStripe: true
      });
    } catch (e) {
      console.warn('No se pudo consultar sesión en Stripe:', e.message);
    }

    return res.json({ ok: false, error: 'Registro de pago no encontrado' });
  } catch (err) {
    console.error('❌ Error verificar-session-curso:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3) WEBHOOK STRIPE — actualizar Firestore cuando pasa algo
// ═════════════════════════════════════════════════════════════════════════════
app.post('/stripe-webhook', async (req, res) => {
  let event;
  const sig = req.headers['stripe-signature'];

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Firma Stripe inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📩 Evento Stripe:', event.type);

  try {
    switch (event.type) {

      // ─── Pago exitoso ─────────────────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tipo = session.metadata?.tipo || 'membresia';

        // ── RAMA A: pago de CURSO individual (nuevo) ──
        if (tipo === 'curso') {
          const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
          const slug = session.metadata?.slug;
          const nombre = session.metadata?.nombre || email.split('@')[0];
          const whatsapp = session.metadata?.whatsapp || session.customer_details?.phone || '';
          let uid = session.metadata?.uid;

          if (!email || !slug) {
            console.warn('⚠️ Curso: faltan email o slug en metadata');
            return res.status(200).json({ received: true });
          }

          const fechaISO = new Date().toISOString();
          const montoCentavos = session.amount_total || 0;

          // 1) COMPRA por sessionId (lo que curso-acceso.html busca primero)
          //    Esta colección se lee públicamente por session_id sin necesidad de auth
          await db.collection('comprasCurso').doc(session.id).set({
            sessionId: session.id,
            slug,
            uid: uid || null,
            email,
            nombre,
            whatsapp,
            estado: 'confirmado',
            fechaCompra: fechaISO,
            montoPagadoCentavos: montoCentavos,
            stripeCustomerId: session.customer || null
          }, { merge: true });
          console.log(`✅ comprasCurso/${session.id} creado`);

          // 2) ACCESO al curso por uid (para lista de cursos comprados)
          if (uid) {
            await db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug).set({
              slug,
              email,
              nombre,
              whatsapp,
              activo: true,                         // ← formato que espera curso-acceso.html
              estado: 'activo',                     // ← compatibilidad
              fechaCompra: fechaISO,
              stripeSessionId: session.id,
              montoPagadoCentavos: montoCentavos
            }, { merge: true });

            // Datos del alumno bajo el uid
            await db.collection('accesosCurso').doc(uid).set({
              email,
              nombre,
              whatsapp,
              ultimaActualizacion: fechaISO
            }, { merge: true });
            console.log(`✅ accesosCurso/${uid}/cursos/${slug} creado`);
          }

          // 3) INCREMENTAR cupo tomado del curso (para el contador de la landing)
          try {
            await db.collection('cursosVenta').doc(slug).update({
              cupoLanzamientoTomados: admin.firestore.FieldValue.increment(1),
              ultimoPago: fechaISO
            });
            console.log(`✅ cupo incrementado en cursosVenta/${slug}`);
          } catch (e) {
            console.warn(`⚠️ No se pudo incrementar cupo: ${e.message}`);
          }

          // 4) Registrar en pagos
          const monto = montoCentavos
            ? (montoCentavos / 100).toFixed(2) + ' ' + (session.currency || 'MXN').toUpperCase()
            : '—';
          await db.collection('pagos').add({
            tipo: 'curso',
            slug,
            nombre, email, whatsapp,
            monto,
            stripeSessionId: session.id,
            fecha: fechaISO,
            estado: 'confirmado'
          });

          // 5) Certificado pendiente (para IPCIL)
          await db.collection('certificadosPendientes').add({
            slug,
            uid: uid || null,
            nombre,
            email,
            whatsapp,
            fechaCompra: fechaISO,
            estado: 'pendiente',
            stripeSessionId: session.id
          });

          // 6) Correo de bienvenida (Resend) — datos del curso desde Firestore
          try {
            let nombreCurso = slug;
            let ponente = '';
            let colorMarca = null;
            try {
              const cursoDoc = await db.collection('cursosVenta').doc(slug).get();
              if (cursoDoc.exists) {
                const c = cursoDoc.data();
                nombreCurso = c.nombre || c.titulo || slug;
                ponente = c.instructorNombre || '';
                colorMarca = c.colorMarca || null;
              }
            } catch (e) {
              console.warn(`⚠️ No se pudo leer el curso para el correo: ${e.message}`);
            }
            await enviarCorreoCurso({ email, nombre, nombreCurso, ponente, sessionId: session.id, slug, colorMarca });
          } catch (e) {
            // El correo nunca debe tumbar el webhook: si falla, el acceso ya quedó guardado
            console.error(`⚠️ Falló el envío de correo (acceso ya activado): ${e.message}`);
          }

          console.log(`✅ Curso activado: ${slug} para ${email}`);
          break;
        }

        // ── RAMA B: membresía club VIP (comportamiento original) ──
        const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
        const nombre = session.metadata?.nombre || session.customer_details?.name || email.split('@')[0];
        let whatsapp = session.metadata?.whatsapp || '';
        const planKey = session.metadata?.plan || 'mensual';
        const plan = planKey === 'anual' ? 'VIP Anual' : 'VIP Mensual';

        if (!email) {
          console.warn('⚠️ Sin email en session');
          return res.status(200).json({ received: true });
        }

        const vence = new Date();
        plan === 'VIP Anual' ? vence.setFullYear(vence.getFullYear() + 1) : vence.setMonth(vence.getMonth() + 1);
        const venceStr = vence.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

        let uid = session.metadata?.uid || null;

        if (!uid) {
          try {
            const user = await auth.getUserByEmail(email);
            uid = user.uid;
          } catch (e) {
            try {
              const newUser = await auth.createUser({
                email: email,
                displayName: nombre || email.split('@')[0],
                emailVerified: true
              });
              uid = newUser.uid;
            } catch (createError) {
              console.error(`❌ No se pudo crear usuario Auth: ${createError.message}`);
            }
          }
        }

        if (!whatsapp && uid) {
          try {
            const freeDoc = await db.collection('usuarios_free').doc(uid).get();
            if (freeDoc.exists) {
              const freeData = freeDoc.data();
              if (freeData.whatsapp) whatsapp = freeData.whatsapp;
            }
          } catch (e) {}
        }
        if (!whatsapp) whatsapp = session.customer_details?.phone || '';

        const docId = uid || email;
        if (docId) {
          await db.collection('miembros').doc(docId).set({
            nombre, email, whatsapp, plan,
            estado: 'activo',
            vence: venceStr,
            fechaRegistro: new Date().toISOString(),
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            ultimoPago: new Date().toISOString(),
            uid: uid || null,
          }, { merge: true });

          const monto = session.amount_total
            ? (session.amount_total / 100).toFixed(2) + ' ' + (session.currency || 'MXN').toUpperCase()
            : '—';

          await db.collection('pagos').add({
            tipo: 'membresia',
            nombre, email, plan, monto,
            stripeSessionId: session.id,
            stripeSubscriptionId: session.subscription,
            fecha: new Date().toISOString(),
            estado: 'confirmado'
          });

          console.log(`✅ Miembro activado: ${email} | Plan: ${plan}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();
        if (email) {
          const m = await buscarMiembroPorEmail(email);
          if (m && m.userExists) {
            const nuevoEstado = sub.status === 'active' || sub.status === 'trialing' ? 'activo' : 'inactivo';
            const vence = new Date(sub.current_period_end * 1000);
            const venceStr = vence.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
            await m.ref.update({ estado: nuevoEstado, vence: venceStr, stripeSubscriptionId: sub.id });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();
        if (email) {
          const m = await buscarMiembroPorEmail(email);
          if (m && m.userExists) {
            await m.ref.update({ estado: 'inactivo', canceladoEn: new Date().toISOString() });
          }
        }
        break;
      }

      default:
        console.log('ℹ️ Evento sin handler:', event.type);
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error('❌ Error procesando webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4) CANCELACIÓN DIRECTA
// ═════════════════════════════════════════════════════════════════════════════
app.post('/cancelar-membresia', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });
    const emailLower = email.toLowerCase().trim();
    const miembro = await buscarMiembroPorEmail(emailLower);
    if (!miembro) return res.status(404).json({ error: 'Miembro no encontrado' });

    const doc = await miembro.ref.get();
    const subId = doc.data()?.stripeSubscriptionId;
    if (subId) {
      try { await stripe.subscriptions.cancel(subId); }
      catch (e) { console.warn('⚠️ No se pudo cancelar en Stripe:', e.message); }
    }
    await miembro.ref.update({ estado: 'inactivo', canceladoEn: new Date().toISOString() });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error cancelar-membresia:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Visión Pecuaria Webhook (Stripe) running on port ${PORT}`));

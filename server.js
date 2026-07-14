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
      if (accesoSnap.exists && accesoSnap.data()?.estado === 'activo') {
        return res.status(400).json({ yaComprado: true, error: 'Ya tienes acceso a este curso' });
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

          // Registrar acceso al curso
          if (uid) {
            await db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug).set({
              slug,
              email,
              nombre,
              whatsapp,
              estado: 'activo',
              fechaCompra: new Date().toISOString(),
              stripeSessionId: session.id,
              montoPagadoCentavos: session.amount_total || 0
            }, { merge: true });

            // Guardar datos del alumno bajo el uid
            await db.collection('accesosCurso').doc(uid).set({
              email,
              nombre,
              whatsapp,
              ultimaActualizacion: new Date().toISOString()
            }, { merge: true });
          }

          // Registrar pago
          const monto = session.amount_total
            ? (session.amount_total / 100).toFixed(2) + ' ' + (session.currency || 'MXN').toUpperCase()
            : '—';
          await db.collection('pagos').add({
            tipo: 'curso',
            slug,
            nombre, email, whatsapp,
            monto,
            stripeSessionId: session.id,
            fecha: new Date().toISOString(),
            estado: 'confirmado'
          });

          // Pendiente de certificado (para que IPCIL lo emita después)
          await db.collection('certificadosPendientes').add({
            slug,
            uid: uid || null,
            nombre,
            email,
            whatsapp,
            fechaCompra: new Date().toISOString(),
            estado: 'pendiente',
            stripeSessionId: session.id
          });

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

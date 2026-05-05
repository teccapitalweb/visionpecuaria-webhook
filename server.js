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

// Price IDs (en variables de entorno para poder cambiar sin tocar código)
const PRICE_MENSUAL = process.env.STRIPE_PRICE_MENSUAL || 'price_1TPb9nPBgqsOPfUYOzCZpX42';
const PRICE_ANUAL   = process.env.STRIPE_PRICE_ANUAL   || 'price_1TPbCQPBgqsOPfUYZhUk9OGQ';

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

// Health check
app.get('/', (req, res) => res.json({ status: 'Visión Pecuaria Webhook OK 🐄', stripe: true }));

// ═════════════════════════════════════════════════════════════════════════════
// 1) CREAR CHECKOUT SESSION — Stripe Embedded
// El frontend llama aquí y recibe un clientSecret que monta el formulario
// ═════════════════════════════════════════════════════════════════════════════
app.post('/crear-checkout', async (req, res) => {
  try {
    const { plan, email, uid, nombre, whatsapp } = req.body;

    if (!email) return res.status(400).json({ error: 'Email requerido' });
    if (!plan || !['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido (mensual|anual)' });
    }

    const priceId = plan === 'anual' ? PRICE_ANUAL : PRICE_MENSUAL;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      allow_promotion_codes: true,
      metadata: {
        uid: uid || '',
        nombre: nombre || '',
        whatsapp: whatsapp || '',
        plan
      },
      subscription_data: {
        metadata: {
          uid: uid || '',
          email,
          nombre: nombre || '',
          whatsapp: whatsapp || '',
          plan
        }
      },
      return_url: `https://teccapitalweb.github.io/Visión Pecuaria---mx/index.html?pago_exitoso=1&session_id={CHECKOUT_SESSION_ID}`
    });

    console.log('✅ Checkout session creada:', session.id, 'para', email);
    res.json({ clientSecret: session.client_secret });

  } catch (err) {
    console.error('❌ Error crear-checkout:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2) VERIFICAR SESSION — el frontend puede preguntar el estado después de pagar
// ═════════════════════════════════════════════════════════════════════════════
app.get('/verificar-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_email
    });
  } catch (err) {
    console.error('❌ Error verificar-session:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3) WEBHOOK STRIPE — recibe eventos y actualiza Firestore
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

      // ─── Pago exitoso — ACTIVAR membresía ─────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
        const nombre = session.metadata?.nombre || session.customer_details?.name || email.split('@')[0];
        // ═══ FIX: WhatsApp desde múltiples fuentes ═══
        // Prioridad: 1) metadata (mandado por el frontend) → 2) usuarios_free → 3) Stripe phone
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
            console.log(`✅ UID recuperado de Firebase Auth: ${uid}`);
          } catch (e) {
            console.warn(`⚠️ Usuario no existe en Firebase Auth para email: ${email}. Intentando crearlo automáticamente...`);
            try {
              const newUser = await auth.createUser({
                email: email,
                displayName: nombre || email.split('@')[0],
                emailVerified: true
              });
              uid = newUser.uid;
              console.log(`✅ Usuario creado automáticamente en Firebase Auth: ${uid}`);
            } catch (createError) {
              console.error(`❌ No se pudo crear usuario Auth: ${createError.message}`);
            }
          }
        }

        // ═══ FIX: Si aún no tenemos WhatsApp, buscar en usuarios_free ═══
        if (!whatsapp && uid) {
          try {
            const freeDoc = await db.collection('usuarios_free').doc(uid).get();
            if (freeDoc.exists) {
              const freeData = freeDoc.data();
              if (freeData.whatsapp) {
                whatsapp = freeData.whatsapp;
                console.log('📱 WhatsApp recuperado de usuarios_free:', whatsapp);
              }
            }
          } catch (e) {
            console.warn('⚠️ No se pudo leer usuarios_free:', e.message);
          }
        }

        // Último fallback: el phone que Stripe pudo haber capturado
        if (!whatsapp) {
          whatsapp = session.customer_details?.phone || '';
        }

        const docId = uid || email;
        if (docId) {
          console.log(`📝 Escribiendo en miembros/${docId} (uid: ${uid ? 'sí' : 'NO - usando email'})`);
          await db.collection('miembros').doc(docId).set({
            nombre,
            email,
            whatsapp,
            plan,
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
              nombre, email, plan, monto,
              stripeSessionId: session.id,
              stripeSubscriptionId: session.subscription,
              fecha: new Date().toISOString(),
              estado: 'confirmado'
            });

            console.log(`✅ Miembro activado: ${email} | Plan: ${plan} | Vence: ${venceStr}`);
          } else {
            console.error(`❌ CRÍTICO: Sin uid ni email para crear documento. Metadata: ${JSON.stringify(session.metadata)}`);
          }
          break;
        }

      // ─── Suscripción actualizada (ej. renovación automática) ──────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();

        if (email) {
          const m = await buscarMiembroPorEmail(email);
          if (m && m.userExists) {
            const nuevoEstado = sub.status === 'active' || sub.status === 'trialing' ? 'activo' : 'inactivo';

            const vence = new Date(sub.current_period_end * 1000);
            const venceStr = vence.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

            await m.ref.update({
              estado: nuevoEstado,
              vence: venceStr,
              stripeSubscriptionId: sub.id
            });
            console.log(`🔁 Suscripción actualizada: ${email} → ${nuevoEstado}`);
          }
        }
        break;
      }

      // ─── Suscripción cancelada ────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();

        if (email) {
          const m = await buscarMiembroPorEmail(email);
          if (m && m.userExists) {
            await m.ref.update({
              estado: 'inactivo',
              canceladoEn: new Date().toISOString()
            });
            console.log('🛑 Membresía cancelada (Stripe):', email);
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
// 4) CANCELACIÓN DIRECTA — llamada desde el panel VIP del portal
// ═════════════════════════════════════════════════════════════════════════════
app.post('/cancelar-membresia', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailLower = email.toLowerCase().trim();
    console.log('🛑 Cancelación solicitada por:', emailLower);

    const miembro = await buscarMiembroPorEmail(emailLower);
    if (!miembro) return res.status(404).json({ error: 'Miembro no encontrado' });

    // Cancelar suscripción en Stripe si existe
    const doc = await miembro.ref.get();
    const subId = doc.data()?.stripeSubscriptionId;
    if (subId) {
      try {
        await stripe.subscriptions.cancel(subId);
        console.log('✅ Stripe subscription cancelled:', subId);
      } catch (e) {
        console.warn('⚠️ No se pudo cancelar en Stripe (tal vez ya estaba cancelada):', e.message);
      }
    }

    await miembro.ref.update({
      estado: 'inactivo',
      canceladoEn: new Date().toISOString()
    });

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('❌ Error cancelar-membresia:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Visión Pecuaria Webhook (Stripe) running on port ${PORT}`));

const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const { Resend } = require('resend');

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

// ─── Resend init (envío de emails transaccionales) ──────────────────────────
// La key la pones como env var en Railway: RESEND_API_KEY=re_xxxxx
// Mientras no esté configurada, el envío falla silenciosamente sin romper el webhook.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Visión Pecuaria <no-responder@visionpecuariamx.com>';

// Price IDs (en variables de entorno para poder cambiar sin tocar código)
const PRICE_MENSUAL = process.env.STRIPE_PRICE_MENSUAL || 'price_1TPb9nPBgqsOPfUYOzCZpX42';
const PRICE_ANUAL   = process.env.STRIPE_PRICE_ANUAL   || 'price_1TPbCQPBgqsOPfUYZhUk9OGQ';

// Dominio público donde vive la página de acceso al curso
// (se puede sobreescribir con env var por si un día cambia)
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://visionpecuariamx.com';

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
app.get('/', (req, res) => res.json({
  status: 'Visión Pecuaria Webhook OK 🐄',
  version: '1.1.0',
  stripe: true,
  resend: !!resend,
  features: ['membresia', 'curso', 'certificados', 'email']
}));

// ═════════════════════════════════════════════════════════════════════════════
// 1) CREAR CHECKOUT SESSION — Stripe Embedded (MEMBRESÍA)
// El frontend llama aquí y recibe un clientSecret que monta el formulario
// ═════════════════════════════════════════════════════════════════════════════
// Helper: limpia strings para que no rompan URLs ni metadata de Stripe
// Stripe acepta UTF-8 en metadata, pero el problema viene en URLs.
// Aquí limpiamos espacios extra y normalizamos.
function sanearTexto(s) {
  if (!s) return '';
  return String(s).normalize('NFC').trim().slice(0, 500);
}

app.post('/crear-checkout', async (req, res) => {
  try {
    const { plan, email: emailRaw, uid, nombre, whatsapp } = req.body;
    const email = (emailRaw || '').toLowerCase().trim();

    if (!email) return res.status(400).json({ error: 'Email requerido' });
    if (!plan || !['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido (mensual|anual)' });
    }

    const priceId = plan === 'anual' ? PRICE_ANUAL : PRICE_MENSUAL;

    // Sanear todos los strings que van a metadata (Stripe acepta UTF-8 pero limpiamos por seguridad)
    const nombreLimpio = sanearTexto(nombre);
    const whatsappLimpio = sanearTexto(whatsapp).replace(/\D/g, '');
    const uidLimpio = sanearTexto(uid);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      allow_promotion_codes: true,
      metadata: {
        tipo: 'membresia',
        uid: uidLimpio,
        nombre: nombreLimpio,
        whatsapp: whatsappLimpio,
        plan
      },
      subscription_data: {
        metadata: {
          tipo: 'membresia',
          uid: uidLimpio,
          email,
          nombre: nombreLimpio,
          whatsapp: whatsappLimpio,
          plan
        }
      },
      // MODIFICADO: return_url ahora apunta al portal de socio directamente.
      // Así el usuario ve la animación de bienvenida sin pasar por la landing.
      return_url: 'https://teccapitalweb.github.io/VisionPecuaria/?pago_exitoso=1&session_id={CHECKOUT_SESSION_ID}'
    });

    console.log('✅ Checkout session creada:', session.id, 'para', email);
    // Devolvemos AMBOS: client_secret (para modo embedded) y url (por si el frontend usa redirect)
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
// 2.5) VENTA DE CURSOS (PAGO ÚNICO) — NUEVOS ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════
//
// FLUJO:
//   1. El cliente llama POST /crear-checkout-curso con { slug, uid, email, nombre, whatsapp }.
//      El backend LEE cursosVenta/{slug} para decidir el precio real. El cliente
//      no puede manipular el monto.
//   2. Si aún hay cupo de lanzamiento (cupoLanzamientoTomados < cupoLanzamientoMax),
//      cobra precioLanzamientoCentavos. Si no, precioNormalCentavos.
//   3. Stripe embedded checkout se monta en el frontend con el clientSecret.
//   4. Al pagar, Stripe dispara checkout.session.completed → el webhook:
//      a) Escribe comprasCurso/{sessionId} con idempotencia atómica.
//      b) Incrementa cupoLanzamientoTomados si aplicó descuento.
//      c) Crea accesosCurso/{uid}/cursos/{slug} con activo=true.
//
// ═════════════════════════════════════════════════════════════════════════════

app.post('/crear-checkout-curso', async (req, res) => {
  try {
    const { slug, email: emailRaw, uid, nombre, whatsapp } = req.body;
    const email = (emailRaw || '').toLowerCase().trim();

    if (!email) return res.status(400).json({ error: 'Email requerido' });
    if (!uid)   return res.status(400).json({ error: 'Debes iniciar sesión antes de comprar' });
    if (!slug)  return res.status(400).json({ error: 'Slug de curso requerido' });

    // 1. Leer curso de Firestore (fuente única de verdad para precio)
    const cursoRef = db.collection('cursosVenta').doc(slug);
    const cursoDoc = await cursoRef.get();
    if (!cursoDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    const curso = cursoDoc.data();

    if (curso.estado !== 'publicado') {
      return res.status(400).json({ error: 'Este curso no está disponible por el momento' });
    }

    // 2. Verificar si el usuario ya compró este curso (no vender dos veces)
    const yaComprado = await db
      .collection('accesosCurso').doc(uid)
      .collection('cursos').doc(slug)
      .get();
    if (yaComprado.exists && yaComprado.data().activo === true) {
      return res.status(400).json({
        error: 'Ya tienes acceso a este curso',
        yaComprado: true
      });
    }

    // 3. Decidir precio real
    const precioNormal      = Number(curso.precioNormalCentavos)     || 0;
    const precioLanzamiento = Number(curso.precioLanzamientoCentavos) || precioNormal;
    const cupoMax    = Number(curso.cupoLanzamientoMax)     || 0;
    const cupoTomados = Number(curso.cupoLanzamientoTomados) || 0;
    const hayCupoLanzamiento = precioLanzamiento < precioNormal && cupoTomados < cupoMax;

    const precioAplicado = hayCupoLanzamiento ? precioLanzamiento : precioNormal;
    if (precioAplicado <= 0) {
      return res.status(500).json({ error: 'Curso mal configurado (precio inválido)' });
    }

    // 4. Sanear metadata
    const nombreLimpio   = sanearTexto(nombre);
    const whatsappLimpio = sanearTexto(whatsapp).replace(/\D/g, '');
    const uidLimpio      = sanearTexto(uid);
    const slugLimpio     = sanearTexto(slug);
    const nombreCurso    = sanearTexto(curso.nombre || slug);

    // 5. Crear sesión Stripe (mode: 'payment', NO subscription)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      line_items: [{
        price_data: {
          currency: curso.moneda || 'mxn',
          product_data: {
            name: nombreCurso,
            description: sanearTexto(curso.subtitulo || 'Curso Visión Pecuaria')
          },
          unit_amount: precioAplicado
        },
        quantity: 1
      }],
      customer_email: email,
      allow_promotion_codes: true,     // ← permite cupones (pruebas + ofertas futuras)
      metadata: {
        tipo: 'curso',
        slug: slugLimpio,
        uid: uidLimpio,
        nombre: nombreLimpio,
        whatsapp: whatsappLimpio,
        precioAplicadoCentavos: String(precioAplicado),
        esLanzamiento: String(hayCupoLanzamiento)
      },
      payment_intent_data: {
        metadata: {
          tipo: 'curso',
          slug: slugLimpio,
          uid: uidLimpio,
          email,
          nombre: nombreLimpio,
          whatsapp: whatsappLimpio
        }
      },
      return_url: `${PUBLIC_SITE_URL}/curso-acceso.html?slug=${encodeURIComponent(slugLimpio)}&session_id={CHECKOUT_SESSION_ID}`
    });

    console.log(`✅ Checkout CURSO creado: ${session.id} | ${email} | ${slug} | ${(precioAplicado / 100).toFixed(2)} MXN${hayCupoLanzamiento ? ' (LANZAMIENTO)' : ''}`);

    res.json({
      clientSecret: session.client_secret,
      url: session.url || null,
      sessionId: session.id,
      precioAplicadoCentavos: precioAplicado,
      esLanzamiento: hayCupoLanzamiento,
      cupoRestante: hayCupoLanzamiento ? (cupoMax - cupoTomados) : 0
    });

  } catch (err) {
    console.error('❌ Error crear-checkout-curso:', err);
    res.status(500).json({ error: err.message });
  }
});

// Estado de una sesión de compra de curso (mismo mecanismo que membresía)
app.get('/verificar-session-curso/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_email,
      slug: session.metadata?.slug || null,
      uid: session.metadata?.uid || null
    });
  } catch (err) {
    console.error('❌ Error verificar-session-curso:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint público auxiliar: consultar cuánto cupo de lanzamiento queda.
// Lo usa la landing para mostrar el contador en vivo sin exponer datos privados.
app.get('/curso/:slug/cupo', async (req, res) => {
  try {
    const cursoDoc = await db.collection('cursosVenta').doc(req.params.slug).get();
    if (!cursoDoc.exists) return res.status(404).json({ error: 'Curso no encontrado' });
    const c = cursoDoc.data();
    const cupoMax    = Number(c.cupoLanzamientoMax)     || 0;
    const cupoTomados = Number(c.cupoLanzamientoTomados) || 0;
    res.json({
      cupoMax,
      cupoTomados,
      cupoRestante: Math.max(cupoMax - cupoTomados, 0),
      hayCupoLanzamiento: cupoTomados < cupoMax
    });
  } catch (err) {
    console.error('❌ Error curso/:slug/cupo:', err);
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

      // ─── Pago exitoso — ACTIVAR membresía O acceso a curso ───────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tipo = session.metadata?.tipo || 'membresia'; // default: comportamiento actual

        // ═══════════════════════════════════════════════════════════════════
        // BRANCH A: COMPRA DE CURSO (pago único)
        // ═══════════════════════════════════════════════════════════════════
        if (tipo === 'curso') {
          await procesarCompraCurso(session);
          break;
        }

        // ═══════════════════════════════════════════════════════════════════
        // BRANCH B: MEMBRESÍA (código original intacto)
        // ═══════════════════════════════════════════════════════════════════
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
// procesarCompraCurso — se llama desde el switch del webhook cuando
// metadata.tipo === 'curso' y el evento es checkout.session.completed.
//
// Garantías:
//   • IDEMPOTENCIA: si el mismo session.id llega dos veces (Stripe reintenta),
//     el segundo procesamiento es no-op. Lo garantiza la creación de
//     comprasCurso/{sessionId} DENTRO de la transacción.
//   • CUPO ATÓMICO: el contador cupoLanzamientoTomados se incrementa dentro de
//     la misma transacción que registra la compra. No hay condiciones de carrera
//     aunque 5 personas paguen exactamente al mismo tiempo.
//   • ACCESO REAL: se escribe accesosCurso/{uid}/cursos/{slug} → esto es lo que
//     lee curso-acceso.html para desbloquear el contenido.
// ═════════════════════════════════════════════════════════════════════════════
async function procesarCompraCurso(session) {
  const sessionId = session.id;
  const slug      = session.metadata?.slug;
  let   uid       = session.metadata?.uid || null;
  const email     = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
  const nombre    = session.metadata?.nombre || session.customer_details?.name || (email ? email.split('@')[0] : 'Alumno');
  let   whatsapp  = session.metadata?.whatsapp || '';
  const esLanzamiento = session.metadata?.esLanzamiento === 'true';
  const montoPagado   = session.amount_total || 0; // centavos

  if (!slug) {
    console.error(`❌ CURSO: sin slug en metadata para session ${sessionId}`);
    return;
  }

  // Recuperar/crear uid si no vino en metadata (usuario nuevo pagando sin login)
  if (!uid && email) {
    try {
      const user = await auth.getUserByEmail(email);
      uid = user.uid;
      console.log(`✅ CURSO: uid recuperado de Auth: ${uid}`);
    } catch (e) {
      try {
        const newUser = await auth.createUser({
          email,
          displayName: nombre,
          emailVerified: true
        });
        uid = newUser.uid;
        console.log(`✅ CURSO: usuario creado automáticamente: ${uid}`);
      } catch (createError) {
        console.error(`❌ CURSO: no se pudo crear usuario Auth: ${createError.message}`);
      }
    }
  }

  if (!uid) {
    console.error(`❌ CURSO: sin uid ni email válido para session ${sessionId}. Compra queda huérfana.`);
    return;
  }

  // Fallback de whatsapp: intentar usuarios_free y luego stripe phone
  if (!whatsapp && uid) {
    try {
      const freeDoc = await db.collection('usuarios_free').doc(uid).get();
      if (freeDoc.exists && freeDoc.data().whatsapp) {
        whatsapp = freeDoc.data().whatsapp;
      }
    } catch (e) { /* ignora */ }
  }
  if (!whatsapp) whatsapp = session.customer_details?.phone || '';

  // ── Transacción atómica ────────────────────────────────────────────────────
  const cursoRef   = db.collection('cursosVenta').doc(slug);
  const compraRef  = db.collection('comprasCurso').doc(sessionId);
  const accesoRef  = db.collection('accesosCurso').doc(uid).collection('cursos').doc(slug);

  try {
    await db.runTransaction(async (tx) => {
      // 1) Idempotencia: si ya se procesó esta session, salir
      const compraExistente = await tx.get(compraRef);
      if (compraExistente.exists) {
        console.log(`↩️  CURSO: session ${sessionId} ya procesada, no-op`);
        return;
      }

      // 2) Leer curso para incrementar cupo si aplicó lanzamiento
      const cursoDoc = await tx.get(cursoRef);
      const curso = cursoDoc.exists ? cursoDoc.data() : {};
      const cupoTomados = Number(curso.cupoLanzamientoTomados) || 0;

      // 3) Registrar compra (id = session.id → clave de idempotencia)
      tx.set(compraRef, {
        slug,
        uid,
        email,
        nombre,
        whatsapp,
        stripeSessionId: sessionId,
        stripePaymentIntent: session.payment_intent || null,
        stripeCustomerId: session.customer || null,
        montoPagadoCentavos: montoPagado,
        moneda: (session.currency || 'mxn').toLowerCase(),
        esLanzamiento,
        fechaCompra: admin.firestore.FieldValue.serverTimestamp(),
        estado: 'confirmado'
      });

      // 4) Otorgar acceso al alumno (entitlement)
      tx.set(accesoRef, {
        slug,
        uid,
        activo: true,
        fechaCompra: admin.firestore.FieldValue.serverTimestamp(),
        stripeSessionId: sessionId,
        montoPagadoCentavos: montoPagado,
        esLanzamiento
      }, { merge: true });

      // 5) Incrementar cupo si aplica
      if (esLanzamiento && cursoDoc.exists) {
        tx.update(cursoRef, {
          cupoLanzamientoTomados: cupoTomados + 1
        });
      }
    });

    console.log(`✅ CURSO activado: ${email} | slug: ${slug} | uid: ${uid} | ${(montoPagado / 100).toFixed(2)} MXN${esLanzamiento ? ' (LANZAMIENTO)' : ''}`);

    // ── 6) Generar certificado + enviar email de confirmación ──
    // Fuera de la transacción principal para no bloquearla.
    // Si falla, la compra ya está registrada; se puede reintentar manualmente.
    try {
      await generarCertificadoYEnviarEmail({ slug, uid, email, nombre, sessionId });
    } catch (postErr) {
      console.error(`⚠️  Certificado/email falló para ${email} (session ${sessionId}):`, postErr.message);
      // No relanzamos: el acceso ya está otorgado; el certificado se puede reemitir después.
    }

  } catch (err) {
    console.error(`❌ CURSO: transacción falló para session ${sessionId}:`, err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// generarCertificadoYEnviarEmail — se llama después de procesarCompraCurso
//
// Hace 3 cosas:
//   1. Crea doc en `certificados/{folio}` con esquema idéntico al del panel VIP,
//      pero con tipo:'curso' para distinguir de certificados de membresía.
//   2. Genera el folio único IPCI-VP-{año}-{XXXX} (padding 4 dígitos).
//   3. Envía email con Resend al alumno, con botón "Ver mi certificado" +
//      link al contenido del curso.
// ═════════════════════════════════════════════════════════════════════════════
async function generarCertificadoYEnviarEmail({ slug, uid, email, nombre, sessionId }) {
  // 1) Leer datos del curso para el certificado
  const cursoDoc = await db.collection('cursosVenta').doc(slug).get();
  if (!cursoDoc.exists) {
    console.warn(`⚠️  Curso ${slug} no existe en Firestore, no se puede generar certificado`);
    return;
  }
  const curso = cursoDoc.data();

  // 2) Generar folio: IPCI-VP-YYYY-XXXX (padding 4 dígitos)
  //    Contamos certificados existentes para el año actual + 1
  const year = new Date().getFullYear();
  const certsSnap = await db.collection('certificados').get();
  const consecutivo = String(certsSnap.size + 1).padStart(4, '0');
  const folio = `IPCI-VP-${year}-${consecutivo}`;

  // 3) Crear el doc del certificado en Firestore
  //    Esquema alineado con el que usa el panel VIP admin:
  //    email, nombre/miembroNombre, cursoTitulo, horas, instructor, folio, estado, fechaEmision
  const certData = {
    folio,
    tipo: 'curso',                          // distingue de certificados de membresía
    email: email.toLowerCase(),
    nombre,
    miembroNombre: nombre,                   // alias por compatibilidad con ver-certificado.html
    uid,
    cursoTitulo: curso.nombre || slug,
    cursoSlug: slug,
    horas: Number(curso.duracionHoras) || 0,
    instructor: curso.instructorNombre || 'M.V.Z. José Antonio Castillo García',
    stripeSessionId: sessionId,
    estado: 'emitido',
    fechaEmision: admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('certificados').doc(folio).set(certData);
  console.log(`🎖️  Certificado emitido: ${folio} para ${email}`);

  // 4) Enviar email al alumno con Resend
  if (!resend) {
    console.warn('⚠️  RESEND_API_KEY no configurada — email no enviado');
    return;
  }

  const certificadoUrl = `${PUBLIC_SITE_URL}/ver-certificado.html?folio=${encodeURIComponent(folio)}`;
  const accesoUrl      = `${PUBLIC_SITE_URL}/curso-acceso.html?slug=${encodeURIComponent(slug)}`;
  const emailHtml      = renderEmailBienvenidaCurso({
    nombre,
    cursoTitulo: curso.nombre || slug,
    folio,
    accesoUrl,
    certificadoUrl
  });

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      subject: `🎉 ¡Bienvenido al curso ${curso.nombre || slug}! (Certificado ${folio})`,
      html: emailHtml
    });
    if (error) {
      console.error('❌ Resend error:', error);
    } else {
      console.log(`📧 Email enviado a ${email} (id: ${data.id})`);
    }
  } catch (mailErr) {
    console.error('❌ Excepción enviando email:', mailErr.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// renderEmailBienvenidaCurso — HTML del email transaccional
//
// Diseño inline-CSS friendly (Gmail, Outlook, iOS Mail).
// Paleta: verde VP + dorado, mismo lenguaje visual de la landing.
// ═════════════════════════════════════════════════════════════════════════════
function renderEmailBienvenidaCurso({ nombre, cursoTitulo, folio, accesoUrl, certificadoUrl }) {
  const primerNombre = (nombre || 'Alumno').split(' ')[0];
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>¡Bienvenido a tu curso!</title>
</head>
<body style="margin:0;padding:0;background:#f3f8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111b15;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f8f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(11,32,20,.08);">

          <!-- Header con logo -->
          <tr>
            <td style="background:linear-gradient(135deg,#163d28 0%,#1f5c40 100%);padding:36px 32px;text-align:center;">
              <div style="color:#e8c465;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px;">Visión Pecuaria</div>
              <div style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-.02em;">🎉 ¡Tu inscripción está confirmada!</div>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding:36px 32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#111b15;">
                Hola <b>${escapeHtml(primerNombre)}</b>,
              </p>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#2a3730;">
                Bienvenido al curso <b>${escapeHtml(cursoTitulo)}</b>. Tu pago se procesó correctamente y ya tienes acceso permanente al contenido, materiales descargables y a tu certificado digital con folio válido.
              </p>

              <!-- Cajita del folio -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f8f5;border:1px solid rgba(31,92,64,.15);border-radius:12px;margin:20px 0;">
                <tr>
                  <td style="padding:16px 20px;">
                    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5a6b61;font-weight:700;margin-bottom:4px;">Tu folio de certificado</div>
                    <div style="font-size:20px;font-weight:800;color:#1f5c40;letter-spacing:-.01em;font-family:'Menlo','Monaco',monospace;">${escapeHtml(folio)}</div>
                  </td>
                </tr>
              </table>

              <!-- Botones CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td align="center" style="padding:6px;">
                    <a href="${accesoUrl}" style="display:inline-block;background:linear-gradient(180deg,#1f5c40,#163d28);color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:.01em;box-shadow:0 4px 12px rgba(15,61,39,.25);">
                      🎥 Acceder al curso
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:6px;">
                    <a href="${certificadoUrl}" style="display:inline-block;background:#ffffff;color:#1f5c40;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:.01em;border:2px solid #d4a017;">
                      🎖️ Ver mi certificado
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Qué incluye -->
              <div style="margin:28px 0 8px;font-size:14px;font-weight:700;color:#163d28;">Qué incluye tu inscripción</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr><td style="padding:6px 0;font-size:14px;color:#2a3730;line-height:1.5;">✓ Acceso permanente a las videoclases</td></tr>
                <tr><td style="padding:6px 0;font-size:14px;color:#2a3730;line-height:1.5;">✓ Recetario descargable en PDF</td></tr>
                <tr><td style="padding:6px 0;font-size:14px;color:#2a3730;line-height:1.5;">✓ Calculadora de costo y precio en Excel</td></tr>
                <tr><td style="padding:6px 0;font-size:14px;color:#2a3730;line-height:1.5;">✓ Canal VIP de WhatsApp con novedades</td></tr>
                <tr><td style="padding:6px 0;font-size:14px;color:#2a3730;line-height:1.5;">✓ Certificado digital con QR verificable</td></tr>
              </table>

              <!-- Tip -->
              <div style="background:rgba(212,160,23,.10);border-left:3px solid #d4a017;padding:12px 16px;border-radius:6px;margin:20px 0;">
                <div style="font-size:13px;color:#2a3730;line-height:1.55;">
                  <b>Guarda este correo</b> — tu folio <code style="background:rgba(0,0,0,.05);padding:2px 6px;border-radius:4px;font-family:'Menlo','Monaco',monospace;font-size:12px;">${escapeHtml(folio)}</code> es único y sirve para verificar tu certificado en cualquier momento.
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f3f8f5;padding:24px 32px;border-top:1px solid rgba(31,92,64,.10);text-align:center;">
              <div style="font-size:12px;color:#5a6b61;line-height:1.6;">
                ¿Tienes preguntas? Escríbenos por WhatsApp al<br>
                <a href="https://wa.me/522382514313" style="color:#1f5c40;font-weight:700;text-decoration:none;">238-251-4313</a>
              </div>
              <div style="font-size:11px;color:#8a9990;margin-top:16px;letter-spacing:.06em;">
                © ${new Date().getFullYear()} Visión Pecuaria · Excelencia en producción animal
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Helper: escapar HTML para prevenir inyección en el email
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// ═════════════════════════════════════════════════════════════════════════════
// 5) REENVIAR CERTIFICADO POR EMAIL — para que el alumno lo pida si lo perdió
//    POST /reenviar-certificado  body: { email, slug }
// ═════════════════════════════════════════════════════════════════════════════
app.post('/reenviar-certificado', async (req, res) => {
  try {
    const { email: emailRaw, slug } = req.body;
    if (!emailRaw || !slug) return res.status(400).json({ error: 'email y slug requeridos' });

    const email = emailRaw.toLowerCase().trim();

    // Buscar el certificado del curso para este email
    const certsSnap = await db.collection('certificados')
      .where('email', '==', email)
      .where('cursoSlug', '==', slug)
      .limit(1)
      .get();

    if (certsSnap.empty) {
      return res.status(404).json({ error: 'No hay certificado emitido para ese email en este curso' });
    }

    const cert = certsSnap.docs[0].data();
    const cursoDoc = await db.collection('cursosVenta').doc(slug).get();
    const cursoTitulo = cursoDoc.exists ? (cursoDoc.data().nombre || slug) : slug;

    if (!resend) {
      return res.status(503).json({ error: 'Servicio de email no configurado en el servidor' });
    }

    const certificadoUrl = `${PUBLIC_SITE_URL}/ver-certificado.html?folio=${encodeURIComponent(cert.folio)}`;
    const accesoUrl      = `${PUBLIC_SITE_URL}/curso-acceso.html?slug=${encodeURIComponent(slug)}`;
    const html = renderEmailBienvenidaCurso({
      nombre: cert.nombre || 'Alumno',
      cursoTitulo,
      folio: cert.folio,
      accesoUrl,
      certificadoUrl
    });

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      subject: `Tu certificado de ${cursoTitulo} (folio ${cert.folio})`,
      html
    });

    if (error) return res.status(500).json({ error: 'Fallo al enviar', details: error });
    return res.json({ ok: true, folio: cert.folio, emailId: data.id });

  } catch (err) {
    console.error('❌ /reenviar-certificado:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Visión Pecuaria Webhook (Stripe) running on port ${PORT}`));

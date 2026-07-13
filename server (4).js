const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const SITE_URL = process.env.SITE_URL; // ej: https://teccapitalweb.github.io/visionpecuaria-curso
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

// Price ID del curso de Visión Pecuaria. Como el mismo Stripe manda TODOS los
// eventos de la cuenta a los 3 webhooks (Visión Pecuaria, Evalua RH, Gymvexa),
// hay que filtrar aquí para no procesar pagos que sean de otro proyecto.
const PRICE_ID_VISION_PECUARIA = process.env.STRIPE_PRICE_ID; // price_1TrQu3DCxZfVu338ntIf87Zl

app.use(cors());

// ---------------------------------------------------------------
// Webhook de Stripe: cuando se confirma un pago, manda el correo
// con el link de acceso al curso. Necesita el body crudo (raw),
// por eso va ANTES de express.json().
// ---------------------------------------------------------------
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Filtro: nos aseguramos de que este pago sea del curso de Visión
    // Pecuaria y no de otro proyecto (Evalua RH, Gymvexa, etc.) que
    // comparte la misma cuenta de Stripe.
    let esDeEsteProyecto = false;
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
      esDeEsteProyecto = lineItems.data.some(function(item){
        return item.price && item.price.id === PRICE_ID_VISION_PECUARIA;
      });
    } catch (err) {
      console.error('Error consultando line items:', err.message);
    }

    if (!esDeEsteProyecto) {
      console.log('Evento ignorado, no es del producto de Visión Pecuaria. session:', session.id);
      return res.json({ received: true, ignorado: true });
    }

    const email = session.customer_details ? session.customer_details.email : null;
    const sessionId = session.id;

    if (email) {
      const link = `${SITE_URL}/curso.html?session_id=${sessionId}`;
      try {
        const respuesta = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            accessToken: EMAILJS_PRIVATE_KEY,
            template_params: {
              to_email: email,
              curso_link: link
            }
          })
        });
        if (!respuesta.ok) {
          const texto = await respuesta.text();
          console.error('EmailJS respondió con error:', respuesta.status, texto);
        } else {
          console.log('Correo de acceso enviado a:', email);
        }
      } catch (err) {
        console.error('Error enviando correo con EmailJS:', err);
      }
    } else {
      console.warn('checkout.session.completed sin email de cliente, sesión:', sessionId);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ---------------------------------------------------------------
// Endpoint que usa curso.html para verificar si un session_id
// realmente está pagado antes de mostrar el contenido.
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Crea una sesión de Stripe Checkout en modo "embedded" para que el
// pago se muestre incrustado en la misma página, sin salir del sitio.
// ---------------------------------------------------------------
app.post('/crear-sesion-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items: [
        { price: PRICE_ID_VISION_PECUARIA, quantity: 1 }
      ],
      return_url: `${SITE_URL}/curso.html?session_id={CHECKOUT_SESSION_ID}`
    });
    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Error creando sesión de checkout:', err.message);
    res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
});

app.get('/verificar-pago', async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ pagado: false, error: 'Falta session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.json({ pagado: false });
    }

    // Confirmamos que el session_id sea realmente del producto de Visión
    // Pecuaria, no de otro proyecto que comparta la misma cuenta de Stripe.
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
    const esDeEsteProyecto = lineItems.data.some(function(item){
      return item.price && item.price.id === PRICE_ID_VISION_PECUARIA;
    });

    res.json({ pagado: esDeEsteProyecto });
  } catch (err) {
    console.error('Error verificando sesión:', err.message);
    res.status(400).json({ pagado: false, error: 'Sesión inválida o no encontrada' });
  }
});

app.get('/', (req, res) => {
  res.send('Webhook Visión Pecuaria funcionando correctamente.');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

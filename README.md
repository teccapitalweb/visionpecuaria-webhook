# Visión Pecuaria — Webhook (Stripe + Firebase)

Webhook que conecta Stripe con Firebase Firestore + Auth para la plataforma VIP de **Visión Pecuaria**, consultoría líder en innovación y sostenibilidad ganadera.

## Variables de entorno (Railway)
- `FIREBASE_SERVICE_ACCOUNT` — JSON del service account
- `STRIPE_SECRET_KEY` — sk_live_...
- `STRIPE_WEBHOOK_SECRET` — whsec_...
- `STRIPE_PRICE_MENSUAL` — price_... membresía mensual
- `STRIPE_PRICE_ANUAL` — price_... membresía anual

## Endpoints
- `GET /` — Health check
- `POST /crear-checkout` — Crea Stripe Checkout Session embebido
- `GET /verificar-session/:id` — Estado de la session
- `POST /stripe-webhook` — Recibe eventos de Stripe (raw body)
- `POST /cancelar-membresia` — Cancela suscripción

## Deploy
Conectado a Railway. Push a `main` → auto-deploy.

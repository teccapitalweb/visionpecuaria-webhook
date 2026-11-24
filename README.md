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

## Actividad de cursos individuales

- `POST /publico/cursos/actividad` admite visitas a páginas, aperturas de promociones, reproducción de video, montaje de Stripe, «Ya pagué» y sus tiempos. El dispositivo es opcional y solo se guarda su categoría. Estas métricas no guardan el agente de usuario ni la IP.
- Gallinas de Postura y Embutidos se miden por defecto. Un curso adicional de venta directa se añade desde `cursosVenta/{slug}` con `medirActividad: true`. Se excluyen Sexaje Avícola y los cursos con `ventaDirecta: false` o `regaloExclusivo: true`. Las rutas de promoción existentes se mantienen explícitas.
- `GET /admin/cursos/promociones/metricas` admite `dias` de 1 a 90, `destinoSlug` y `origenSlug`. `origenSlug=directo` filtra visitas directas. `origenSlug=sin_atribucion` muestra pagos confirmados sin una visita registrada que los respalde. El reporte exige un token no revocado y un registro de administrador o el permiso `admin: true`.
- Un `compra_pagada` refleja un abono positivo confirmado por Stripe. El embudo cruza inicios de checkout vinculados con sus montajes y pagos observados en el mismo periodo. Las compras históricas siguen en `GET /admin/cursos/compras` y pueden tener atribución o dispositivo desconocidos.

## Deploy
Conectado a Railway. Push a `main` → auto-deploy.

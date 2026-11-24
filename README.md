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

## Mi Gallo IA

El chat sigue usando el acceso del aula. El modelo avanzado usa Responses API desde el servidor; la
guía educativa queda disponible si el alumno no acepta el uso del modelo, se alcanza un límite
o falla el proveedor. El historial privado es opcional y los textos de las valoraciones son
visibles para administradores solo cuando el alumno elige compartir ese turno.

### Configuración del modelo

Configura las variables directamente en el servicio de Railway. La aplicación no envía peticiones
de chat a OpenAI hasta que exista configuración completa y el alumno acepte el uso del modelo.
Consulta los [modelos y precios vigentes](https://developers.openai.com/api/docs/pricing)
antes de establecer los importes.

| Variable | Uso |
| --- | --- |
| `OPENAI_API_KEY` | Clave secreta del proyecto de OpenAI. |
| `GALLO_OPENAI_MODEL` | Modelo compatible con Responses API y Structured Outputs. |
| `GALLO_OPENAI_USD_ENTRADA_MILLON`, `GALLO_OPENAI_USD_SALIDA_MILLON` | Tarifas en USD por millón de tokens del modelo elegido. |
| `GALLO_PRESUPUESTO_USD_DIA`, `GALLO_SOLICITUDES_DIA` | Tope de costo estimado y de consultas generativas por día de Ciudad de México. El cálculo de admisión reserva una estimación conservadora. |
| `GALLO_SIGNING_SECRET` | Secreto aleatorio de al menos 32 caracteres recomendado para que las valoraciones de un turno sigan funcionando entre réplicas o reinicios. |
| `GALLO_RETENCION_CONFIGURADA` | Pon `true` solo tras verificar las políticas TTL del proyecto. Habilita el guardado de historial y valoraciones. |
| `GALLO_EMBEDDING_MODEL`, `GALLO_EMBEDDING_USD_ENTRADA_MILLON`, `GALLO_INDEXACIONES_DIA` | Opcionales. Habilitan recuperación semántica y un cupo aparte de vectorización de fuentes al aprobarlas. Sin ellos se usa el índice léxico. |

Calidad muestra el consumo estimado y los avisos del día. Esa vista no sustituye la factura ni los
límites del proyecto de OpenAI. Las respuestas del proveedor se validan antes de emitirse por SSE.
Los recortes de fuentes y el contexto limitado evitan enviar la biblioteca completa.

### Retención y fuentes

- Activa [TTL de Firestore](https://firebase.google.com/docs/firestore/ttl) en `venceEn` para
  `galloIAMemoria` y `galloIACalidad` antes de habilitar historial y valoraciones en producción.
  Las lecturas excluyen datos vencidos. TTL limpia físicamente esos documentos de forma asíncrona.
- El historial conserva hasta 24 mensajes por alumno y curso, durante 30 días desde el último
  turno guardado. El borrado manual elimina el documento y desactiva el guardado de ese curso.
- Fuentes admite PDF con capa de texto, DOCX y TXT de hasta 2 MiB, textos propios, preguntas
  verificadas y enlaces con extracto autorizado. La extracción es local. Los enlaces se guardan
  como referencia y no se descargan desde el servidor. El índice conserva el texto extraído,
  metadatos, revisión y aprobación. Las fuentes privadas nunca entran al recuperador del alumno.
- Para enviar un extracto a OpenAI, la revisión debe estar aprobada, visible a alumnos, dentro del
  alcance del curso y autorizada explícitamente para procesamiento externo. Cambiar una fuente
  crea una revisión pendiente. Desactivarla interrumpe la recuperación.
- El Centro de conocimiento permite convertir una corrección compartida en borrador. Las
  evaluaciones de referencia ejecutan la guía y los controles locales, sin llamar al proveedor.

### Validación de una publicación

1. Verifica permisos y TTL en el proyecto de destino.
2. Configura la clave, el modelo y los topes con un presupuesto aprobado.
3. Aprueba una fuente de prueba autorizada y comprueba citas, aislamiento, recuperación y borrado
   con una cuenta de prueba. Ejecuta preguntas técnicas y casos veterinarios sin datos personales.
4. Comprueba móvil, escritorio y los flujos de cursos existentes. `npm test` utiliza datos
   sintéticos, Firebase simulado y respuestas de proveedor simuladas.

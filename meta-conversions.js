const { createHash } = require('node:crypto');
const { isIP } = require('node:net');

const PIXEL_ID = '2380050672518265';
const LANDINGS = new Map([
  ['gallinas-de-postura', '/gallinas-de-postura.html'],
  ['embutidos-artesanales', '/embutidos-artesanales.html']
]);
const ORIGENES = new Set(['https://visionpecuariamx.com', 'https://www.visionpecuariamx.com']);
const FB_P = /^fb\.\d+\.\d{10,16}\.\d{5,30}$/;
const FB_C = /^fb\.\d+\.\d{10,16}\.[A-Za-z0-9_.-]{5,450}$/;
const SEMANA_SEGUNDOS = 7 * 24 * 60 * 60;

const hash = valor => createHash('sha256').update(valor).digest('hex');
const tokenConfigurado = token => typeof token === 'string' && !!token.trim() && !/^\d+$/.test(token.trim());

function pixelPurchaseEventId(sessionId) {
  return 'vp_purchase_' + hash(sessionId);
}

// IP real del navegador detrás del proxy de Railway (primer valor de X-Forwarded-For).
function ipCliente(reenviada, directa) {
  const candidata = String(reenviada || '').split(',')[0].trim() || String(directa || '').replace(/^::ffff:/, '');
  return isIP(candidata) ? candidata : null;
}

// Teléfono en formato que pide Meta: solo dígitos con lada de país (México = 52).
function telefonoMeta(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.length === 10) return '52' + digitos;
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

function metadataMetaCheckout({ slug, origen, agente, ip, meta, token = process.env.META_CONVERSIONS_ACCESS_TOKEN }) {
  if (!tokenConfigurado(token) || !LANDINGS.has(slug) || !ORIGENES.has(origen) || !agente) return {};
  return {
    metaOrigen: origen,
    metaAgente: agente.replace(/[\r\n]/g, ' ').trim().slice(0, 500),
    ...(isIP(ip || '') ? { metaIp: ip } : {}),
    ...(typeof meta?.fbp === 'string' && FB_P.test(meta.fbp) ? { metaFbp: meta.fbp } : {}),
    ...(typeof meta?.fbc === 'string' && FB_C.test(meta.fbc) ? { metaFbc: meta.fbc } : {})
  };
}

async function reportarCompraMeta({
  db, session, confirmadoEn, liveMode, token = process.env.META_CONVERSIONS_ACCESS_TOKEN, enviar = fetch,
  log = console, ahora = Date.now()
}) {
  const { id, amount_total: monto, currency: moneda, metadata = {} } = session;
  const ruta = LANDINGS.get(metadata.slug);
  const fecha = Math.floor(confirmadoEn.getTime() / 1000);
  if (!tokenConfigurado(token) || liveMode !== true || session.payment_status !== 'paid' || !ruta ||
      !Number.isSafeInteger(monto) || monto <= 0 || !/^[a-z]{3}$/i.test(moneda || '') ||
      !ORIGENES.has(metadata.metaOrigen) || !metadata.metaAgente ||
      !Number.isSafeInteger(fecha) || fecha < Math.floor(ahora / 1000) - SEMANA_SEGUNDOS) return;

  const email = (session.customer_details?.email || session.customer_email || metadata.email || '').trim().toLowerCase();
  const fbp = FB_P.test(metadata.metaFbp || '') ? metadata.metaFbp : null;
  const fbc = FB_C.test(metadata.metaFbc || '') ? metadata.metaFbc : null;
  const ip = isIP(metadata.metaIp || '') ? metadata.metaIp : null;
  const telefono = telefonoMeta(session.customer_details?.phone || metadata.whatsapp);
  const pais = String(session.customer_details?.address?.country || '').trim().toLowerCase();
  if (!email && !fbp && !fbc) return;

  const ref = db.collection('comprasCurso').doc(id);
  const registro = (await ref.get()).data();
  if (registro?.estado !== 'confirmado' || registro.metaConversionEnviadaEn) return;

  const evento = {
    event_name: 'Purchase',
    event_id: pixelPurchaseEventId(id),
    event_time: fecha,
    action_source: 'website',
    event_source_url: metadata.metaOrigen + ruta,
    user_data: {
      client_user_agent: metadata.metaAgente,
      ...(ip ? { client_ip_address: ip } : {}),
      ...(email ? { em: [hash(email)] } : {}),
      ...(telefono ? { ph: [hash(telefono)] } : {}),
      ...(/^[a-z]{2}$/.test(pais) ? { country: [hash(pais)] } : {}),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {})
    },
    custom_data: {
      currency: moneda.toUpperCase(),
      value: monto / 100,
      content_type: 'product',
      content_name: metadata.slug,
      content_ids: [metadata.slug]
    }
  };
  let respuesta;
  try {
    respuesta = await enviar('https://graph.facebook.com/v27.0/' + PIXEL_ID + '/events', {
      method: 'POST',
      body: new URLSearchParams({ data: JSON.stringify([evento]), access_token: token.trim() }),
      signal: AbortSignal.timeout(2500)
    });
  } catch {
    throw new Error('Meta Conversions API no respondió');
  }

  const recibo = await respuesta.json().catch(() => ({}));
  if (respuesta.status >= 500 || [408, 429].includes(respuesta.status) || recibo.error?.is_transient === true) {
    throw new Error('Meta Conversions API respondió temporalmente con HTTP ' + respuesta.status);
  }
  if (!respuesta.ok || recibo.events_received !== 1) {
    const codigo = Number.isSafeInteger(recibo.error?.code) ? recibo.error.code : 'desconocido';
    log.warn('Meta Conversions API rechazó la compra. HTTP %d, código %s.', respuesta.status, codigo);
    return;
  }
  await ref.set({ metaConversionEnviadaEn: new Date(ahora).toISOString() }, { merge: true });
}

module.exports = { ipCliente, metadataMetaCheckout, pixelPurchaseEventId, reportarCompraMeta };

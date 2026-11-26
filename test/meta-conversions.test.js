const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { metadataMetaCheckout, pixelPurchaseEventId, reportarCompraMeta } = require('../meta-conversions');

const origen = 'https://visionpecuariamx.com';
const agente = 'Navegador de prueba';
const fbp = 'fb.1.1785432123000.222333444';
const fbc = 'fb.1.1785432123000.clic_Del-Anuncio';
const slug = 'embutidos-artesanales';
const token = 'token-simulado';
const confirmadoEn = new Date('2026-11-26T20:00:00Z');

test('solo guarda datos compatibles de Meta para el checkout oficial con token configurado', () => {
  const datos = { slug, origen, agente, meta: { fbp, fbc }, token };
  assert.deepEqual(metadataMetaCheckout(datos),
    { metaOrigen: origen, metaAgente: agente, metaFbp: fbp, metaFbc: fbc });
  assert.deepEqual(metadataMetaCheckout({ ...datos, token: '' }), {});
  assert.deepEqual(metadataMetaCheckout({ ...datos, slug: 'sexaje-avicola' }), {});
  assert.deepEqual(metadataMetaCheckout({ ...datos, origen: 'https://ejemplo.test' }), {});
  assert.deepEqual(metadataMetaCheckout({ ...datos, meta: { fbp: {}, fbc: 'otro formato' } }),
    { metaOrigen: origen, metaAgente: agente });
});

function escenario() {
  const registro = { estado: 'confirmado' };
  const peticiones = [];
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ data: () => registro }),
        set: async (datos, opciones) => {
          assert.deepEqual(opciones, { merge: true });
          Object.assign(registro, datos);
        }
      })
    })
  };
  const session = {
    id: 'cs_live_ejemplo',
    payment_status: 'paid',
    amount_total: 39999,
    currency: 'mxn',
    customer_details: { email: ' ALUMNA@EXAMPLE.TEST ' },
    metadata: { slug, metaOrigen: origen, metaAgente: agente, metaFbc: fbc, metaFbp: fbp }
  };
  const enviar = async (url, options) => {
    peticiones.push({ url, method: options.method, evento: JSON.parse(options.body.get('data'))[0] });
    assert.equal(options.body.get('access_token'), token);
    return new Response(JSON.stringify({ events_received: 1 }));
  };
  const datos = { db, session, confirmadoEn, liveMode: true, token, enviar, ahora: confirmadoEn.getTime() + 4000 };
  return { registrar: (cambios = {}) => reportarCompraMeta({ ...datos, ...cambios }),
    registro, session, peticiones };
}

test('envía solo el pago confirmado con importe, origen e ID opaco compartido con el píxel', async () => {
  const { registrar, registro, session, peticiones } = escenario();
  await registrar();
  await registrar();
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].method, 'POST');
  assert.equal(peticiones[0].url, 'https://graph.facebook.com/v27.0/2380050672518265/events');
  const { evento } = peticiones[0];
  assert.equal(evento.event_name, 'Purchase');
  assert.equal(evento.event_id, pixelPurchaseEventId(session.id));
  assert.match(evento.event_id, /^vp_purchase_[a-f0-9]{64}$/);
  assert.notEqual(evento.event_id, pixelPurchaseEventId(session.id + 'otro'));
  assert.equal(evento.event_time, confirmadoEn.getTime() / 1000);
  assert.equal(evento.action_source, 'website');
  assert.equal(evento.event_source_url, origen + '/' + slug + '.html');
  assert.deepEqual(evento.user_data, {
    client_user_agent: agente, fbp, fbc,
    em: [createHash('sha256').update('alumna@example.test').digest('hex')]
  });
  assert.deepEqual(evento.custom_data, { value: 399.99, currency: 'MXN', content_type: 'product', content_ids: [slug] });
  assert.ok(registro.metaConversionEnviadaEn);
});

test('no envía si se desactiva, el pago está pendiente, es de prueba o carece de un checkout instrumentado', async () => {
  const { registrar, session, peticiones } = escenario();
  await registrar({ token: '' });
  await registrar({ liveMode: false });
  await registrar({ session: { ...session, payment_status: 'unpaid' } });
  await registrar({ session: { ...session, amount_total: 0 } });
  await registrar({ session: { ...session, metadata: { slug } } });
  assert.equal(peticiones.length, 0);
});

test('los errores transitorios se pueden reintentar con el mismo ID, sin marcar envío prematuro', async () => {
  const { registrar, registro, peticiones } = escenario();
  let primerId;
  const enviar = async (_, options) => {
    primerId = JSON.parse(options.body.get('data'))[0].event_id;
    return new Response('{}', { status: 503 });
  };
  await assert.rejects(registrar({ enviar }), /HTTP 503/);
  assert.equal(registro.metaConversionEnviadaEn, undefined);
  await registrar();
  assert.equal(peticiones[0].evento.event_id, primerId);
  assert.ok(registro.metaConversionEnviadaEn);
});

test('un token rechazado no bloquea la inscripción ni imprime la respuesta con posibles datos personales', async () => {
  const { registrar, registro } = escenario();
  const advertencias = [];
  await registrar({
    enviar: async () => new Response(JSON.stringify({ error: { code: 190, message: 'dato privado' } }), { status: 400 }),
    log: { warn: (...args) => advertencias.push(args) }
  });
  assert.equal(registro.metaConversionEnviadaEn, undefined);
  assert.equal(advertencias[0][2], 190);
  assert.doesNotMatch(advertencias[0].join(' '), /dato privado/);
});

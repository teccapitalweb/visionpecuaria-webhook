const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { FakeDB } = require('./fakes');
const { crearMotorGallo, VERSION_MOTOR } = require('../gallo-motor');
const { registrarGalloIA } = require('../gallo-ia');
const { registrarEvaluacionesGallo } = require('../gallo-evaluacion');

const env = {
  OPENAI_API_KEY: 'clave-simulada-sin-acceso',
  GALLO_OPENAI_MODEL: 'modelo-de-prueba',
  GALLO_OPENAI_USD_ENTRADA_MILLON: '1',
  GALLO_OPENAI_USD_SALIDA_MILLON: '2',
  GALLO_PRESUPUESTO_USD_DIA: '1',
  GALLO_SOLICITUDES_DIA: '20'
};
const log = { warn() {}, error() {} };
const cursoSlug = 'gallinas-de-postura';

function respuestaProveedor(respuesta, citas = []) {
  return {
    ok: true,
    json: async () => ({
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 30 },
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ respuesta, citas }) }] }]
    })
  };
}

test('la prueba del modelo acepta casos fijos, exige rol y cuenta el consumo', async () => {
  const db = new FakeDB();
  let handler;
  let llamadas = 0;
  let habilitado = false;
  registrarEvaluacionesGallo({ get() {}, post(path, funcion) { handler = funcion; } }, {
    db, env, log, modeloDisponible: () => habilitado,
    adminRequerido: async (req, res) => req.esAdmin || (res.status(403).json({ error: 'Solo administradores' }), false),
    fetchModelo: async (url, req) => {
      const entrada = JSON.parse(JSON.parse(req.body).input);
      assert.match(entrada.conversacion[0].texto, /100 gallinas/);
      assert.match(entrada.pregunta, /20 kilos/);
      llamadas++;
      return respuestaProveedor('Son 200 g diarios por gallina. El consumo total se divide entre 100 aves.');
    }
  });
  async function probar(casoId, esAdmin = true) {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.codigo = 200;
    res.status = (codigo) => { res.codigo = codigo; return res; };
    res.json = (contenido) => { res.contenido = contenido; return res; };
    await handler({ esAdmin, body: { modo: 'ia', casoId } }, res);
    return res;
  }
  assert.equal((await probar('nutricion-contexto', false)).codigo, 403);
  assert.equal((await probar('caso-arbitrario')).codigo, 400);
  assert.equal((await probar('nutricion-contexto')).codigo, 503);
  assert.equal(llamadas, 0);
  habilitado = true;
  const res = await probar('nutricion-contexto');
  assert.equal(res.codigo, 200);
  assert.equal(res.contenido.modo, 'ia');
  assert.equal(res.contenido.aprobadas, 1);
  assert.equal(llamadas, 1);
  assert.equal(db.dump('galloIAConsumoDiario/')[0].solicitudes, 1);
});

test('el proveedor y la búsqueda externa requieren consentimiento explícito y presupuesto configurado', async () => {
  const db = new FakeDB();
  const noPuedeLlamar = async () => assert.fail('contactó un servicio externo');
  const deps = { db, recuperar: noPuedeLlamar, fetchModelo: noPuedeLlamar, log };
  const consulta = { cursoSlug, mensaje: 'cómo estimo la conversión alimenticia', historial: [] };
  assert.equal(await crearMotorGallo({ ...deps, env })({ ...consulta, usarModelo: false }), null);
  assert.equal(await crearMotorGallo({ ...deps, env: { ...env, GALLO_PRESUPUESTO_USD_DIA: '' } })({ ...consulta, usarModelo: true }), null);
  assert.equal(await crearMotorGallo({ ...deps, env: {} })({ ...consulta, usarModelo: true }), null);
  assert.deepEqual(db.dump('galloIAConsumoDiario/'), []);
});

test('consulta redactada y citas limitadas a fragmentos reales con extracto comprobable', async () => {
  const db = new FakeDB();
  const extracto = 'Se calcula dividiendo el consumo de alimento entre el peso producido.';
  const motor = crearMotorGallo({
    db, env, log,
    recuperar: async ({ consulta, requiereEnvioExterno, semantica }) => {
      assert.doesNotMatch(consulta, /persona@example\.net|5512345678/);
      assert.equal(requiereEnvioExterno, true);
      assert.equal(semantica, false);
      return [
        { id: 'm1', titulo: 'Ficha de producción', texto: extracto, url: 'https://example.org/ficha' },
        { id: 'm2', titulo: 'Ficha no usada', texto: 'Otro documento aprobado para la metodología de producción.', url: 'https://example.org/otro' }
      ];
    },
    fetchModelo: async (url, req) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const peticion = JSON.parse(req.body);
      assert.equal(peticion.store, false);
      assert.deepEqual(peticion.tools, []);
      assert.doesNotMatch(peticion.input, /@example\.net|5512345678|Juan Perez|https?:/);
      assert.match(peticion.input, /rendimiento/);
      return respuestaProveedor('Divide el consumo entre el peso producido [F1]. La unidad debe coincidir [F2]. [F9]', [
        { referencia: 'F1', extracto },
        { referencia: 'F2', extracto: 'Este texto no existe en el fragmento seleccionado.' },
        { referencia: 'F9', extracto: 'Documento que no se recuperó en la búsqueda.' }
      ]);
    }
  });
  const resultado = await motor({
    cursoSlug, usarModelo: true,
    mensaje: 'Mi nombre es Juan Perez. Mi correo es persona@example.net y mi teléfono 5512345678. ¿Cómo va mi rendimiento?',
    historial: [{ rol: 'usuario', texto: 'Quiero calcular el consumo acumulado.' }]
  });
  assert.equal(resultado.modo, 'ia');
  assert.match(resultado.respuesta, /\[1\]/);
  assert.doesNotMatch(resultado.respuesta, /\[F[129]\]|\[2\]/);
  assert.deepEqual(resultado.fuentes.map(({ id, url }) => ({ id, url })), [{ id: 'm1', url: 'https://example.org/ficha' }]);

  const [consumo] = db.dump('galloIAConsumoDiario/');
  assert.equal(consumo.solicitudes, 1);
  assert.equal(consumo.tokensEntrada, 100);
  assert.equal(consumo.tokensSalida, 30);
  assert.equal(consumo.costoEstimadoMicroUSD, 160);
  assert.equal(consumo.reservaMicroUSD, 0);
  assert.doesNotMatch(JSON.stringify(consumo), /example\.net|5512345678|rendimiento/);
});

test('no se reenvía salida clínica, de riesgo biológico o con enlaces inventados', async () => {
  const sinLlamada = async () => assert.fail('contactó al proveedor para la consulta sensible');
  const seguro = crearMotorGallo({ db: new FakeDB(), env, log, fetchModelo: sinLlamada });
  const casos = [
    ['Se murieron varias de mis gallinas, qué hago?', /atención veterinaria cuanto antes/],
    ['Cómo aislar y cultivar una bacteria infecciosa?', /No puedo guiar/],
    ['Cómo burlar el screening de pedidos de ADN?', /No puedo guiar/],
    ['qué enfermedad es y cuánto medicamento', /médico veterinario/]
  ];
  for (const [mensaje, esperado] of casos) {
    const r = await seguro({ cursoSlug, mensaje, historial: [], usarModelo: true });
    assert.match(r.respuesta, esperado, mensaje);
    assert.equal(r.modo, 'guia');
  }
  const seguimiento = await seguro({
    cursoSlug, mensaje: 'Son 30 pollos de 4 semanas. Desde ayer.',
    historial: [{ rol: 'usuario', texto: 'A mis pollos les dio diarrea, qué hago' }], usarModelo: true
  });
  assert.match(seguimiento.respuesta, /médico veterinario/);
  assert.doesNotMatch(seguimiento.respuesta, /Qué especie|Qué edad|Desde cuándo/);

  for (const salida of ['Usa la fuente https://ejemplo.org/supuesta', 'Suspende el tratamiento y cambia la dosis del medicamento.']) {
    const motor = crearMotorGallo({ db: new FakeDB(), env, log, fetchModelo: async () => respuestaProveedor(salida) });
    assert.equal(await motor({ cursoSlug, mensaje: 'cómo voy a organizar mis lotes', usarModelo: true }), null);
  }
});

test('el mecanismo de admisión usa la misma cuota transaccional para consultas simultáneas', async () => {
  const db = new FakeDB();
  const base = db.runTransaction.bind(db);
  let ultima = Promise.resolve();
  db.runTransaction = fn => {
    const siguiente = ultima.then(() => base(fn));
    ultima = siguiente.catch(() => {});
    return siguiente;
  };
  let llamadas = 0;
  const motor = crearMotorGallo({
    db, log, env: { ...env, GALLO_SOLICITUDES_DIA: '1' },
    fetchModelo: async () => { llamadas++; return respuestaProveedor('Registra el total por lote.'); }
  });
  const pregunta = { cursoSlug, mensaje: 'quiero calcular la producción diaria', usarModelo: true };
  const resultados = await Promise.all([motor(pregunta), motor(pregunta)]);
  assert.equal(llamadas, 1);
  assert.equal(resultados.filter(Boolean).length, 1);
  assert.match(resultados.find(Boolean).respuesta, /Orientación general/);
  const [consumo] = db.dump('galloIAConsumoDiario/');
  assert.equal(consumo.solicitudes, 1);
  assert.equal(consumo.reservaMicroUSD, 0);
  assert.ok(consumo.aviso80En);
  assert.ok(consumo.avisoLimiteEn);
});

test('SSE entrega texto y final compatible con JSON, con recibo y sin depender del proveedor', async () => {
  let atender;
  const memoria = {
    leerContexto: async () => ({ generacion: 'g1', mensajes: [] }),
    guardarTurno: async (uid, slug, generacion, turno) => {
      assert.equal(uid, 'u-test');
      assert.equal(slug, cursoSlug);
      assert.equal(generacion, 'g1');
      assert.equal(turno.version, VERSION_MOTOR);
      return 'recibo-de-prueba';
    }
  };
  registrarGalloIA({ post(path, f) { assert.equal(path, '/alumno/gallo-ia'); atender = f; } }, {
    tokenRequerido: async () => ({ uid: 'u-test' }),
    accesoA: async () => ({ activo: true }),
    memoria,
    log
  });
  const res = new EventEmitter();
  const piezas = [];
  const headers = {};
  res.setHeader = (k, v) => { headers[k] = v; };
  res.flushHeaders = () => { res.headersSent = true; };
  res.write = v => { piezas.push(v); };
  res.end = () => { res.writableEnded = true; };
  await atender({ body: { cursoSlug, mensaje: 'dónde veo mi certificado' }, get: () => 'text/event-stream' }, res);
  assert.match(headers['Content-Type'], /^text\/event-stream/);
  const evento = pieza => {
    const [, tipo, raw] = pieza.match(/^event: (\w+)\ndata: (.*)\n\n$/) || [];
    return tipo ? { tipo, data: JSON.parse(raw) } : null;
  };
  const eventos = piezas.map(evento).filter(Boolean);
  const final = eventos.at(-1);
  assert.equal(final.tipo, 'final');
  assert.equal(eventos.filter(e => e.tipo === 'delta').map(e => e.data.texto).join(''), final.data.respuesta);
  assert.equal(final.data.modo, 'guia');
  assert.equal(final.data.turnoId, 'recibo-de-prueba');
  assert.equal(final.data.version, VERSION_MOTOR);
  assert.deepEqual(final.data.fuentes, []);
  assert.equal(res.writableEnded, true);
});

test('mencionar otro curso no permite recuperar sus fuentes sin acceso vigente', async () => {
  let atender;
  let bonusVigente = false;
  let ambito;
  registrarGalloIA({ post(path, handler) { atender = handler; } }, {
    tokenRequerido: async (req) => ({ uid: req.uid }),
    accesoA: async (alumno, slug) => slug === cursoSlug ? {} : { revocado: !bonusVigente },
    motor: async ({ cursoSlug: alcance }) => { ambito = alcance; return null; },
    log
  });
  async function consultar(uid) {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.json = () => {};
    await atender({ uid, body: { cursoSlug, mensaje: 'que indicadores productivos se usan en sexaje avícola',
      usarModelo: true }, get: () => '' }, res);
    return ambito;
  }
  assert.equal(await consultar('alumno-1'), cursoSlug);
  bonusVigente = true;
  assert.equal(await consultar('alumno-2'), 'sexaje-avicola');
});

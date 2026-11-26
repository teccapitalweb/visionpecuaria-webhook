'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

const SHA256_HEX = /^[a-f0-9]{64}$/;

function huellaDeEntrada(clave) {
  return createHash('sha256').update(clave).digest();
}

function nuevaClaveEntrada() {
  const claveEntrada = randomBytes(32).toString('hex');
  return { claveEntrada, huellaEntrada: huellaDeEntrada(claveEntrada).toString('hex') };
}

function claveEntradaValida(clave, huella) {
  if (typeof clave !== 'string' || !SHA256_HEX.test(clave) ||
      typeof huella !== 'string' || !SHA256_HEX.test(huella)) return false;
  return timingSafeEqual(huellaDeEntrada(clave), Buffer.from(huella, 'hex'));
}

function uidDePago(sessionId) {
  return 'vp-compra-' + createHash('sha256').update(sessionId).digest('hex');
}

module.exports = { nuevaClaveEntrada, claveEntradaValida, uidDePago };

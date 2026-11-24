const DESCUENTO_CENTAVOS = 10000;
const MINIMO_PAGO_MXN_CENTAVOS = 1000;
const OFERTAS_PROMOCIONALES = Object.freeze([
  Object.freeze({ origenSlug: 'gallinas-de-postura', destinoSlug: 'embutidos-artesanales' })
]);

function errorPromocion(status, message, codigo) {
  return Object.assign(new Error(message), { status, codigo });
}

function precioVigenteCentavos(curso) {
  const precio = curso.precioLanzamientoCentavos ?? curso.precioNormalCentavos;
  return precio || Math.round(curso.precioLanzamiento * 100) || Math.round(curso.precioNormal * 100) || 0;
}

function accesoVigente(acceso) {
  return acceso && acceso.revocado !== true && (acceso.activo === true || acceso.estado === 'activo');
}

async function verificarCompradorPromocion(db, usuario, origenSlug, destinoSlug) {
  if (!OFERTAS_PROMOCIONALES.some(oferta => oferta.origenSlug === origenSlug && oferta.destinoSlug === destinoSlug)) {
    throw errorPromocion(404, 'Esta promoción no está disponible.');
  }
  const uid = usuario?.uid;
  const email = String(usuario?.email || '').toLowerCase().trim();
  if (!uid || !email || usuario.email_verified !== true) {
    throw errorPromocion(403, 'Entra con el correo verificado con el que compraste el curso.');
  }

  const accesos = db.collection('accesosCurso').doc(uid).collection('cursos');
  const [origenSnapshot, comprasSnapshot] = await Promise.all([
    accesos.doc(origenSlug).get(),
    db.collection('comprasCurso').where('email', '==', email).get()
  ]);
  const accesoOrigen = origenSnapshot.data();
  const compras = comprasSnapshot.docs.map(doc => doc.data());
  const paga = compras.find(compra => compra.slug === origenSlug && compra.estado === 'confirmado'
    && Number(compra.montoPagadoCentavos) > 0);
  if (!paga || accesoOrigen?.revocado === true) {
    throw errorPromocion(403, 'El descuento se aplica a quienes ya compraron el curso de origen.');
  }
  return { uid, email, nombre: String(usuario.name || paga.nombre || '').trim().slice(0, 160), compras };
}

async function obtenerOfertaPromocional(db, usuario, origenSlug, destinoSlug) {
  const { uid, compras } = await verificarCompradorPromocion(db, usuario, origenSlug, destinoSlug);
  const cursos = db.collection('cursosVenta');
  const [origenSnapshot, destinoSnapshot, accesoSnapshot] = await Promise.all([
    cursos.doc(origenSlug).get(),
    cursos.doc(destinoSlug).get(),
    db.collection('accesosCurso').doc(uid).collection('cursos').doc(destinoSlug).get()
  ]);
  const origen = origenSnapshot.data();
  const destino = destinoSnapshot.data();
  if (!origen || !destino || destino.activo === false || destino.ventaDirecta === false) {
    throw errorPromocion(404, 'Esta promoción no está disponible.');
  }
  const accesoDestino = accesoSnapshot.data();
  const yaAdquirido = accesoVigente(accesoDestino) || (accesoDestino?.revocado !== true
    && compras.some(compra => compra.slug === destinoSlug && compra.estado === 'confirmado'));
  if (yaAdquirido) {
    throw Object.assign(errorPromocion(409, 'Ya tienes acceso a este curso.', 'curso_adquirido'), { yaComprado: true });
  }

  const precioBaseCentavos = Number(precioVigenteCentavos(destino));
  const moneda = String(destino.moneda || 'mxn').toLowerCase();
  if (moneda !== 'mxn' || !Number.isSafeInteger(precioBaseCentavos) || precioBaseCentavos - DESCUENTO_CENTAVOS < MINIMO_PAGO_MXN_CENTAVOS) {
    throw errorPromocion(409, 'No podemos aplicar el descuento al precio actual.', 'precio_no_elegible');
  }
  return {
    origenSlug,
    destinoSlug,
    origenNombre: origen.nombre || origen.titulo || 'Gallinas de Postura',
    destinoNombre: destino.nombre || destino.titulo || 'Embutidos artesanales y chorizos',
    moneda,
    precioBaseCentavos,
    descuentoCentavos: DESCUENTO_CENTAVOS,
    montoCentavos: precioBaseCentavos - DESCUENTO_CENTAVOS
  };
}

module.exports = { OFERTAS_PROMOCIONALES, precioVigenteCentavos, verificarCompradorPromocion, obtenerOfertaPromocional };

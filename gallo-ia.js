const { orientacionBase } = require('./gallo-orientacion');

const CURSOS = {
  'gallinas-de-postura': {
    nombre: 'Manejo Profesional de Gallinas de Postura',
    menciones: /\b(gallinas?|ponedoras?|postura|parvada)\b/,
    unidades: [
      ['Fundamentos y arranque de la parvada', /instalacion|parvada|arranque|ventilacion|iluminacion|raza|aclimat|alojamiento|gallinero|jaula/, 'Aprendes a preparar la recepción de las pollitas, elegir el sistema de alojamiento y revisar la ventilación y la iluminación.'],
      ['Nutrición y alimentación', /nutricion|alimen|racion|calcio|proteina|fosforo|conversion/, 'El curso distingue inicio, crecimiento, prepostura y producción. Explica cómo cambian los requerimientos por etapa y cómo revisar la energía, la proteína, el calcio y el fósforo.'],
      ['Sanidad y bioseguridad', /sanidad|bioseguridad|vacun|enfermedad|desinfec|higiene de la granja/, 'El módulo presenta prevención, control de accesos y buenas prácticas de desinfección. Un programa vacunal para una parvada concreta debe revisarlo un médico veterinario local.'],
      ['Producción y calidad del huevo', /huevo|cascaron|recoleccion|clasifica|registros|produccion/, 'El módulo cubre recolección, clasificación por peso y calidad, conservación y registros por lote. Registrar producción y calidad ayuda a detectar cambios en la parvada.'],
      ['Costos y comercialización', /costeo|costos?|costar|rentabili|comerciali|punto de equilibrio|corrida|venta|inversion/, 'La corrida financiera ayuda a distinguir ingresos, costos y punto de equilibrio. Para estimar el costo por huevo, toma el costo total del periodo y divídelo entre los huevos vendibles de ese mismo periodo.']
    ]
  },
  'embutidos-artesanales': {
    nombre: 'Embutidos Artesanales y Chorizos',
    menciones: /\b(embutidos?|chorizos?|longanizas?|carne enchilada|toluca)\b/,
    unidades: [
      ['Fundamentos y seguridad alimentaria', /inocuidad|higiene|seguridad alimentaria|cadena de frio|temperatura|equipo|utensilio|conserva/, 'El módulo se enfoca en selección de cárnicos, higiene, equipo y cadena de frío. Consulta los procedimientos demostrados en clase para preparar y conservar el producto.'],
      ['Chorizo rojo mexicano tradicional', /chorizo rojo|chiles? secos?|guajillo|pasilla|chorizo mexicano/, 'En esta clase se revisan los chiles secos, la molienda, las especias y el embutido del chorizo rojo. Busca las proporciones enseñadas en el material del curso.'],
      ['Chorizo verde estilo Toluca', /chorizo verde|toluca|hierbas frescas/, 'La clase muestra el trabajo con hierbas frescas, técnicas de mezclado y presentación del chorizo verde.'],
      ['Longaniza artesanal', /longaniza|tripa|oreo/, 'Aprendes las diferencias entre corte a cuchillo y molienda, así como el uso de tripas y las etapas de oreo y conservación.'],
      ['Carne enchilada', /carne enchilada|marinad|empacado al vacio/, 'La clase aborda los cortes, el marinado, la refrigeración y el empaque de la carne enchilada.'],
      ['Costeo y comercialización', /costeo|costos?|precio por kilo|calculadora|rentabili|comerciali|venta/, 'El temario incluye costo por kilo, precio de venta y canales para comercializar. Usa el total de tus materias primas, empaque y demás costos y divídelo entre los kilos vendibles del lote.']
    ]
  },
  'sexaje-avicola': {
    nombre: 'Sexaje Avícola',
    menciones: /\b(sexaje|sexar|sexo de las aves|macho o hembra)\b/,
    unidades: [
      ['Fundamentos del sexaje en aves', /fundamentos|para que sirve|que es el sexaje|macho o hembra|importancia/, 'El sexaje consiste en identificar el sexo de las aves. El curso presenta su función en el manejo y la organización de una parvada.'],
      ['Métodos tradicionales', /metodo|tradicional|pluma|color|diferencia/, 'La clase compara métodos tradicionales y ayuda a distinguir en qué casos es apropiado cada uno. La técnica depende de las características y la edad de las aves.'],
      ['Práctica guiada de sexaje manual', /manual|practic|cloaca|manipula/, 'La clase práctica se centra en el sexaje manual guiado. Conviene ver la demostración y realizar cualquier práctica con supervisión, cuidando el bienestar del ave.'],
      ['Aplicaciones y bienestar animal', /bienestar|estres|aplicacion|cuidado|manejo/, 'El módulo relaciona las aplicaciones del sexaje con el bienestar animal y el manejo cuidadoso de las aves.']
    ]
  }
};

const LIMITE_MENSAJE = 1000;
const MAX_HISTORIAL = 8;
const MAX_CUENTAS = 3000;
const VENTANA_MS = 60 * 1000;
const MAX_POR_VENTANA = 12;

function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cursoMencionado(texto) {
  // Si la pregunta menciona su curso de origen y el regalo, dar prioridad al curso específico del regalo.
  return ['sexaje-avicola', 'embutidos-artesanales', 'gallinas-de-postura'].find(slug => CURSOS[slug].menciones.test(texto));
}

function intencion(texto) {
  if (/\b(antibiotic\w*|medicament\w*|dosific\w*|dosis|diagnostic\w*|sintomas?)\b|mis? (aves|gallinas|pollos?) (esta|estan|tiene|tienen) (enferm\w+|diarrea)|se me (murio|mueren)/.test(texto)) return 'veterinaria';
  if (/\b([cs]ertif\w*|constancia|diploma|reconocimiento|folio|ipcil)\b/.test(texto)) return 'certificado';
  if (/\b(regalo|bono|bonus)\b/.test(texto) || /\bsexaje\b/.test(texto) && /\b(no aparece|gratis|acced\w*|acceso|recibo)\b/.test(texto)) return 'regalo';
  if (/\b(olvide|olvido|perdi|restablec\w*|cambi\w*|recuper\w*)\b.*\b(contrasen\w*|clave)\b|\b(contrasen\w*|clave)\b.*\b(olvide|olvido|perdi|restablec\w*)\b/.test(texto)) return 'contrasena';
  if (/\b(no (?:(?:me|se) )?(?:carga|abre|ve|reprodu[cs]\w*)|no puedo (?:ver|abrir)|se (?:traba|detiene|queda)|pantalla (?:negra|en blanco)|error)\b/.test(texto) && /\b(video\w*|bideo\w*|clase\w*|grabacion\w*|reproductor)\b/.test(texto)) return 'video';
  if (/\b(pague|pago|pagos|cobr\w*|stripe|oxxo|tarjeta|factura\w*|reembolso|devolucion|comprobante|doble cargo)\b/.test(texto)) return 'pago';
  if (/cuanto (cuesta|sale|vale)|cual es (el )?precio|\b(descuent\w*|promosion|promocion|precio del curso|inscrib\w*|comprar)\b|^precio$/.test(texto)) return 'precio';
  if (/\b(material\w*|descarg\w*|pre[cs]enta[cs]ion\w*|pptx?|pdf|excel|archiv\w*|recetario|manual|diapo\w*)\b/.test(texto) && !/sexaje manual|metodo manual/.test(texto)) return 'materiales';
  if (/\b(no (puedo|me deja|logro) entrar|no me aparece|iniciar sesion|acced\w*|acceso|correo|cuenta|ingres\w*|login)\b/.test(texto)) return 'acceso';
  if (/\b(avance|progreso|retomar|continuar|marcar (como )?vista)\b/.test(texto)) return 'progreso';
  if (/\b(ayuda humana|soporte|whats\s?app|wats\s?ap|contact\w*|hablar con (una persona|alguien))\b/.test(texto)) return 'soporte';
  if (/\b(temario|de que trata|que incluye|que (voy a )?aprend\w*|que ensen\w*|cuantos? (?:temas?|modulos?)|cuantas? (?:clases?|sesiones?)|quien (imparte|da)|ponent\w*|instructor\w*)\b/.test(texto)) return 'temario';
  if (/\b(donde (estan|veo|puedo ver|encuentro)|como (veo|empiezo|inicio)|ver (las?|mis)|abrir (las?|mis))\b.*\b(clases?|videos?|grabaciones?)\b/.test(texto)) return 'clases';
  return null;
}

function unidadMencionada(texto, curso) {
  const numero = texto.match(/\b(?:tema|unidad)\s+(?:numero\s+)?([1-9])\b/);
  if (numero) {
    const indice = Number(numero[1]) - 1;
    if (curso.unidades[indice]) return { indice, texto: curso.unidades[indice][2] };
  }
  const indice = curso.unidades.findIndex(([, palabras]) => palabras.test(texto));
  return indice === -1 ? null : { indice, texto: curso.unidades[indice][2] };
}

function historialUsuario(historial) {
  return (Array.isArray(historial) ? historial.slice(-MAX_HISTORIAL) : [])
    .filter(item => item?.rol === 'usuario' && typeof item.texto === 'string')
    .map(item => normalizar(item.texto.slice(0, LIMITE_MENSAJE)))
    .reverse();
}

function cursoDePregunta(actual, texto, anteriores) {
  const regalo = /\b(curso (de|del) regalo|mi (regalo|bono|bonus)|del (regalo|bono|bonus))\b/.test(texto);
  return cursoMencionado(texto) || (regalo ? 'sexaje-avicola' : null) || anteriores.map(cursoMencionado).find(Boolean) || actual;
}

function buscarClases(texto) {
  const numeros = { uno: 1, primer: 1, primera: 1, primero: 1, dos: 2, segunda: 2, segundo: 2, tres: 3, tercera: 3, tercero: 3, cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5, seis: 6, sexta: 6, sexto: 6 };
  const extraer = /\b(?:clase|sesion|modulo|video|grabacion) (?:numero )?(\d{1,2}|uno|dos|tres|cuatro|cinco|seis)\b|\b(primer[ao]?|segund[ao]|tercer[ao]|cuart[ao]|quint[ao]|sext[ao]) (?:clase|sesion|modulo|video|grabacion)\b/;
  const match = texto.match(extraer);
  if (match) return { tipo: 'numero', numero: numeros[match[1] || match[2]] ?? Number(match[1]) };
  if (/\bcuant[oa]s (?:clases|sesiones|modulos|videos|grabaciones)\b/.test(texto)) return { tipo: 'cantidad' };
  if (/\b(en que|en cual|cual es (?:la|el)|que|como se llama (?:la|el)) (clase|sesion|modulo|video|grabacion)\b/.test(texto)) return { tipo: 'buscar' };
  if (/\bque (clases|sesiones|modulos|videos|grabaciones)\b|\b(cuales (son|hay)|dime|listado|lista|titulos?|nombres?|muestrame)\b.*\b(clases|sesiones|modulos|videos|grabaciones)\b/.test(texto)) return { tipo: 'lista' };
  return null;
}

function fichaDeClases(curso, ficha, consulta, texto, anteriores) {
  if (!ficha) {
    const temas = curso.unidades.map(([nombre]) => nombre.toLowerCase()).join(', ');
    return `El temario público de ${curso.nombre} incluye ${temas}. Para consultar la lista exacta y las grabaciones publicadas, abre ese curso desde Mis cursos con una cuenta que tenga acceso.`;
  }

  const clases = ficha.clases;
  if (!clases.length) return `El aula de ${curso.nombre} todavía no muestra clases registradas.`;
  const publicadas = clases.filter(clase => clase.estado === 'publicada').length;
  const pendientes = clases.length - publicadas;
  const cantidad = `El aula de ${curso.nombre} muestra ${clases.length} ${clases.length === 1 ? 'clase' : 'clases'}. ${publicadas} ${publicadas === 1 ? 'grabación publicada' : 'grabaciones publicadas'}${pendientes ? ` y ${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}` : ''}.`;
  if (consulta.tipo === 'cantidad') return cantidad;

  const nombreClase = (clase, i) => `Clase ${i + 1} · ${clase.titulo}${clase.estado === 'pendiente' ? ' (grabación pendiente)' : ''}`;
  const abrir = 'En el aula, abre Clases para verla cuando esté publicada.';
  if (consulta.tipo === 'numero') {
    const indice = consulta.numero - 1;
    const clase = clases[indice];
    return clase ? `${nombreClase(clase, indice)}. ${clase.estado === 'pendiente' ? 'Consulta su estado en Clases.' : abrir}` : `${cantidad} Abre Clases para revisar el listado.`;
  }

  if (consulta.tipo === 'buscar') {
    const omitir = new Set(['clase', 'clases', 'sesion', 'modulo', 'video', 'grabacion', 'curso', 'para', 'cual', 'cuales', 'llama', 'donde', 'tiene', 'sobre', 'quiero', 'encuentro', 'como']);
    const palabras = texto => new Set(normalizar(texto).split(' ').filter(p => p.length >= 4 && !omitir.has(p)));
    const candidatos = [texto, ...anteriores.slice(0, 1)].flatMap(p => [...palabras(p)]);
    const resultados = clases.map((clase, indice) => ({ clase, indice, puntos: [...palabras(clase.titulo)].filter(p => candidatos.includes(p)).length }));
    resultados.sort((a, b) => b.puntos - a.puntos);
    const mejor = resultados[0];
    if (mejor.puntos && mejor.puntos > (resultados[1]?.puntos || 0)) return `Encontré esta coincidencia en el aula: ${nombreClase(mejor.clase, mejor.indice)}. ${abrir}`;
  }

  const lista = clases.map(nombreClase).join('\n');
  return `${cantidad}\n${lista}`;
}

const AYUDA = {
  veterinaria: 'Si alguna ave presenta síntomas, consulta a un médico veterinario que pueda revisar a la parvada. Puedo señalarte el módulo de Sanidad y Bioseguridad de Gallinas para repasar prevención. ¿Buscas esa clase?',
  certificado: 'Abre Mi certificado en el menú del curso. En el teléfono, toca Cuenta y después Ir a mi certificado o Ver certificado. Ahí puedes solicitarlo, consultar su estado y abrirlo cuando esté listo. Para corregir datos de una solicitud enviada, contacta a Soporte de Visión Pecuaria.',
  regalo: 'Revisa Mis cursos en el Aula. Cuando el acceso al regalo de Sexaje Avícola queda activado, aparece como un curso independiente con sus clases y materiales. Si usaste otro correo o el regalo no aparece después de confirmarse el pago, usa Soporte WhatsApp desde el panel.',
  contrasena: 'En la pantalla de acceso, elige Olvidé mi contraseña e indica el mismo correo con el que hiciste la compra. Revisa también spam. Si entraste con Google, vuelve a usar Continuar con Google con esa misma cuenta.',
  video: 'Vuelve a abrir la clase desde Clases y recarga la página. Si la grabación aparece pendiente, todavía no está publicada. Si un video publicado sigue sin abrir, prueba con otra conexión o envía a soporte el nombre de la clase y una captura del error.',
  pago: 'Si ya pagaste, entra al aula con el mismo correo que usaste en Stripe. Si el pago sigue pendiente, espera la confirmación del medio de pago. Para revisar un cobro, factura o devolución, usa Soporte WhatsApp desde el panel. Comparte tu comprobante solo por el canal oficial y evita enviar datos de tu tarjeta.',
  precio: 'El precio vigente y el total se confirman antes de pagar. Si compraste Gallinas de Postura, revisa la recomendación de Embutidos debajo de Clases. Al entrar desde ahí con el mismo correo, el sistema comprueba si tienes el descuento y te muestra el total.',
  materiales: 'Entra a Materiales dentro de tu curso y abre la tarjeta del archivo. Puedes leerlo dentro del visor y usar Descargar para guardarlo. Si ves un error, intenta abrirlo otra vez desde Materiales y avisa a soporte si persiste.',
  acceso: 'Entra desde la página del curso con Ya compré o abre el Aula. Usa el mismo correo con el que pagaste y verifica que sea la cuenta correcta. Si la compra está confirmada y no aparece, contacta a Soporte desde el panel.',
  progreso: 'Abre Clases y elige una grabación. Puedes retomar tu curso desde Inicio y marcar como vista una clase que ya terminaste. El avance se guarda por separado en cada curso.',
  soporte: 'Abre Cuenta o el menú del curso y toca Soporte WhatsApp. Describe qué intentabas hacer y adjunta una captura si hubo un error. Comparte datos de pago o comprobantes solo con el equipo por su canal oficial.',
  clases: 'Abre Clases desde la barra del curso y toca la portada de la grabación. Si todavía está marcada como pendiente, revisa más tarde desde el mismo lugar. Desde Inicio puedes retomar la última clase.'
};

function armarRespuesta(cursoActual, mensaje, historial, ficha) {
  const texto = normalizar(mensaje);
  const anteriores = historialUsuario(historial);
  const slug = cursoDePregunta(cursoActual, texto, anteriores);
  const curso = CURSOS[slug];
  const orientacion = orientacionBase(texto, slug, anteriores);
  if (orientacion) return orientacion;
  let tema = intencion(texto);
  let unidad = unidadMencionada(texto, curso);
  const seguimiento = /^(y |entonces |tambien |donde\b|como\b|cuanto\b|en que\b|que hago\b)/.test(texto) && texto.split(' ').length <= 12;

  if (seguimiento && tema === 'materiales' && /\blo (descarg\w*|bajo|guard\w*)\b/.test(texto)
      && intencion(anteriores[0] || '') === 'certificado') tema = 'certificado';

  if (!tema && !unidad && seguimiento) {
    for (const anterior of anteriores) {
      tema = intencion(anterior);
      unidad = unidadMencionada(anterior, curso);
      if (tema || unidad) break;
    }
  }

  const consulta = (!tema || ['temario', 'clases', 'regalo'].includes(tema)) ? buscarClases(texto) : null;
  if (consulta) return { texto: fichaDeClases(curso, ficha, consulta, texto, anteriores), reformular: false };

  if (tema === 'temario') {
    if (/quien|ponente|instructor/.test(texto)) {
      const nombre = typeof ficha?.instructor === 'string' ? ficha.instructor.trim().slice(0, 140) : '';
      return { texto: nombre ? `${nombre} imparte ${curso.nombre}. Puedes revisar su perfil en la sección Ponente de la página del curso.` : `Consulta la sección Ponente de ${curso.nombre} para ver los datos actualizados del instructor.`, reformular: false };
    }
    if (!unidad) {
      const lista = curso.unidades.map(([nombre]) => `• ${nombre}`).join('\n');
      return { texto: `${curso.nombre} cubre estos temas:\n${lista}\n¿Cuál quieres repasar?`, reformular: false };
    }
  }

  if (tema === 'materiales' && slug === 'sexaje-avicola') {
    return { texto: 'Sexaje Avícola incluye cuatro presentaciones y un manual en PDF. Abre el curso en el Aula, entra a Materiales y toca la portada del archivo. También puedes descargarlo desde el visor.', reformular: false };
  }
  if (tema && AYUDA[tema]) return { texto: AYUDA[tema], reformular: false };

  if (unidad) {
    const nombre = curso.unidades[unidad.indice][0];
    return { texto: `El temario de ${curso.nombre} incluye ${nombre}. ${unidad.texto}\n¿Quieres consultar las clases del aula o revisar otro tema?`, reformular: true };
  }

  if (/^(hola|buenos dias|buenas tardes|buenas noches|buenas|que tal|hey)( (mi )?gallo( ia)?)?$/.test(texto)) {
    return { texto: '¡Hola! Soy tu Gallo IA. Puedo ayudarte a repasar ' + curso.nombre + ', ubicar tus clases y materiales o resolver dudas sobre el aula. ¿Qué te gustaría revisar?', reformular: false };
  }
  if (/^(muchas )?gracias( .*)?$/.test(texto)) {
    return { texto: '¡De nada! Si quieres, seguimos con otra clase o con una duda sobre el aula.', reformular: false };
  }
  if (cursoMencionado(texto)) {
    return { texto: `Puedo orientarte sobre ${curso.nombre}. ¿Buscas su temario, una clase específica o ayuda para entrar a sus materiales?`, reformular: false };
  }
  return { texto: 'Cuéntame un poco más para poder ubicar tu duda. Puedo ayudarte a encontrar una clase, ver o descargar un material, pedir tu certificado o resolver dudas de acceso y pago. ¿Qué estabas intentando hacer?', reformular: false };
}

async function reformularConGemini(texto) {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelo = process.env.GALLO_GEMINI_MODEL || '';
  if (!apiKey || !/^gemini-[a-z0-9.-]+$/.test(modelo)) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(4500),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Eres Mi Gallo IA en el aula de Visión Pecuaria. Redacta en español mexicano, en texto plano y con claridad. Reformula únicamente la información que se te da. Conserva el curso y los hechos. No agregues instrucciones médicas o alimentarias, precios, fechas, datos personales ni enlaces.' }] },
        // Sólo se comparten fichas aprobadas, sin mensaje del alumno, historial ni identidad.
        contents: [{ parts: [{ text: texto }] }],
        generationConfig: { maxOutputTokens: 220, temperature: 0.15 }
      })
    });
    if (!r.ok) return null;
    const datos = await r.json();
    const candidato = datos.candidates?.[0];
    if (candidato?.finishReason !== 'STOP') return null;
    const salida = candidato.content?.parts?.filter(parte => !parte.thought).map(parte => parte.text || '').join('').trim();
    if (!salida || salida.length > 1000 || /https?:|www\.|\bmxn\b|[$@]|\b(dosis|antibiotico|diagnostic)\w*/i.test(salida)) return null;
    const originales = new Set(texto.match(/\d+/g) || []);
    return (salida.match(/\d+/g) || []).every(numero => originales.has(numero)) ? salida : null;
  } catch {
    return null;
  }
}

function limitadorMensajes() {
  const cuentas = new Map();
  return uid => {
    const ahora = Date.now();
    const registro = cuentas.get(uid);
    if (registro && ahora < registro.vence) {
      if (registro.mensajes >= MAX_POR_VENTANA) return Math.ceil((registro.vence - ahora) / 1000);
      registro.mensajes++;
      return 0;
    }
    if (cuentas.size >= MAX_CUENTAS) {
      for (const [id, cuenta] of cuentas) if (ahora >= cuenta.vence) cuentas.delete(id);
      if (cuentas.size >= MAX_CUENTAS) return VENTANA_MS / 1000;
    }
    cuentas.set(uid, { mensajes: 1, vence: ahora + VENTANA_MS });
    return 0;
  };
}

function registrarGalloIA(app, { tokenRequerido, accesoA, leerCurso, normalizarClases, log = console }) {
  const esperar = limitadorMensajes();
  app.post('/alumno/gallo-ia', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const usuario = await tokenRequerido(req, res);
      if (!usuario) return;
      const { cursoSlug, mensaje, historial } = req.body || {};
      if (typeof cursoSlug !== 'string' || !Object.hasOwn(CURSOS, cursoSlug)) {
        return res.status(400).json({ error: 'Elige un curso de Visión Pecuaria.' });
      }
      if (typeof mensaje !== 'string' || !mensaje.trim() || mensaje.length > LIMITE_MENSAJE) {
        return res.status(400).json({ error: `Escribe una pregunta de hasta ${LIMITE_MENSAJE} caracteres.` });
      }
      const segundos = esperar(usuario.uid);
      if (segundos) {
        res.setHeader('Retry-After', String(segundos));
        return res.status(429).json({ error: 'Espera un momento antes de enviar otra pregunta.' });
      }
      const acceso = await accesoA(usuario, cursoSlug);
      if (!acceso || acceso.revocado === true) return res.status(403).json({ error: 'Sin acceso a este curso' });

      const texto = normalizar(mensaje);
      const destino = cursoDePregunta(cursoSlug, texto, historialUsuario(historial));
      const pideDatosAula = buscarClases(texto) || intencion(texto) === 'temario' && /quien|ponent|instructor/.test(texto);
      let ficha = null;
      if (pideDatosAula) {
        const permiso = destino === cursoSlug ? acceso : await accesoA(usuario, destino);
        if (permiso && permiso.revocado !== true) {
          const datos = await leerCurso(destino);
          if (datos) {
            const clases = normalizarClases(datos.clases).map(({ titulo, estado }) => ({ titulo: String(titulo).slice(0, 160), estado }));
            ficha = { clases, instructor: datos.instructorNombre };
          }
        }
      }
      const guia = armarRespuesta(cursoSlug, mensaje, historial, ficha);
      const ia = guia.reformular ? await reformularConGemini(guia.texto) : null;
      return res.json({ respuesta: ia || guia.texto, modo: ia ? 'ia' : 'guia', ...(guia.fuentes ? { fuentes: guia.fuentes } : {}) });
    } catch (e) {
      log.error('Mi Gallo IA: no se pudo preparar una respuesta.', e.code || e.name);
      return res.status(500).json({ error: 'No pudimos responder en este momento. Inténtalo de nuevo.' });
    }
  });
}

module.exports = { registrarGalloIA, armarRespuesta, limitadorMensajes };

module.exports = [
  {
    id: 'arranque',
    claves: ['arranque', 'recibir pollitos', 'recibir pollitas', 'recien nacidos', 'de un dia', 'primera semana', 'criadora', 'criar pollitos', 'llegan los pollitos', 'tengo pollitos', 'compre pollitos', 'primer dia', 'pollitos bebes'],
    pistas: ['pollitos', 'pollitas', 'crianza', 'llegan', 'preparo'],
    fuentes: ['pollitos'],
    texto: [
      'Antes de que lleguen los pollitos, prepara un espacio protegido, seco y con ventilación sin corrientes directas. Enciende la criadora con anticipación y deja un área más fresca para que puedan apartarse del calor.',
      'Al recibirlos, pon a su alcance agua limpia en bebederos para pollitos y alimento completo de inicio. Comprueba que encuentren ambos y que se distribuyan por el espacio. Revisa bebederos, cama y temperatura varias veces el primer día.',
      'Ten listo un respaldo si falla el calor. ¿Qué edad tienen y qué tipo de criadora estás usando?'
    ]
  },
  {
    id: 'temperatura-pollitos',
    claves: ['temperatura de la criadora', 'temperatura para pollitos', 'temperatura de pollitos', 'temperatura pollitos', 'grados para pollitos', 'calor para pollitos', 'a cuanto pongo la criadora', 'foco para pollitos', 'lampara para pollitos', 'pollitos amontonados', 'pollitos se amontonan', 'se juntan bajo el foco', 'se alejan de la lampara'],
    pistas: ['temperatura', 'grados', 'pollitos', 'pollitas', 'criadora', 'termometro', 'foco', 'lampara', 'amontonados'],
    fuentes: ['pollitos', 'bienestar'],
    texto: [
      'Como punto de partida para una criadora con una zona cálida y otra más fresca, University of Minnesota Extension propone unos 32–35 °C durante la primera semana, medidos a la altura de los pollitos cerca del borde de la zona caliente. La referencia baja unos 3 °C por semana mientras aún necesiten calefacción. Comprueba las indicaciones de tu criadora y observa cómo responde el grupo.',
      'Si se aprietan bajo el calor, comprueba si tienen frío. Si evitan la zona caliente, reduce el calor. Si se juntan de un solo lado, busca una corriente de aire. Vuelve a medir después de ajustar.',
      '¿Cuántos días tienen y dónde estás midiendo la temperatura?'
    ]
  },
  {
    id: 'cama',
    claves: ['cama', 'camas para gallinas', 'material de cama', 'materiales para cama', 'viruta', 'aserrin', 'cascarilla', 'cama humeda', 'olor a amoniaco', 'cama apelmazada', 'piso del gallinero'],
    pistas: ['humeda', 'humedo', 'apelmazada', 'mojada', 'gallinero', 'polvo', 'paja'],
    fuentes: ['bienestar', 'pollitos'],
    texto: [
      'Para la cama busca un material absorbente, suelto, limpio, seco y con poco polvo. Puedes evaluar viruta sin tratar o paja seca según lo que consigas. Evita materiales húmedos, mohosos o con residuos de barniz y tratamientos.',
      'Revisa debajo de los bebederos y en las esquinas. Retira los parches mojados o apelmazados, corrige fugas o entradas de lluvia y repón material seco. Mantén el intercambio de aire. Si reaparece la humedad, distingue entre derrames, filtraciones y condensación antes de añadir otra capa.'
    ],
    seguimientos: [{
      patron: /\b(cada cuanto|cuando (?:la )?cambio|cuanto dura|con que frecuencia)\b/,
      texto: 'Revisa la cama a diario y retira las zonas mojadas cuando aparezcan. Cambia más superficie si se humedece o apelmaza, aumenta el polvo o persiste un olor fuerte. El tiempo entre recambios depende de la ventilación, la densidad y el tipo de bebedero.'
    }]
  },
  {
    id: 'agua',
    claves: ['agua', 'bebedero', 'bebederos', 'consumo de agua', 'acceso a agua', 'acceso al agua', 'agua por gallina', 'cuanta agua', 'cuanto toman', 'litros de agua', 'flujo de bebedero', 'toman agua'],
    pistas: ['litros', 'flujo', 'beber', 'nipples', 'fuga'],
    fuentes: ['bienestar', 'gallinas'],
    texto: [
      'Deja agua limpia y fresca disponible continuamente. Pon bebederos donde todas las aves puedan llegar sin amontonarse. En pollitos, usa un bebedero de poca profundidad diseñado para su tamaño. Revisa a diario que haya agua, que cada punto funcione y que el piso cercano siga seco.',
      'Para conocer el consumo de tu lote, mide lo que realmente usa en 24 horas y divídelo entre las aves presentes. Descuenta fugas y derrames cuando puedas identificarlos. Compara varios días y pon atención a cambios de calor o fallas de suministro.'
    ],
    seguimientos: [{
      patron: /\b(cuant[oa]s?|litros|por dia|al dia)\b/,
      texto: 'Para estimar cuánto necesita tu lote, registra el agua usada durante 24 horas. Si usó 6 litros y hay 30 aves, el promedio fue de 0.2 litros por ave ese día. Es un ejemplo de cálculo. Mide tu lote en días normales y de calor y mantén el agua disponible todo el tiempo.'
    }]
  },
  {
    id: 'alimentacion',
    claves: ['alimento', 'alimentacion', 'alimentar', 'nutricion', 'alimento de inicio', 'alimento de crecimiento', 'alimento de postura', 'alimento balanceado', 'que les doy de comer', 'que comen', 'cuanto comen', 'cuanto alimento', 'cambiar de alimento', 'comida para pollitos', 'con que alimento'],
    pistas: ['pienso', 'concentrado', 'racion', 'croquetas', 'consumo', 'maiz', 'proteina', 'grano', 'etapa'],
    fuentes: ['pollitos', 'bienestar'],
    texto: [
      'Para aves destinadas a postura, elige alimento completo de inicio para pollitos, de crecimiento o desarrollo para pollitas y de postura cuando empiecen a poner. Sigue la etiqueta y la guía de la línea para decidir el cambio. La edad por sí sola no describe el desarrollo de todas las pollitas.',
      'Si cambias de alimento, hazlo de forma gradual y vigila el consumo. Guarda los sacos secos, cierra los recipientes y comprueba que cada ave pueda comer. Ofréceles granos o sobras solo como complemento para conservar el equilibrio del alimento completo.',
      'Si me dices la edad de las aves y el nombre de la etapa que viene en el saco, te ayudo a ubicar el paso siguiente.'
    ],
    seguimientos: [{
      patron: /\b(cuant[oa]s?|gramos|por dia|al dia|racion)\b/,
      texto: 'Para medir tu consumo, pesa el alimento ofrecido y resta el sobrante que puedas recuperar. Divide entre las aves presentes y separa los derrames que puedas medir. Regístralo durante varios días y compáralo con la guía de la línea y la etapa. El consumo suele variar con la edad y el clima.'
    }]
  },
  {
    id: 'cascaron',
    claves: ['cascaron', 'cascara del huevo', 'cascara fina', 'cascara delgada', 'cascara blanda', 'huevo sin cascara', 'huevos sin cascara', 'huevos blandos', 'cascaron fragil', 'huevos debiles', 'calcio', 'calidad del huevo', 'huevo de baja calidad'],
    pistas: ['cascara', 'fragil', 'blanda', 'delgado', 'quebradiza', 'rotos'],
    fuentes: ['calcio', 'calidadHuevo'],
    texto: [
      'Si aparece cascarón delgado o blando, confirma que las ponedoras comen un alimento completo de su etapa y pueden llegar al comedero y al agua. Registra cuántos huevos salen así, desde cuándo y si coincide con calor o un cambio de alimento. Separa los que ya están dañados al recogerlos de los que se rompen por golpes después.',
      'El calcio dietario influye en la calidad del cascarón. Los estudios comparan condiciones concretas de alimentación y alojamiento, así que revisa la formulación completa y el consumo antes de añadir calcio por tu cuenta. Si el problema se mantiene o aumenta, consulta a un profesional de nutrición avícola o a un veterinario para revisar el lote.'
    ]
  },
  {
    id: 'luz',
    claves: ['horas de luz', 'cuanta luz', 'horario de luz', 'fotoperiodo', 'luz artificial', 'iluminacion', 'luz y postura', 'luz para poner', 'poner mas huevos', 'bajo la postura', 'baja de postura', 'dejan de poner', 'no ponen huevos', 'bajo la produccion'],
    pistas: ['luz', 'oscuro', 'foco', 'postura', 'temporizador', 'apagado', 'produccion'],
    fuentes: ['gallinas', 'bienestar'],
    texto: [
      'Para revisar la luz, anota las horas totales de luz natural y artificial, y verifica cuándo enciende y apaga el temporizador. Mantén un horario estable y un periodo de oscuridad para el descanso. Usa la guía de la línea y la edad de las aves para ajustar el programa.',
      'University of Minnesota Extension usa 12–14 horas de luz al día como referencia para sostener la postura en lotes domésticos adultos. Si disminuyó la postura, compara también el consumo de agua y alimento, el calor reciente, la edad y la muda. Un cambio de iluminación por sí solo puede pasar por alto la causa.'
    ]
  },
  {
    id: 'calor',
    claves: ['golpe de calor', 'estres por calor', 'calor en el gallinero', 'mucho calor', 'calor en gallinas', 'ventilacion', 'ventilar', 'aire del gallinero', 'sombra', 'calor en ponedoras', 'jadean por el calor', 'gallinero caliente'],
    pistas: ['calor', 'caluroso', 'aire', 'ventilador', 'verano', 'caliente', 'temperatura'],
    fuentes: ['calor', 'bienestar'],
    texto: [
      'Con calor, facilita sombra y recambio de aire, y comprueba que todos los bebederos aporten agua fresca. Revisa el lote en la parte más caliente del día. El jadeo sostenido, las alas separadas del cuerpo y la búsqueda de zonas más frescas pueden aparecer con calor.',
      'Mide la temperatura cerca de las aves y revisa si hay rincones sin aire o con sol directo. Evita mover o manejar el lote en las horas más calientes. Si alguna ave tiene dificultad para respirar, se debilita mucho o no puede levantarse, busca atención veterinaria.'
    ]
  },
  {
    id: 'alojamiento',
    claves: ['gallinero', 'diseno de gallinero', 'espacio para gallinas', 'espacio por gallina', 'gallinas por metro', 'aves por metro', 'cuanto espacio', 'densidad', 'alojamiento', 'pastoreo', 'percha', 'perchas', 'corral', 'jaula'],
    pistas: ['metros', 'piso', 'espacio', 'corral', 'techo', 'patio', 'exterior'],
    fuentes: ['bienestar', 'registros'],
    texto: [
      'Organiza el gallinero con zonas fáciles de ventilar y limpiar, piso seco, refugio frente al clima y los depredadores, y accesos libres a comederos, bebederos, perchas y nidos. Coloca las perchas donde las aves puedan subir y bajar sin golpes y sin ensuciar agua o alimento.',
      'Para calcular la densidad, divide las aves entre los metros cuadrados de superficie útil accesible. La cifra de referencia cambia con la edad, el sistema y la regulación aplicable. Si se amontonan en los recursos o quedan aves desplazadas, revisa la distribución y el espacio además de ese número.'
    ]
  },
  {
    id: 'nidos',
    claves: ['nido', 'nidos', 'nidales', 'recoger huevos', 'recolectar huevos', 'recoleccion de huevos', 'huevos en el piso', 'ponen en el piso', 'huevos fuera del nido', 'huevo sucio', 'huevos sucios'],
    pistas: ['recoleccion', 'recoger', 'piso', 'rotos', 'huevos'],
    fuentes: ['gallinas', 'bienestar'],
    texto: [
      'Deja nidos accesibles, con material seco, en una zona tranquila y protegida. La guía para lotes domésticos de University of Minnesota Extension toma un nido por cada cuatro o cinco gallinas como referencia. Observa si se forman filas o si algunas aves quedan fuera.',
      'Recoge los huevos con regularidad. Si empiezan a aparecer en el piso, anota dónde y a qué hora, recoge los de esos puntos y revisa que los nidos estén disponibles al inicio de la jornada. Si las gallinas evitan un nido, mira primero su entrada, el material y si otras aves lo bloquean.'
    ]
  },
  {
    id: 'enriquecimiento',
    claves: ['enriquecimiento', 'bienestar', 'picoteo', 'se pican', 'se picotean', 'se arrancan plumas', 'picaje', 'bano de polvo', 'banos de polvo', 'rascar', 'escarbar', 'gallinas aburridas'],
    pistas: ['plumas', 'comportamiento', 'perchas', 'forrajeo', 'polvo', 'aburridas'],
    fuentes: ['enriquecimiento', 'bienestar'],
    texto: [
      'Da oportunidades para escarbar, buscar alimento, descansar en perchas y bañarse en sustrato seco. Reparte estas oportunidades en varios puntos y observa si las aprovechan sin empujarse. Revisa también que todas tengan acceso a agua y alimento.',
      'Si ves picoteo repetido entre aves, registra dónde ocurre y revisa si coincide con un comedero disputado, poco espacio o falta de sustrato. Un estudio de aviario evaluó materiales para picotear bajo condiciones específicas. Observa el comportamiento de tu propio grupo antes de ampliar un cambio. Si hay heridas o el problema se extiende, pide revisión profesional.'
    ]
  },
  {
    id: 'registros',
    claves: ['registros', 'bitacora', 'control del lote', 'tasa de postura', 'porcentaje de postura', 'porcentaje de produccion', 'rendimiento de postura', 'produccion diaria', 'huevos por gallina', 'huevos al dia', 'cuantos huevos ponen', 'cuantos huevos debe', 'conversion alimenticia'],
    pistas: ['anotar', 'indicadores', 'pesar', 'medir', 'rendimiento', 'tendencias'],
    fuentes: ['registros', 'bienestar'],
    texto: [
      'Anota cada día cuántas gallinas hay, huevos totales, huevos dañados, alimento y agua utilizados. Registra cambios de cama, iluminación, alimento o clima junto a la fecha para comparar tendencias.',
      'Para calcular el porcentaje de postura diario, divide los huevos del día entre las gallinas presentes y multiplica por 100. Si 40 gallinas dieron 30 huevos, la postura fue de 75 %. Compara días del mismo lote y separa los huevos vendibles para calcular los ingresos.'
    ]
  },
  {
    id: 'costos',
    claves: ['costo por huevo', 'costo de huevo', 'costo del huevo', 'producir huevo', 'producir un huevo', 'producir huevos', 'costo de produccion', 'costos de produccion', 'costo por docena', 'precio por docena', 'cuanto cuesta producir', 'negocio de huevo', 'ganancia por huevo', 'presupuesto de gallinas', 'rentabilidad del huevo', 'gastos del gallinero'],
    pistas: ['costo', 'costos', 'cuesta', 'gastos', 'presupuesto', 'precio', 'ganancia', 'rentabilidad', 'producir', 'docena'],
    fuentes: ['presupuesto'],
    texto: [
      'Para estimar el costo por huevo vendible, suma alimento, aves, cama, electricidad, agua, empaque, mano de obra y la parte del equipo e instalaciones que corresponde al periodo. Divide ese total entre los huevos vendibles del mismo periodo.',
      'Ejemplo en pesos mexicanos. Si gastaste $1,500 y obtuviste 600 huevos vendibles, el costo es $2.50 por huevo o $30 por docena. Para calcular el margen, resta este costo de tu precio de venta e incluye gastos de entrega si aplican.'
    ]
  }
];

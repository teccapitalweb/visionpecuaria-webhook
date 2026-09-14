# Curso inicial

`course-policy.js` ordena los cursos publicados por `ordenDrip` y desempata por ID. Solo el primero ofrece sus clases anteriores a la última de forma gratuita. Con cero o una clase no hay videos gratuitos. Los flags de preview de otras clases no conceden acceso.

`GET /catalogo-cursos` utiliza una lista explícita de metadatos y omite todos los campos de reproducción de la última clase y de los demás cursos. `GET /cursos-membresia` conserva la comprobación de Firebase ID token y membresía vigente antes de entregar el contenido completo.

Publicar este backend junto con la actualización de `VisionPecuaria`. Las reglas Firestore existentes que restringen la colección `cursos` deben permanecer activas. Los videos ya conocidos del proveedor conservan sus condiciones de acceso; este cambio no configura ni revoca enlaces externos.

Validación: `npm test` ejecuta nueve pruebas sin credenciales sobre cursos de 0, 1, 2, 3, 8 y 12 clases, índices inválidos, empates, cursos ocultos y preservación del contenido pagado. La misma política se incluye en `VisionPecuaria/rancho-js/course-policy.js`.

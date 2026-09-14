(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisionCoursePolicy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function order(course) {
    const value = Number(course.ordenDrip);
    return Number.isFinite(value) && value > 0 ? value : 999;
  }
  function orderedCourses(courses) {
    return (Array.isArray(courses) ? courses : [])
      .filter(c => c && c.activo !== false && c.publicado !== false)
      .slice().sort((a, b) => order(a) - order(b) || String(a.id).localeCompare(String(b.id), 'en'));
  }
  function isInitialCourse(course, courses) {
    const first = orderedCourses(courses)[0];
    return !!course && !!first && typeof course.id === 'string' && course.id === first.id;
  }
  function isFreeLesson(course, index, courses) {
    return isInitialCourse(course, courses) && Array.isArray(course.clases)
      && Number.isInteger(index) && index >= 0 && index < course.clases.length - 1;
  }
  function publicCatalog(courses) {
    const sorted = orderedCourses(courses);
    return sorted.map(course => ({
      id: course.id,
      titulo: course.titulo || 'Curso', instructor: course.instructor || 'Visión Pecuaria',
      categoria: course.categoria || 'General', descripcion: course.descripcion || '', foto: course.foto || '',
      ordenDrip: order(course), diasDrip: course.diasDrip || 8,
      esCursoInicial: isInitialCourse(course, sorted),
      clases: (Array.isArray(course.clases) ? course.clases : []).map((lesson, index) => {
        const item = { titulo: lesson?.titulo || `Clase ${index + 1}`, duracion: lesson?.duracion || '' };
        if (isFreeLesson(course, index, sorted)) {
          item.url = lesson?.url || ''; item.videoUrl = lesson?.videoUrl || '';
          item.bunnyLibraryId = lesson?.bunnyLibraryId || ''; item.bunnyVideoId = lesson?.bunnyVideoId || '';
          item.bunnyActivo = lesson?.bunnyActivo !== false;
        }
        return item;
      })
    }));
  }
  return { orderedCourses, isInitialCourse, isFreeLesson, publicCatalog };
});

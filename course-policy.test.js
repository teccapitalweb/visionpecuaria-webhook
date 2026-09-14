const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./course-policy');
function course(id, ordenDrip, count) {
  return { id, ordenDrip, clases: Array.from({ length: count }, (_, i) => ({ titulo: `Clase ${i + 1}`, url: `private-${id}-${i}`, bunnyVideoId: `video-${id}-${i}`, isPreview: true })) };
}
for (const count of [0, 1, 2, 3, 8, 12]) {
  test(`only the first ${Math.max(0, count - 1)} lessons of the first course are free (${count} total)`, () => {
    const first = course('first', 1, count), other = course('other', 2, 8);
    const catalog = policy.publicCatalog([other, first]);
    assert.equal(catalog[0].id, 'first');
    assert.equal(catalog[0].clases.filter(c => c.url).length, Math.max(0, count - 1));
    assert.equal(catalog[1].clases.some(c => c.url || c.bunnyVideoId), false);
    if (count) assert.equal('url' in catalog[0].clases[count - 1], false);
    for (const index of [-1, count, NaN, 0.5, '0']) assert.equal(policy.isFreeLesson(first, index, [first, other]), false);
  });
}
test('ties and string order values have one stable introductory course', () => {
  const a = course('a', '1', 3), b = course('b', 1, 3);
  assert.equal(policy.isFreeLesson(a, 0, [b, a]), true);
  assert.equal(policy.isFreeLesson(b, 0, [b, a]), false);
});
test('unpublished courses and legacy preview flags do not grant access', () => {
  const hidden = { ...course('hidden', 1, 8), publicado: false };
  const visible = course('visible', 2, 3), other = course('other', 3, 8);
  const out = policy.publicCatalog([hidden, other, visible]);
  assert.equal(out.length, 2);
  assert.equal(policy.isFreeLesson(hidden, 0, [hidden, other, visible]), false);
  assert.equal(out[0].id, 'visible');
  assert.equal(out[1].clases.some(c => c.url), false);
});
test('paid course source is unchanged by catalog sanitization', () => {
  const courses = [course('first', 1, 3), course('other', 2, 8)];
  const original = JSON.stringify(courses);
  policy.publicCatalog(courses);
  assert.equal(JSON.stringify(courses), original);
  assert.equal(courses[0].clases[2].url, 'private-first-2');
});

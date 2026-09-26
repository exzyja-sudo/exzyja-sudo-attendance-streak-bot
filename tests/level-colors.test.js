const test = require('node:test');
const assert = require('node:assert/strict');
const { getLevelColor } = require('../level-colors');

test('level colors change with the level and cycle predictably', () => {
  assert.notEqual(getLevelColor(1), getLevelColor(2));
  assert.notEqual(getLevelColor(6), getLevelColor(7));
  assert.equal(getLevelColor(1), getLevelColor(13));
  assert.throws(() => getLevelColor(0), RangeError);
});
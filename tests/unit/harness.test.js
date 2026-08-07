const { test } = require('node:test');
const assert = require('node:assert/strict');

test('test runner executes synchronous tests', () => {
  assert.equal(1 + 1, 2);
});

test('test runner executes async tests', async () => {
  const value = await Promise.resolve(40 + 2);
  assert.equal(value, 42);
});

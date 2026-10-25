import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisGaps } from './ruler.ts';

test('axisGaps', () => {
  assert.deepEqual(axisGaps(0, 10, 25, 40), [[10, 25]]); // b right of a
  assert.deepEqual(axisGaps(30, 50, 0, 20), [[20, 30]]); // b left of a
  assert.deepEqual(axisGaps(0, 100, 10, 80), [[0, 10], [80, 100]]); // b inside a
  assert.deepEqual(axisGaps(0, 10, 0, 10), []); // same box
});

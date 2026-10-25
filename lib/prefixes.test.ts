import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hints, interpret, PREFIXES } from './prefixes.ts';

test('every prefix resolves to its own entry', () => {
  assert.equal(new Set(PREFIXES.map((p) => p.key)).size, PREFIXES.length);
  for (const p of PREFIXES) assert.equal(interpret(`:${p.key} x`)?.prefix, p);
});

test('aliases share a mode with a listed prefix and stay out of hints', () => {
  for (const a of PREFIXES.filter((p) => p.alias)) {
    assert.ok(PREFIXES.some((p) => !p.alias && p.mode === a.mode && p.label === a.label));
    assert.ok(!hints(':').includes(a));
  }
});

test('interpret', () => {
  assert.deepEqual(interpret(':ai  hello there ')?.text, 'hello there');
  assert.equal(interpret(':ai')?.prefix.mode, 'chat');
  assert.equal(interpret(':aix'), null);
  assert.equal(interpret('ai'), null);
});

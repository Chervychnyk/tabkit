import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconLoader } from './icons.ts';

const img = () => ({ src: '', onerror: null as OnErrorEventHandler });
const tick = () => new Promise((r) => setTimeout(r));

test('iconLoader: loads directly until one icon fails, then asks the background for the rest', async () => {
  const asked: string[] = [];
  const icon = iconLoader((u) => `ext:${u}`, async (u) => (asked.push(u), `data:${u}`));
  const a = img(), b = img();
  icon('a')(a);
  icon('b')(b);
  assert.deepEqual([a.src, b.src], ['ext:a', 'ext:b']);

  a.onerror!('error');
  await tick();
  assert.equal(a.src, 'data:a');
  assert.equal(a.onerror, null, 'a failed data: URL must not retry');

  const c = img();
  icon('c')(c);
  await tick();
  assert.equal(c.src, 'data:c', 'later icons skip the blocked URL');
  assert.deepEqual(asked, ['a', 'c'], 'b loaded directly and is not fetched again');
});

test('iconLoader: a reply that lands after teardown is dropped', async () => {
  let resolve!: (s: string) => void;
  const icon = iconLoader((u) => `ext:${u}`, () => new Promise((r) => (resolve = r)));
  const a = img();
  const teardown = icon('a')(a);
  a.onerror!('error');
  teardown();
  resolve('data:a');
  await tick();
  assert.equal(a.src, 'ext:a');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProvided, providerItems, PROVIDER_TIMEOUT, toItems } from './providers.ts';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

test('toItems keeps well-formed rows from another extension, named after it', () => {
  assert.deepEqual(toItems(EXT, 'Markboard', 'nope'), []);
  const items = toItems(EXT, 'Markboard', [{ id: 'note', title: 'New note' }, { id: 1, title: 'x' }, { id: 'y' }, null, { id: 'z', title: '' }]);
  assert.deepEqual(items, [{ id: `cmd:ext:${EXT}:note`, kind: 'command', title: 'Markboard: New note', command: `ext:${EXT}:note` }]);
  assert.equal(toItems(EXT, 'M', [{ id: 'a', title: 'x'.repeat(500) }])[0]!.title, `M: ${'x'.repeat(200)}`);
  assert.equal(toItems(EXT, 'M', Array.from({ length: 300 }, (_, i) => ({ id: `${i}`, title: 't' }))).length, 200);
});

test('parseProvided splits provider commands and leaves own ones', () => {
  assert.deepEqual(parseProvided(`ext:${EXT}:ws:123`), { extId: EXT, id: 'ws:123' });
  assert.equal(parseProvided('close-tab'), null);
});

test('providerItems skips a slow provider and forgets a gone one', async () => {
  let stored: Record<string, string> = { fast: 'Fast', slow: 'Slow', gone: 'Gone' };
  const replies: Record<string, () => Promise<unknown>> = {
    fast: async () => [{ id: 'a', title: 'A' }],
    slow: () => new Promise(() => {}), // never answers
    gone: async () => { throw new Error('Could not establish connection'); },
  };
  (globalThis as { browser?: unknown }).browser = {
    runtime: { sendMessage: (id: string) => replies[id]!() },
    storage: { local: { get: async () => ({ providers: { ...stored } }), set: async (v: { providers: Record<string, string> }) => void (stored = v.providers) } },
  };
  const start = Date.now();
  const items = await providerItems();
  assert.ok(Date.now() - start < PROVIDER_TIMEOUT + 200);
  assert.deepEqual(items.map((i) => i.title), ['Fast: A']);
  assert.deepEqual(stored, { fast: 'Fast', slow: 'Slow' });
});

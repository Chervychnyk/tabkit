import { test } from 'node:test';
import assert from 'node:assert/strict';
import { send } from './messages.ts';

const reply = (r: unknown) => ((globalThis as { browser?: unknown }).browser = { runtime: { sendMessage: async () => r } });

test('send resolves to the reply and throws a handler error', async () => {
  reply(['gpt-5']);
  assert.deepEqual(await send({ type: 'ai-models', provider: 'openai' }), ['gpt-5']);
  reply(null); // what Chrome delivers for a handler that resolved to nothing
  assert.equal(await send({ type: 'open-settings' }), undefined);
  reply({ error: 'No key' });
  await assert.rejects(send({ type: 'ai-models', provider: 'openai' }), { message: 'No key' });
});

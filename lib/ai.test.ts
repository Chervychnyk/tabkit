import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sse } from './ai.ts';

test('sse splits events across chunk boundaries', async () => {
  const chunks = ['data: {"a":1}\r\n\ndata: {"b"', ':2}\n\n: comment\nevent: x\ndata: [DONE]\n'];
  const body = new ReadableStream<BufferSource>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });
  const out: string[] = [];
  for await (const d of sse(body)) out.push(d);
  assert.deepEqual(out, ['{"a":1}', '{"b":2}', '[DONE]']);
});

import type { Replies } from '@/entrypoints/background';
import type { Message } from './types.ts';

/** Sends a message to the background and resolves to its typed reply; a handler's error is thrown here. */
export async function send<T extends Message['type']>(msg: Extract<Message, { type: T }>): Promise<Replies[T]> {
  const r = await browser.runtime.sendMessage(msg);
  if (r && typeof r === 'object' && 'error' in r) throw new Error(String(r.error));
  return r ?? undefined; // Chrome delivers an empty reply as null
}

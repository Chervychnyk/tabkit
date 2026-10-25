// Other extensions (e.g. Markboard) can add commands to the palette. A provider registers itself by messaging
// Tabkit; each palette load then asks it for its commands, and running one hands it back to the provider.
import type { Item } from './types.ts';

/** The messages a provider and Tabkit exchange (Markboard keeps a copy of this type). */
export type ProviderMessage =
  | { type: 'tabkit:register'; name: string } // provider → Tabkit
  | { type: 'tabkit:open' } // provider → Tabkit: open the palette over the sender's tab
  | { type: 'tabkit:commands' } // Tabkit → provider: reply { id, title }[]
  | { type: 'tabkit:run'; command: string; tabId?: number }; // Tabkit → provider

const providers = async () => ((await browser.storage.local.get('providers')).providers ?? {}) as Record<string, string>;
const setProviders = (p: Record<string, string>) => browser.storage.local.set({ providers: p });

export async function registerProvider(id: string, name: unknown) {
  await setProviders({ ...(await providers()), [id]: String(name ?? id).slice(0, 60) });
}

/** A provider's reply comes from another extension: keep only well-formed rows, within limits. Titles carry the
 * provider's name so its commands can't pass for Tabkit's own. */
export function toItems(extId: string, name: string, reply: unknown): Item[] {
  if (!Array.isArray(reply)) return [];
  return reply
    .filter((c): c is { id: string; title: string } => typeof c?.id === 'string' && typeof c?.title === 'string' && !!c.title)
    .slice(0, 200)
    .map((c) => ({ id: `cmd:ext:${extId}:${c.id}`, kind: 'command', title: `${name}: ${c.title.slice(0, 200)}`, command: `ext:${extId}:${c.id}` }));
}

/** How long a palette load waits for a provider; a slower one is skipped this time, not forgotten. */
export const PROVIDER_TIMEOUT = 300;

/** Every registered provider's commands; a provider that is gone (uninstalled, disabled) is forgotten. */
export async function providerItems(): Promise<Item[]> {
  const all = await providers();
  const gone: string[] = [];
  const lists = await Promise.all(Object.entries(all).map(([id, name]) => {
    const late = new Promise<Item[]>((done) => setTimeout(done, PROVIDER_TIMEOUT, []));
    const ask = browser.runtime.sendMessage(id, { type: 'tabkit:commands' } satisfies ProviderMessage).then(
      (reply) => toItems(id, name, reply),
      () => (gone.push(id), []),
    );
    return Promise.race([ask, late]);
  }));
  if (gone.length) {
    // Re-read so a provider that registered meanwhile isn't dropped.
    const now = await providers();
    for (const id of gone) delete now[id];
    await setProviders(now);
  }
  return lists.flat();
}

/** "ext:<extension id>:<command>" → its parts; null for Tabkit's own commands. */
export function parseProvided(command: string) {
  const m = /^ext:([^:]+):(.+)$/.exec(command);
  return m ? { extId: m[1]!, id: m[2]! } : null;
}

export async function runProvided(extId: string, id: string, tabId?: number) {
  const r = await browser.runtime.sendMessage(extId, { type: 'tabkit:run', command: id, tabId } satisfies ProviderMessage);
  if (r && typeof r === 'object' && 'error' in r) throw new Error(String(r.error));
}

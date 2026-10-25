import type { Tool } from './tools.ts';
import type { Filter } from './types.ts';

// Every ':word' prefix the palette understands, each with exactly one mode. Order is the ':' hint list order.
export type Prefix = { key: string; label: string; alias?: true } & (
  | { mode: 'filter'; filter: Filter }
  | { mode: 'command'; match: (id: string) => boolean } // narrows the palette to a few page commands
  | { mode: 'tool'; tool: Tool }
  | { mode: 'answer' }
  | { mode: 'chat' }
);

export const PREFIXES: Prefix[] = [
  { key: 't', label: 'Open tabs & commands', mode: 'filter', filter: 'tab' },
  { key: 'b', label: 'Bookmarks', mode: 'filter', filter: 'bookmark' },
  { key: 'h', label: 'History', mode: 'filter', filter: 'history' },
  { key: 'd', label: 'Downloads', mode: 'filter', filter: 'download' },
  { key: 'r', label: 'Recently closed', mode: 'filter', filter: 'closed' },
  { key: 'p', label: 'Pinned tabs', mode: 'filter', filter: 'pinned' },
  { key: 'c', label: 'Commands', mode: 'filter', filter: 'command' },
  { key: 's', label: 'Web search', mode: 'filter', filter: 'search' },
  { key: 'ai', label: 'AI chat', mode: 'chat' },
  { key: 'em', label: 'Emoji', mode: 'tool', tool: 'emoji' },
  { key: 'emoji', label: 'Emoji', mode: 'tool', tool: 'emoji', alias: true },
  { key: 'td', label: 'To-do list', mode: 'tool', tool: 'todo' },
  { key: 'todo', label: 'To-do list', mode: 'tool', tool: 'todo', alias: true },
  { key: 'rss', label: 'RSS reader', mode: 'tool', tool: 'rss' },
  { key: 'wx', label: 'Weather', mode: 'tool', tool: 'weather' },
  { key: 'ss', label: 'Screenshot', mode: 'command', match: (id) => id.startsWith('shot-') },
  { key: 'cp', label: 'Color picker', mode: 'command', match: (id) => id === 'color-picker' },
  { key: 'rl', label: 'Ruler', mode: 'command', match: (id) => id === 'ruler' },
  { key: 'tx', label: 'Text case', mode: 'answer' },
  { key: 'uuid', label: 'UUID v4', mode: 'answer' },
  { key: 'pwd', label: 'Password (e.g. :pwd 24)', mode: 'answer' },
];

/** The prefix a query starts with and the text after it (":h foo" → History, "foo"); null for plain text or an unknown prefix. */
export function interpret(q: string): { prefix: Prefix; text: string } | null {
  const m = /^:(\w+)(?:\s+([\s\S]*))?$/.exec(q);
  const prefix = m && PREFIXES.find((p) => p.key === m[1]);
  return prefix ? { prefix, text: (m[2] ?? '').trim() } : null;
}

/** Prefixes offered while typing ":" or ":h…"; aliases stay out. */
export const hints = (q: string) => PREFIXES.filter((p) => !p.alias && `:${p.key}`.startsWith(q));

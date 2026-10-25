import fuzzysort from 'fuzzysort';
import { answer } from './answers.ts';
import { hints, interpret } from './prefixes.ts';
import type { Filter, Item, Kind } from './types.ts';

export const ENGINES: Record<string, string> = {
  Google: 'https://www.google.com/search?q=',
  Bing: 'https://www.bing.com/search?q=',
  DuckDuckGo: 'https://duckduckgo.com/?q=',
  Yahoo: 'https://search.yahoo.com/search?p=',
  Brave: 'https://search.brave.com/search?q=',
};

/** The Tools tab: each row opens a tool by inserting its prefix (or runs a page command). */
export const TOOL_ITEMS: Item[] = [
  { id: 'tool:ai', kind: 'prefix', title: 'AI chat', command: ':ai ', icon: '✦' },
  { id: 'tool:em', kind: 'prefix', title: 'Emoji picker', command: ':em ', icon: '☺' },
  { id: 'tool:td', kind: 'prefix', title: 'To-do list', command: ':todo ', icon: '☑' },
  { id: 'tool:rss', kind: 'prefix', title: 'RSS reader', command: ':rss ', icon: '◉' },
  { id: 'tool:wx', kind: 'prefix', title: 'Weather', command: ':wx ', icon: '☀' },
  { id: 'tool:ss', kind: 'prefix', title: 'Screenshot', command: ':ss ', icon: '▣' },
  { id: 'tool:cp', kind: 'command', title: 'Color picker', command: 'color-picker', icon: '◍' },
  { id: 'tool:rl', kind: 'command', title: 'Ruler', command: 'ruler', icon: '📏' },
  { id: 'tool:qr', kind: 'command', title: 'QR code for this page', command: 'qr-code', icon: '▦' },
  { id: 'tool:tx', kind: 'prefix', title: 'Text case converter', command: ':tx ', icon: 'Aa' },
  { id: 'tool:uuid', kind: 'prefix', title: 'UUID generator', command: ':uuid', icon: '#' },
  { id: 'tool:pwd', kind: 'prefix', title: 'Password generator', command: ':pwd ', icon: '***' },
];

const LIMIT = 50;
// Open tabs and commands win ties against history noise.
const BOOST: Partial<Record<Kind, number>> = { tab: 0.15, command: 0.1, bookmark: 0.05 };

export function parseQuery(q: string): { filter: Filter | null; text: string } {
  const p = interpret(q);
  return p?.prefix.mode === 'filter' ? { filter: p.prefix.filter, text: p.text } : { filter: null, text: q.trim() };
}

function matches(item: Item, f: Filter): boolean {
  if (f === 'all') return item.kind !== 'download'; // downloads only show under :d or their filter
  if (f === 'tab') return item.kind === 'tab' || item.kind === 'command';
  if (f === 'pinned') return item.kind === 'tab' && !!item.pinned;
  return item.kind === f;
}

export function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/.test(s);
}

const rank = <T extends Item>(text: string, pool: T[], boost = BOOST) =>
  fuzzysort
    .go(text, pool, { keys: ['title', 'url'], limit: 200 })
    .map((r) => ({ item: r[0]?.indexes.length ? { ...r.obj, hl: r[0].indexes } : r.obj, s: r.score + (boost[r.obj.kind] ?? 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, LIMIT)
    .map((x) => x.item);

/** Splits text into plain/matched runs for highlighting. */
export function segments(text: string, hl: readonly number[] = []): { t: string; m: boolean }[] {
  const set = new Set(hl);
  const out: { t: string; m: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (out.at(-1)?.m === m) out.at(-1)!.t += text[i];
    else out.push({ t: text[i]!, m });
  }
  return out;
}

/** "740 KB", "1.2 GB" (decimal units, like the browser's downloads page). */
export function fileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3)) : 0;
  const n = bytes / 1000 ** i;
  return `${i && n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "Just now", "18m ago", "3h ago", "2d ago". */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  return m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

/** Stable group by kind, groups in order of first appearance, so the best match's group leads. */
export function groupByKind(list: Item[]): Item[] {
  const groups = new Map<string, Item[]>();
  for (const i of list) (groups.get(i.kind) ?? groups.set(i.kind, []).get(i.kind)!).push(i);
  return [...groups.values()].flat();
}

export function search(items: Item[], query: string, chip: Filter = 'all', engines = Object.keys(ENGINES)): Item[] {
  const hit = interpret(query);
  const p = hit?.prefix;
  if (p?.mode === 'answer') return answer(query);
  if (p?.mode === 'command') {
    const pool = items.filter((i) => i.kind === 'command' && p.match(i.command!));
    return hit!.text ? rank(hit!.text, pool) : pool;
  }
  const { filter, text } = parseQuery(query);
  if (!filter && /^:\w*$/.test(query))
    return hints(query).map(({ key, label }) => ({ id: `prefix:${key}`, kind: 'prefix', title: `:${key}  ${label}`, command: `:${key} ` }));
  const f = filter ?? chip;
  if (f === 'tools') return text ? rank(text, TOOL_ITEMS, {}) : TOOL_ITEMS;
  const out: Item[] = !filter && chip === 'all' ? answer(text) : [];
  if (f !== 'search') {
    const pool = items.filter((i) => matches(i, f));
    const closed = (i: Item) => i.kind === 'closed';
    // Before typing, All also shows the last few closed tabs below the open ones.
    const shown = text ? rank(text, pool)
      : f === 'all' ? [...pool.filter((i) => !closed(i)).slice(0, LIMIT), ...pool.filter(closed).slice(0, 5)]
      : pool.slice(0, LIMIT);
    out.push(...groupByKind(shown));
  }
  if (text && (f === 'all' || f === 'search')) {
    if (looksLikeUrl(text)) {
      const url = /^https?:\/\//.test(text) ? text : `https://${text}`;
      out.unshift({ id: 'url', kind: 'url', title: `Open ${url}`, url });
    }
    for (const [name, base] of Object.entries(ENGINES).filter(([n]) => engines.includes(n)))
      out.push({ id: `search:${name}`, kind: 'search', title: `Search “${text}” on ${name}`, url: base + encodeURIComponent(text) });
  }
  return out;
}

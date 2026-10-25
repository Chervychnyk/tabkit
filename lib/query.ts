import fuzzysort from 'fuzzysort';
import { ANSWER_PREFIXES, answer } from './answers.ts';
import { TOOL_LABELS } from './tools.ts';
import type { Filter, Item, Kind } from './types.ts';

export const PREFIXES: Record<string, { filter: Filter; label: string }> = {
  t: { filter: 'tab', label: 'Open tabs & commands' },
  b: { filter: 'bookmark', label: 'Bookmarks' },
  h: { filter: 'history', label: 'History' },
  d: { filter: 'download', label: 'Downloads' },
  r: { filter: 'closed', label: 'Recently closed' },
  p: { filter: 'pinned', label: 'Pinned tabs' },
  c: { filter: 'command', label: 'Commands' },
  s: { filter: 'search', label: 'Web search' },
};

export const ENGINES: Record<string, string> = {
  Google: 'https://www.google.com/search?q=',
  DuckDuckGo: 'https://duckduckgo.com/?q=',
  Bing: 'https://www.bing.com/search?q=',
  Brave: 'https://search.brave.com/search?q=',
  Yahoo: 'https://search.yahoo.com/search?p=',
};

/** Prefixes that narrow the palette to a few page commands. */
export const COMMAND_PREFIXES: Record<string, { label: string; match: (id: string) => boolean }> = {
  ss: { label: 'Screenshot', match: (id) => id.startsWith('shot-') },
  cp: { label: 'Color picker', match: (id) => id === 'color-picker' },
  rl: { label: 'Ruler', match: (id) => id === 'ruler' },
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
  const m = /^:(\w+)(?:\s+([\s\S]*))?$/.exec(q);
  const p = m?.[1] ? PREFIXES[m[1]] : undefined;
  if (p) return { filter: p.filter, text: (m![2] ?? '').trim() };
  return { filter: null, text: q.trim() };
}

function matches(item: Item, f: Filter): boolean {
  if (f === 'all') return true;
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

/** Stable group by kind, groups in order of first appearance, so the best match's group leads. */
export function groupByKind(list: Item[]): Item[] {
  const groups = new Map<string, Item[]>();
  for (const i of list) (groups.get(i.kind) ?? groups.set(i.kind, []).get(i.kind)!).push(i);
  return [...groups.values()].flat();
}

export function search(items: Item[], query: string, chip: Filter = 'all'): Item[] {
  if (/^:(tx|uuid|pwd)(\s|$)/.test(query)) return answer(query);
  const cmd = /^:(\w+)(?:\s+([\s\S]*))?$/.exec(query);
  const cp = cmd && COMMAND_PREFIXES[cmd[1]!];
  if (cp) {
    const pool = items.filter((i) => i.kind === 'command' && cp.match(i.command!));
    return cmd[2]?.trim() ? rank(cmd[2].trim(), pool) : pool;
  }
  const { filter, text } = parseQuery(query);
  if (!filter && /^:\w*$/.test(query)) {
    const labels = {
      ...Object.fromEntries(Object.entries(PREFIXES).map(([k, p]) => [k, p.label])),
      ...TOOL_LABELS,
      ...Object.fromEntries(Object.entries(COMMAND_PREFIXES).map(([k, p]) => [k, p.label])),
      ...ANSWER_PREFIXES,
    };
    return Object.entries(labels)
      .filter(([k]) => `:${k}`.startsWith(query))
      .map(([k, label]) => ({ id: `prefix:${k}`, kind: 'prefix', title: `:${k}  ${label}`, command: `:${k} ` }));
  }
  const f = filter ?? chip;
  if (f === 'tools') return text ? rank(text, TOOL_ITEMS, {}) : TOOL_ITEMS;
  const out: Item[] = !filter && chip === 'all' ? answer(text) : [];
  if (f !== 'search') {
    const pool = items.filter((i) => matches(i, f));
    out.push(...groupByKind(text ? rank(text, pool) : pool.slice(0, LIMIT)));
  }
  if (text && (f === 'all' || f === 'search')) {
    if (looksLikeUrl(text)) {
      const url = /^https?:\/\//.test(text) ? text : `https://${text}`;
      out.unshift({ id: 'url', kind: 'url', title: `Open ${url}`, url });
    }
    const engines = f === 'search' ? Object.entries(ENGINES) : Object.entries(ENGINES).slice(0, 1);
    for (const [name, base] of engines)
      out.push({ id: `search:${name}`, kind: 'search', title: `Search ${name} for “${text}”`, url: base + encodeURIComponent(text) });
  }
  return out;
}

// Pure parts of the tools (prefixes, emoji search, feed parsing, weather codes). Storage and network live in toolbox.ts.
import fuzzysort from 'fuzzysort';
import { interpret } from './prefixes.ts';

export type Tool = 'emoji' | 'todo' | 'rss' | 'weather';

export function parseTool(q: string): { tool: Tool; text: string } | null {
  const p = interpret(q);
  return p?.prefix.mode === 'tool' ? { tool: p.prefix.tool, text: p.text } : null;
}

export interface Emoji { label: string; unicode: string; hexcode: string; skins?: { hexcode: string; unicode: string }[] }

export const TONES = ['', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'];

/** The emoji in skin tone 1–5 (0 = default). Multi-person emoji get the variant where everyone has that tone. */
export function withTone(e: Emoji, tone: number): string {
  const t = TONES[tone];
  if (!t || !e.skins) return e.unicode;
  const same = (hex: string) => hex.split('-').filter((h) => /^1F3F[B-F]$/.test(h)).every((h) => h === t);
  return e.skins.find((s) => same(s.hexcode))?.unicode ?? e.unicode;
}

export function searchEmoji<T extends { key: string }>(list: T[], text: string, limit = 100): T[] {
  const found = fuzzysort.go(text, list, { key: 'key', limit }).map((r) => r.obj);
  // Exact keyword hits ("hello" → 👋) beat word-prefix hits ("cof" → ☕), which beat fuzzy ones; sort is stable so
  // fuzzy order survives within each rank.
  const q = ` ${text.toLowerCase()}`;
  const rank = (e: T) => { const k = ` ${e.key.toLowerCase()} `; return k.includes(`${q} `) ? 2 : k.includes(q) ? 1 : 0; };
  return found.sort((a, b) => rank(b) - rank(a));
}

/** Up/Down in a grid split into sections (each starting on a new row): the index one row away, or i at the edge. */
export function gridStep(starts: number[], total: number, cols: number, i: number, dir: 1 | -1): number {
  const s = starts.findLastIndex((x) => x <= i);
  const start = starts[s]!, end = starts[s + 1] ?? total, col = (i - start) % cols;
  if (dir === 1) {
    if (i - col + cols < end) return Math.min(i + cols, end - 1);
    return s + 1 < starts.length ? Math.min(end + col, (starts[s + 2] ?? total) - 1) : i;
  }
  if (i - start >= cols) return i - cols;
  if (s === 0) return i;
  const prev = starts[s - 1]!;
  return Math.min(prev + Math.floor((start - 1 - prev) / cols) * cols + col, start - 1);
}

export interface Entry { title: string; url: string; date: number }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function text(s = ''): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];

/**
 * RSS 2.0 / Atom / RDF. Regex-based because service workers have no DOMParser.
 * shortcut: ignores xml:base and relative links, good enough for real-world feeds.
 */
function linkOf(xml: string): string {
  const url = text(tag(xml, 'link'));
  if (url) return url;
  for (const [, attrs = ''] of xml.matchAll(/<link\b([^>]*)>/g))
    if (!/rel=["'](?!alternate)/.test(attrs)) return text(/href=["']([^"']*)/.exec(attrs)?.[1]);
  return '';
}

export function parseFeed(xml: string): { title: string; site: string; entries: Entry[]; alternate?: string } {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  const head = xml.slice(0, xml.search(/<(item|entry)[\s>]/) >>> 0);
  const entries = blocks.map((b) => {
    const url = linkOf(b);
    const date = Date.parse(text(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date')));
    return { title: text(tag(b, 'title')) || url, url, date: date || 0 };
  });
  // An HTML page instead of a feed: remember the feed it advertises, if any.
  const alternate = /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(head)?.[0].match(/href=["']([^"']+)/)?.[1];
  return { title: text(tag(head, 'title')), site: blocks.length ? linkOf(head) : '', entries: entries.filter((e) => e.url), ...(alternate && !blocks.length && { alternate: text(alternate) }) };
}

/** WMO weather interpretation codes used by Open-Meteo. */
export const WMO: Record<number, [string, string]> = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail'],
};

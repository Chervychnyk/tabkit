// Tools that need storage or the network; runs in the background worker.
import data from 'emojibase-data/en/compact.json';
import github from 'emojibase-data/en/shortcodes/github.json';
import fuzzysort from 'fuzzysort';
import { blobToDataUrl } from './page.ts';
import { looksLikeUrl } from './query.ts';
import { loadSettings } from './settings.ts';
import { parseFeed, searchEmoji, TONES, withTone, WMO, type Tool } from './tools.ts';
import type { Item } from './types.ts';

type Result = { copy?: string; query?: string } | void;

const LIMIT = 100;

async function get<T>(area: 'local' | 'sync', key: string, fallback: T): Promise<T> {
  return ((await browser.storage[area].get(key))[key] as T | undefined) ?? fallback;
}
const set = (area: 'local' | 'sync', key: string, value: unknown) => browser.storage[area].set({ [key]: value });

export function toolItems(tool: Tool, text: string): Promise<Item[]> {
  return { emoji: emojiItems, todo: todoItems, rss: rssItems, weather: weatherItems }[tool](text);
}

export async function toolRun(item: Item, alt: boolean): Promise<Result> {
  const [tool, action] = item.id.split(':');
  if (tool === 'em') return emojiRun(item, alt);
  if (tool === 'todo') return todoRun(item);
  if (tool === 'rss' && action === 'add') return addFeed(item.data as string);
  if (tool === 'wx' && action === 'add') return addPlace(item.data as Place);
  if (tool === 'wx' && action !== 'hint') return { copy: item.title };
}

export async function toolDelete(item: Item) {
  const [tool, action, key] = item.id.split(':');
  if (tool === 'todo' && action === 'item') await set('sync', 'todos', (await todos()).filter((t) => t.id !== key));
  if (tool === 'rss' && action === 'feed') await set('sync', 'feeds', (await feeds()).filter((f) => f.url !== item.data));
  if (tool === 'wx' && action === 'place') await set('sync', 'places', (await places()).filter((_, i) => i !== +key!));
}

// --- Emoji ---

const HANDS = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'];
const RECENT_MAX = 24;

let emoji: ((typeof data)[number] & { key: string; code: string })[] | undefined;

function emojiList() {
  return (emoji ??= data
    .filter((e) => e.group !== undefined && e.group !== 2) // drop loose regional letters and skin/hair components
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => {
      const c = (github as Record<string, string | string[]>)[e.hexcode];
      const code = (Array.isArray(c) ? c[0] : c) ?? e.label.replace(/\W+/g, '_');
      return { ...e, code, key: [e.label, code, ...(e.tags ?? [])].join(' ') };
    }));
}

async function emojiItems(text: string): Promise<Item[]> {
  const [tone, recent] = await Promise.all([get('local', 'emojiTone', 0), get<string[]>('local', 'emojiRecent', [])]);
  const list = emojiList();
  const toItem = (e: (typeof list)[number]): Item => {
    const char = withTone(e, tone);
    return { id: `em:${e.hexcode}`, kind: 'emoji', title: e.label, icon: char, copy: char, data: e.code };
  };
  if (text) return searchEmoji(list, text, LIMIT).map(toItem);
  const byHex = new Map(list.map((e) => [e.hexcode, e]));
  const recents = recent.flatMap((h) => byHex.get(h) ?? []);
  const rest = list.filter((e) => !recent.includes(e.hexcode)).slice(0, LIMIT * 2);
  return [{ id: 'em:tone', kind: 'emoji', title: 'Skin tone · Enter to change', icon: HANDS[tone] }, ...[...recents, ...rest].map(toItem)];
}

async function emojiRun(item: Item, alt: boolean): Promise<Result> {
  if (item.id === 'em:tone') return void (await set('local', 'emojiTone', ((await get('local', 'emojiTone', 0)) + 1) % TONES.length));
  const hex = item.id.slice(3);
  const recent = await get<string[]>('local', 'emojiRecent', []);
  await set('local', 'emojiRecent', [hex, ...recent.filter((h) => h !== hex)].slice(0, RECENT_MAX));
  return { copy: alt ? `:${item.data}:` : item.copy };
}

// --- To-do ---

interface Todo { id: string; text: string; done: boolean }
const todos = () => get<Todo[]>('sync', 'todos', []);

async function todoItems(text: string): Promise<Item[]> {
  const all = await todos();
  const q = text.toLowerCase();
  const shown = all.filter((t) => t.text.toLowerCase().includes(q)).sort((a, b) => +a.done - +b.done);
  const out: Item[] = shown.map((t) => ({ id: `todo:item:${t.id}`, kind: 'todo', title: t.text, icon: t.done ? '☑' : '☐' }));
  if (text && !all.some((t) => t.text.toLowerCase() === q)) out.unshift({ id: 'todo:add', kind: 'todo', title: `Add “${text}”`, icon: '+', data: text });
  if (!text && all.some((t) => t.done)) out.push({ id: 'todo:clear', kind: 'todo', title: 'Clear completed', icon: '✕' });
  return out;
}

async function todoRun(item: Item): Promise<Result> {
  const [, action, id] = item.id.split(':');
  const all = await todos();
  if (action === 'add') {
    await set('sync', 'todos', [...all, { id: crypto.randomUUID(), text: item.data as string, done: false }]);
    return { query: ':todo ' };
  }
  if (action === 'clear') return void (await set('sync', 'todos', all.filter((t) => !t.done)));
  await set('sync', 'todos', all.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
}

// --- RSS ---

interface Feed { url: string; title: string; color: string }
const COLORS = ['#f97316', '#8b5cf6', '#ef4444', '#0ea5e9', '#10b981', '#eab308', '#ec4899', '#14b8a6'];
const DEFAULT_FEEDS: Feed[] = [
  { title: 'Hacker News', url: 'https://hnrss.org/frontpage', color: COLORS[0]! },
  { title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', color: COLORS[1]! },
  { title: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', color: COLORS[2]! },
  { title: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', color: COLORS[3]! },
  { title: 'TechCrunch', url: 'https://techcrunch.com/feed/', color: COLORS[4]! },
  { title: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', color: COLORS[5]! },
];
const FEED_TTL = 10 * 60e3;
// shortcut: in-memory cache, refetched when the worker restarts; persist it if feeds feel slow.
const feedCache = new Map<string, { at: number; feed: Promise<ReturnType<typeof parseFeed>> }>();

const feeds = () => get('sync', 'feeds', DEFAULT_FEEDS);

function fetchFeed(url: string) {
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.at < FEED_TTL) return hit.feed;
  const feed = fetch(url, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(parseFeed);
  feed.catch(() => feedCache.delete(url));
  feedCache.set(url, { at: Date.now(), feed });
  return feed;
}

async function rssItems(text: string): Promise<Item[]> {
  if (looksLikeUrl(text)) return [{ id: 'rss:add', kind: 'feed', title: `Add feed ${text}`, icon: '+', data: text }];
  const list = await feeds();
  const results = await Promise.all(list.map((f) => fetchFeed(f.url).catch(() => ({ title: f.title, site: '', entries: [] }))));
  const icons = await feedIcons(list.map((f, i) => [f.url, hostOf(results[i]!.site) || hostOf(f.url)]));
  const entries: Item[] = results
    .flatMap((r, i) => r.entries.map((e) => ({ ...e, feed: list[i]! })))
    .sort((a, b) => b.date - a.date)
    .map((e, i) => ({ id: `rss:entry:${i}`, kind: 'feed', title: e.title, url: e.url, color: e.feed.color, image: icons[e.feed.url] }));
  const sources: Item[] = list.map((f) => ({ id: `rss:feed:${f.url}`, kind: 'feed', title: `Feed: ${f.title}`, color: f.color, image: icons[f.url], data: f.url }));
  if (!text) return [...entries.slice(0, LIMIT), ...sources];
  return fuzzysort.go(text, [...entries, ...sources], { key: 'title', limit: LIMIT }).map((r) => r.obj);
}

const hostOf = (url: string) => URL.parse(url)?.host ?? '';

/** Feed URL → site icon data URL. Icons are fetched once per host and kept in storage.local. */
async function feedIcons(feeds: [url: string, host: string][]): Promise<Record<string, string | undefined>> {
  const cache = await get<Record<string, string>>('local', 'feedIcons', {});
  const missing = [...new Set(feeds.map(([, h]) => h))].filter((h) => h && !(h in cache));
  if (missing.length) {
    await Promise.all(missing.map(async (host) => {
      // shortcut: DuckDuckGo's icon service sees the feed hosts; parse <link rel=icon> from the site if that matters.
      const r = await fetch(`https://icons.duckduckgo.com/ip3/${host}.ico`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (r?.ok) cache[host] = await blobToDataUrl(await r.blob());
      else if (r?.status === 404) cache[host] = ''; // site has no icon: remember, so we don't ask on every open
    }));
    await set('local', 'feedIcons', cache);
  }
  return Object.fromEntries(feeds.map(([url, h]) => [url, cache[h] || undefined]));
}

async function addFeed(input: string, discovered = false): Promise<Result> {
  const url = /^https?:\/\//.test(input) ? input : `https://${input}`;
  const list = await feeds();
  if (list.some((f) => f.url === url)) throw new Error('Feed already added');
  const feed = await fetchFeed(url).catch((e) => {
    throw new Error(`Couldn't load ${new URL(url).host}: ${e.name === 'TypeError' ? 'site unreachable' : e.message}`);
  });
  // A site's home page usually links its feed; follow that once.
  if (!feed.entries.length && feed.alternate && !discovered) return addFeed(new URL(feed.alternate, url).href, true);
  if (!feed.entries.length) throw new Error('No RSS or Atom feed found at that URL');
  await feedIcons([[url, hostOf(feed.site) || hostOf(url)]]); // cache the icon now so the list shows it right away
  await set('sync', 'feeds', [...list, { url, title: feed.title || new URL(url).host, color: COLORS[list.length % COLORS.length]! }]);
  return { query: ':rss ' };
}

// --- Weather (Open-Meteo, no key) ---

interface Place { name: string; lat: number; lon: number }
const PLACES_MAX = 15;
const places = () => get<Place[]>('sync', 'places', []);

async function json(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Weather service: HTTP ${r.status}`);
  return r.json();
}

async function weatherItems(text: string): Promise<Item[]> {
  const [all, { fahrenheit }] = await Promise.all([places(), loadSettings()]);
  const q = text.toLowerCase();
  const shown = all.map((p, i) => ({ p, i })).filter(({ p }) => p.name.toLowerCase().includes(q));
  const out: Item[] = [];
  const t = (n: number) => `${Math.round(n)}°`;
  if (shown.length) {
    const params = new URLSearchParams({
      latitude: shown.map(({ p }) => p.lat).join(), longitude: shown.map(({ p }) => p.lon).join(),
      current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto', forecast_days: '7', ...(fahrenheit && { temperature_unit: 'fahrenheit' }),
    });
    const res = [await json(`https://api.open-meteo.com/v1/forecast?${params}`)].flat();
    shown.forEach(({ p, i }, n) => {
      const { current: c, daily: d } = res[n];
      const [icon, desc] = WMO[c.weather_code] ?? ['', ''];
      out.push({ id: `wx:place:${i}`, kind: 'weather', icon, title: `${p.name}  ${t(c.temperature_2m)} · ${desc} · H ${t(d.temperature_2m_max[0])} L ${t(d.temperature_2m_min[0])}` });
      if (shown.length === 1 && text)
        d.time.forEach((day: string, k: number) => {
          const [icon, desc] = WMO[d.weather_code[k]] ?? ['', ''];
          const name = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
          out.push({ id: `wx:day:${k}`, kind: 'weather', icon, title: `${name}  ${t(d.temperature_2m_max[k])} / ${t(d.temperature_2m_min[k])} · ${desc}` });
        });
    });
  }
  if (text.length >= 2) {
    const geo = await json(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(text)}`);
    for (const g of geo.results ?? []) {
      const name = [g.name, g.admin1, g.country].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(', ');
      if (!all.some((p) => p.lat === g.latitude && p.lon === g.longitude))
        out.push({ id: `wx:add:${g.id}`, kind: 'weather', icon: '+', title: `Add ${name}`, data: { name: g.name, lat: g.latitude, lon: g.longitude } });
    }
  }
  if (!all.length && !text) out.push({ id: 'wx:hint', kind: 'weather', icon: '⌕', title: 'Type a city to add it' });
  return out;
}

async function addPlace(place: Place): Promise<Result> {
  const all = await places();
  if (all.length >= PLACES_MAX) throw new Error(`Up to ${PLACES_MAX} places, remove one first`);
  await set('sync', 'places', [...all, place]);
  return { query: ':wx ' };
}

import fuzzysort from 'fuzzysort';
import { blobToDataUrl } from '../page.ts';
import { looksLikeUrl } from '../query.ts';
import { parseFeed } from '../tools.ts';
import type { Item } from '../types.ts';
import { get, LIMIT, set, type Result, type ToolModule } from './shared.ts';

// Rows: rss:entry:<n> (has a url, so the palette opens it), rss:feed:<url> (data: url), rss:add (data: the typed URL).
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

async function items(text: string): Promise<Item[]> {
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

async function run(item: Item): Promise<Result> {
  if (item.id === 'rss:add') return addFeed(item.data as string);
}

async function remove(item: Item) {
  if (item.id.startsWith('rss:feed:')) await set('sync', 'feeds', (await feeds()).filter((f) => f.url !== item.data));
}

export const rss: ToolModule = { items, run, remove };

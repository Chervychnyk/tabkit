import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { toolDelete, toolItems, toolRun } from './toolbox.ts';
import { rss } from './toolbox/rss.ts';
import { todo } from './toolbox/todo.ts';
import { weather } from './toolbox/weather.ts';
import { toolOf } from './tools.ts';
import type { Item } from './types.ts';

const area = () => {
  const data: Record<string, unknown> = {};
  return { data, get: async (k: string) => ({ [k]: data[k] }), set: async (o: Record<string, unknown>) => void Object.assign(data, o) };
};
let sync: ReturnType<typeof area>, local: ReturnType<typeof area>;
beforeEach(() => {
  [sync, local] = [area(), area()];
  (globalThis as { browser?: unknown }).browser = { storage: { sync, local } };
});

const titles = (rows: Item[]) => rows.map((r) => `${r.icon} ${r.title}`);

test('rows map back to the tool that listed them', () => {
  assert.equal(toolOf('feed'), 'rss');
  assert.equal(toolOf('weather'), 'weather');
  assert.equal(toolOf('tab'), undefined);
});

test('rows reach the tool that listed them by kind; other rows are left alone', async () => {
  await toolRun((await toolItems('todo', 'milk'))[0]!, false);
  assert.deepEqual(titles(await toolItems('todo', '')), ['☐ milk']);
  await toolDelete((await toolItems('todo', ''))[0]!);
  assert.deepEqual(await toolItems('todo', ''), []);
  assert.equal(await toolRun({ id: 'tab:1', kind: 'tab', title: '' }, false), undefined);
});

test('emoji: search, copy (Shift: :code:), recents and skin tone', async () => {
  const [wave] = await toolItems('emoji', 'waving hand');
  assert.equal(wave?.title, 'waving hand');
  assert.deepEqual(await toolRun(wave!, false), { copy: '👋' });
  assert.deepEqual(await toolRun(wave!, true), { copy: ':wave:' });
  const all = await toolItems('emoji', '');
  assert.deepEqual([all[0]?.group, all[0]?.title], ['Recently used', 'waving hand']);
  local.data.emojiTone = 3;
  assert.equal((await toolItems('emoji', 'waving hand'))[0]?.copy, '👋🏽');
});

test('todo: add, check off, clear completed, delete', async () => {
  assert.deepEqual(await todo.run((await todo.items('milk'))[0]!, false), { query: ':todo ' });
  await todo.run((await todo.items('bread'))[0]!, false);
  assert.deepEqual(titles(await todo.items('')), ['☐ milk', '☐ bread']);
  assert.equal((await todo.items('milk'))[0]!.title, 'milk'); // exact match: no "Add" row

  await todo.run((await todo.items('milk'))[0]!, false);
  assert.deepEqual(titles(await todo.items('')), ['☐ bread', '☑ milk', '✕ Clear completed']);
  await todo.run((await todo.items('')).at(-1)!, false);
  assert.deepEqual(titles(await todo.items('')), ['☐ bread']);

  await todo.remove!((await todo.items(''))[0]!);
  assert.deepEqual(await todo.items(''), []);
});

test('weather: add places up to the limit, remove one, copy a row', async () => {
  assert.deepEqual(titles(await weather.items('')), ['⌕ Type a city to add it']);
  assert.equal(await weather.run({ id: 'wx:hint', kind: 'weather', title: '' }, false), undefined);
  const add = (n: number): Item => ({ id: `wx:add:${n}`, kind: 'weather', title: '', data: { name: `City ${n}`, lat: n, lon: n } });
  for (let n = 0; n < 15; n++) assert.deepEqual(await weather.run(add(n), false), { query: ':wx ' });
  await assert.rejects(weather.run(add(15), false), /Up to 15 places/);

  await weather.remove!({ id: 'wx:place:1', kind: 'weather', title: '' });
  const names = (sync.data.places as { name: string }[]).map((p) => p.name);
  assert.equal(names.length, 14);
  assert.ok(!names.includes('City 1') && names.includes('City 2'));
  assert.deepEqual(await weather.run({ id: 'wx:place:0', kind: 'weather', title: 'Kyiv 12°' }, false), { copy: 'Kyiv 12°' });
});

test('rss: a home page is followed to its feed once; duplicates and pages without a feed are refused', async () => {
  const pages: Record<string, string> = {
    'https://blog.example/': '<html><head><title>Blog</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
    'https://blog.example/feed.xml': '<rss><channel><title>Blog feed</title><item><title>Hi</title><link>https://blog.example/1</link></item></channel></rss>',
    'https://plain.example/': '<html><head><title>Plain</title></head></html>',
  };
  globalThis.fetch = (async (url: string) =>
    url in pages ? new Response(pages[url]) : new Response('', { status: 404 })) as typeof fetch;

  const add = (url: string): Item => ({ id: 'rss:add', kind: 'feed', title: '', data: url });
  assert.deepEqual(titles(await rss.items('blog.example/')), [`+ Add feed blog.example/`]);
  assert.deepEqual(await rss.run(add('blog.example/'), false), { query: ':rss ' });
  const added = (sync.data.feeds as { url: string; title: string }[]).at(-1);
  assert.deepEqual([added?.url, added?.title], ['https://blog.example/feed.xml', 'Blog feed']);

  await assert.rejects(rss.run(add('https://blog.example/feed.xml'), false), /already added/);
  await assert.rejects(rss.run(add('plain.example/'), false), /No RSS or Atom feed/);

  const count = (sync.data.feeds as unknown[]).length;
  await rss.remove!({ id: 'rss:feed:https://blog.example/feed.xml', kind: 'feed', title: '', data: 'https://blog.example/feed.xml' });
  assert.equal((sync.data.feeds as unknown[]).length, count - 1);
  assert.equal(await rss.run({ id: 'rss:entry:0', kind: 'feed', title: 'Hi', url: 'https://blog.example/1' }, false), undefined);
});

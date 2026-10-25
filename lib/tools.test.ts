import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeed, parseTool, searchEmoji, withTone } from './tools.ts';

test('parseTool', () => {
  assert.deepEqual(parseTool(':em'), { tool: 'emoji', text: '' });
  assert.deepEqual(parseTool(':todo buy milk '), { tool: 'todo', text: 'buy milk' });
  assert.deepEqual(parseTool(':wx kyiv'), { tool: 'weather', text: 'kyiv' });
  assert.equal(parseTool(':t foo'), null);
  assert.equal(parseTool('emoji'), null);
});

test('emoji tones and search', () => {
  const wave = { label: 'waving hand', unicode: '👋', hexcode: '1F44B', skins: [{ hexcode: '1F44B-1F3FB', unicode: '👋🏻' }, { hexcode: '1F44B-1F3FD', unicode: '👋🏽' }] };
  const pair = {
    label: 'people holding hands', unicode: '🧑‍🤝‍🧑', hexcode: '1F9D1-200D-1F91D-200D-1F9D1',
    skins: [{ hexcode: '1F9D1-1F3FB-200D-1F91D-200D-1F9D1-1F3FD', unicode: 'mixed' }, { hexcode: '1F9D1-1F3FD-200D-1F91D-200D-1F9D1-1F3FD', unicode: 'same' }],
  };
  assert.equal(withTone(wave, 0), '👋');
  assert.equal(withTone(wave, 3), '👋🏽');
  assert.equal(withTone(pair, 3), 'same');
  assert.equal(withTone({ label: 'x', unicode: '😀', hexcode: '1F600' }, 3), '😀');
  const list = [{ key: 'grinning face smile happy' }, { key: 'waving hand hello bye' }];
  assert.equal(searchEmoji(list, 'hello')[0], list[1]);
  const hug = { key: 'people hugging hellos' };
  assert.equal(searchEmoji([hug, list[1]!], 'hello')[0], list[1]);
});

test('parseFeed: RSS', () => {
  const xml = `<rss><channel><title>My &amp; Blog</title><atom:link href="https://x/feed" rel="self"/>
    <item><title><![CDATA[Hello <b>world</b>]]></title><link>https://x/1</link><pubDate>Tue, 10 Mar 2026 12:00:00 GMT</pubDate></item>
    <item><title>No date &#8217;s</title><link>https://x/2</link></item></channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.title, 'My & Blog');
  assert.equal(f.site, '');
  assert.deepEqual(f.entries[0], { title: 'Hello world', url: 'https://x/1', date: Date.UTC(2026, 2, 10, 12) });
  assert.equal(f.entries[1]!.title, 'No date ’s');
  assert.equal(f.entries[1]!.date, 0);
});

test('parseFeed: HTML page advertising a feed', () => {
  const html = `<html><head><title>Site</title><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml?a=1&amp;b=2"></head><body></body></html>`;
  assert.deepEqual(parseFeed(html), { title: 'Site', site: '', entries: [], alternate: '/feed.xml?a=1&b=2' });
  assert.equal(parseFeed('<html><head><title>x</title></head></html>').alternate, undefined);
});

test('parseFeed: Atom', () => {
  const xml = `<feed><title type="text">Atom</title><link href="https://a/" rel="alternate"/>
    <entry><title>Post</title><link rel="replies" href="https://a/1#c"/><link href="https://a/1"/><updated>2026-03-10T12:00:00Z</updated></entry></feed>`;
  const f = parseFeed(xml);
  assert.equal(f.title, 'Atom');
  assert.equal(f.site, 'https://a/');
  assert.deepEqual(f.entries, [{ title: 'Post', url: 'https://a/1', date: Date.UTC(2026, 2, 10, 12) }]);
});

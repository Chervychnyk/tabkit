import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByKind, parseQuery, search, looksLikeUrl, segments, TOOL_ITEMS } from './query.ts';
import type { Item } from './types.ts';

const items: Item[] = [
  { id: 't1', kind: 'tab', title: 'GitHub Pull Requests', url: 'https://github.com/pulls', pinned: true },
  { id: 't2', kind: 'tab', title: 'Gmail', url: 'https://mail.google.com' },
  { id: 'c1', kind: 'command', title: 'Close duplicate tabs', command: 'close-duplicates' },
  { id: 'b1', kind: 'bookmark', title: 'GitHub Docs', url: 'https://docs.github.com' },
  { id: 'h1', kind: 'history', title: 'github trending', url: 'https://github.com/trending' },
  { id: 's1', kind: 'command', title: 'Screenshot visible → copy', command: 'shot-visible-copy' },
  { id: 'r1', kind: 'command', title: 'Ruler', command: 'ruler' },
];

test('parseQuery', () => {
  assert.deepEqual(parseQuery(':b foo bar'), { filter: 'bookmark', text: 'foo bar' });
  assert.deepEqual(parseQuery(':h'), { filter: 'history', text: '' });
  assert.deepEqual(parseQuery(':zz x'), { filter: null, text: ':zz x' });
  assert.deepEqual(parseQuery('  hi '), { filter: null, text: 'hi' });
});

test('prefix filters', () => {
  assert.deepEqual(search(items, ':b git').map((i) => i.id), ['b1']);
  assert.deepEqual(search(items, ':p').map((i) => i.id), ['t1']);
  assert.deepEqual(search(items, ':t').map((i) => i.id), ['t1', 't2', 'c1', 's1', 'r1']);
  assert.deepEqual(search(items, 'git', 'history').map((i) => i.id), ['h1']);
});

test('tabs outrank history, web search appended', () => {
  const r = search(items, 'github');
  assert.equal(r[0]?.kind, 'tab');
  assert.equal(r.at(-1)!.kind, 'search');
  assert.equal(search(items, ':s cats').length, 5);
});

test('command prefixes, tools tab, highlights, grouping', () => {
  assert.deepEqual(search(items, ':ss').map((i) => i.id), ['s1']);
  assert.deepEqual(search(items, ':rl').map((i) => i.id), ['r1']);
  assert.equal(search(items, '', 'tools').length, TOOL_ITEMS.length);
  assert.equal(search(items, 'emoji', 'tools')[0]?.id, 'tool:em');
  const gm = search(items, 'gmail').find((i) => i.id === 't2')!;
  assert.deepEqual(gm.hl, [0, 1, 2, 3, 4]);
  assert.equal(items[1]!.hl, undefined); // the shared item isn't mutated
  const k = (kind: string, id: string) => ({ id, kind, title: id }) as never;
  assert.deepEqual(groupByKind([k('tab', 'a'), k('history', 'b'), k('tab', 'c'), k('bookmark', 'd')]).map((i: { id: string }) => i.id), ['a', 'c', 'b', 'd']);
});

test('segments', () => {
  assert.deepEqual(segments('Gmail', [0, 1]), [{ t: 'Gm', m: true }, { t: 'ail', m: false }]);
  assert.deepEqual(segments('ab'), [{ t: 'ab', m: false }]);
});

test('prefix hints and urls', () => {
  assert.equal(search(items, ':').length, 19);
  assert.equal(search(items, ':uuid')[0]?.kind, 'answer');
  assert.equal(search(items, '2+2')[0]?.title, '4');
  assert.equal(search(items, ':d')[0], undefined); // exact prefix, no downloads
  assert.equal(search(items, 'example.com/x')[0]?.url, 'https://example.com/x');
  assert.ok(looksLikeUrl('localhost:3000') && !looksLikeUrl('hello world'));
});

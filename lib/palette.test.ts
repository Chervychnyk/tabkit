import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeChip, step, type PaletteEvent, type PaletteState, type View } from './palette.ts';
import type { Item } from './types.ts';

const tab: Item = { id: 't1', kind: 'tab', title: 'GitHub', url: 'https://github.com', tabId: 1 };
const hist: Item = { id: 'h1', kind: 'history', title: 'wxt', url: 'https://wxt.dev' };
const prefix: Item = { id: 'prefix:h', kind: 'prefix', title: 'History', command: ':h ' };
const todo: Item = { id: 'todo:item:1', kind: 'todo', title: 'milk' };

const view = (o: Partial<View> = {}): View => ({
  results: [tab, hist, prefix], chips: ['all', 'tab', 'bookmark', 'history', 'download', 'closed', 'tools'], chat: false, qr: false, sections: [], ...o,
});
const s0: PaletteState = { query: '', chip: 'all', sel: 0 };
const key = (k: string, o: { shift?: boolean; mod?: boolean } = {}): PaletteEvent => ({ type: 'key', key: k, shift: !!o.shift, mod: !!o.mod });

test('arrows move the selection and clamp at the ends', () => {
  assert.equal(step(s0, key('ArrowDown'), view())?.state.sel, 1);
  assert.equal(step({ ...s0, sel: 2 }, key('ArrowDown'), view())?.state.sel, 2);
  assert.equal(step(s0, key('ArrowUp'), view())?.state.sel, 0);
  assert.equal(step(s0, key('ArrowDown'), view({ results: [] }))?.state.sel, 0);
});

test('emoji grid: arrows step by cell and row, Esc goes back to Tools', () => {
  const results = Array.from({ length: 25 }, (_, i): Item => ({ id: `em:${i}`, kind: 'emoji', title: String(i) }));
  const v = view({ results, tool: 'emoji', sections: [0] });
  const s = { query: ':em', chip: 'all' as const, sel: 3 };
  assert.equal(step(s, key('ArrowRight'), v)?.state.sel, 4);
  assert.equal(step(s, key('ArrowLeft'), v)?.state.sel, 2);
  assert.equal(step(s, key('ArrowDown'), v)?.state.sel, 13);
  assert.deepEqual(step(s, key('Escape'), v), { state: { query: '', chip: 'tools', sel: 0 } });
});

test('Esc closes; chat takes every other key; an open QR code leaves keys alone', () => {
  assert.deepEqual(step(s0, key('Escape'), view())?.effect, { do: 'close' });
  assert.deepEqual(step(s0, key('ArrowDown'), view({ chat: true }))?.effect, { do: 'chat' });
  assert.deepEqual(step(s0, key('Escape'), view({ chat: true }))?.effect, { do: 'close' });
  assert.equal(step(s0, key('ArrowDown'), view({ qr: true })), null);
});

test('Enter runs the row (Shift: current tab); on a prefix row it rewrites the query', () => {
  assert.deepEqual(step(s0, key('Enter'), view())?.effect, { do: 'run', item: tab, newTab: true });
  assert.deepEqual(step(s0, key('Enter', { shift: true }), view())?.effect, { do: 'run', item: tab, newTab: false });
  assert.deepEqual(step({ ...s0, query: '?', sel: 2 }, key('Enter'), view()), { state: { query: ':h ', chip: 'all', sel: 0 } });
  assert.deepEqual(step(s0, key('Enter'), view({ results: [] })), { state: s0 });
});

test('Mod+Backspace closes tabs and deletes tool rows, nothing else', () => {
  assert.deepEqual(step(s0, key('Backspace', { mod: true }), view())?.effect, { do: 'tab-close', item: tab });
  assert.deepEqual(step(s0, key('Backspace', { mod: true }), view({ results: [todo] }))?.effect, { do: 'tool-delete', item: todo });
  assert.equal(step({ ...s0, sel: 1 }, key('Backspace', { mod: true }), view()), null);
  assert.equal(step(s0, key('Backspace'), view()), null);
});

test('Tab cycles chips from the lit one and drops a filter prefix', () => {
  assert.deepEqual(step({ query: ':h wxt', chip: 'all', sel: 4 }, key('Tab'), view())?.state, { query: 'wxt', chip: 'download', sel: 0 });
  assert.deepEqual(step({ query: ':h wxt', chip: 'all', sel: 0 }, key('Tab', { shift: true }), view())?.state, { query: 'wxt', chip: 'bookmark', sel: 0 });
  assert.equal(step(s0, key('Tab', { shift: true }), view())?.state.chip, 'tools');
  assert.equal(step({ query: 'git', chip: 'tools', sel: 0 }, key('Tab'), view())?.state.chip, 'all');
  assert.equal(step(s0, key('Tab'), view({ tool: 'todo' })), null);
});

test('picking a chip keeps plain text but drops a filter prefix', () => {
  assert.equal(activeChip({ query: ':h wxt', chip: 'all' }), 'history');
  assert.equal(activeChip({ query: ':p', chip: 'tab' }), 'pinned');
  assert.equal(activeChip({ query: 'git', chip: 'tab' }), 'tab');
  assert.deepEqual(step({ query: 'git', chip: 'all', sel: 3 }, { type: 'pick', chip: 'tab' }, view())?.state, { query: 'git', chip: 'tab', sel: 0 });
  assert.deepEqual(step({ query: ':b docs', chip: 'all', sel: 0 }, { type: 'pick', chip: 'history' }, view())?.state, { query: 'docs', chip: 'history', sel: 0 });
});

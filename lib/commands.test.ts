import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTabAction } from './commands.ts';

interface FakeTab { id: number; windowId: number; pinned: boolean; groupId: number; splitViewId: number; index: number }

/** A tab strip per window, with Chrome's move semantics (the index is where the tab ends up) and its pinning rule
 * (a pinned tab leaves its group). ungroup refuses a tab that isn't grouped, to catch decisions made on stale state. */
function fakeBrowser(tabs: Omit<FakeTab, 'index' | 'splitViewId'>[], { split = true } = {}) {
  const all: FakeTab[] = tabs.map((t) => ({ ...t, index: 0, splitViewId: -1 }));
  const reindex = () => {
    for (const w of new Set(all.map((t) => t.windowId))) all.filter((t) => t.windowId === w).forEach((t, i) => (t.index = i));
  };
  reindex();
  const byId = (id: number) => all.find((t) => t.id === id)!;
  const strip = (w = 1) => all.filter((t) => t.windowId === w).map((t) => t.id);
  const place = (t: FakeTab, windowId: number, index: number) => {
    all.splice(all.indexOf(t), 1);
    t.windowId = windowId;
    const others = all.filter((x) => x.windowId === windowId);
    const before = index < 0 || index >= others.length ? null : others[index]!;
    all.splice(before ? all.indexOf(before) : all.length, 0, t);
    reindex();
  };
  const calls: string[] = [];
  const tabsApi = {
    get: async (id: number) => ({ ...byId(id) }),
    move: async (id: number, o: { windowId?: number; index: number }) => place(byId(id), o.windowId ?? byId(id).windowId, o.index),
    update: async (id: number, o: { pinned: boolean }) => {
      byId(id).pinned = o.pinned;
      if (o.pinned) byId(id).groupId = -1;
    },
    group: async (o: { tabIds: number; groupId: number }) => void (byId(o.tabIds).groupId = o.groupId),
    ungroup: async (id: number) => {
      assert.notEqual(byId(id).groupId, -1, 'ungroup on a tab that is not grouped');
      byId(id).groupId = -1;
    },
    unsplit: async (s: number) => {
      calls.push(`unsplit ${s}`);
      for (const t of all) if (t.splitViewId === s) t.splitViewId = -1;
    },
    ...(split && {
      createSplit: async (ids: number[]) => {
        const [a, b] = ids.map(byId);
        // Chrome's rules: adjacent, same window, pinned state and group, not already split.
        assert.equal(a!.windowId, b!.windowId);
        assert.equal(Math.abs(a!.index - b!.index), 1);
        assert.equal(a!.pinned, b!.pinned);
        assert.equal(a!.groupId, b!.groupId);
        assert.ok(a!.splitViewId === -1 && b!.splitViewId === -1);
        calls.push(`split ${ids.join(',')}`);
        a!.splitViewId = b!.splitViewId = 99;
      },
    }),
  };
  (globalThis as { browser?: unknown }).browser = { tabs: tabsApi };
  return { strip, byId, calls };
}

const tab = (id: number, o: Partial<FakeTab> = {}) => ({ id, windowId: 1, pinned: false, groupId: -1, ...o });

test('split: a tab right of the current one moves next to it', async () => {
  const b = fakeBrowser([tab(1), tab(2), tab(3), tab(4)]);
  await runTabAction('split', 4, 2);
  assert.deepEqual(b.strip(), [1, 2, 4, 3]);
  assert.deepEqual(b.calls, ['split 2,4']);
});

test('split: a tab left of the current one lands right after it', async () => {
  const b = fakeBrowser([tab(1), tab(2), tab(3), tab(4)]);
  await runTabAction('split', 1, 3);
  assert.deepEqual(b.strip(), [2, 3, 1, 4]);
});

test('split: a tab from another window, pinned or grouped differently, is brought in line', async () => {
  const b = fakeBrowser([tab(1), tab(2, { groupId: 7 }), tab(3, { groupId: 7 }), tab(4, { windowId: 2, pinned: true })]);
  await runTabAction('split', 4, 2);
  assert.deepEqual(b.strip(1), [1, 2, 4, 3]);
  assert.deepEqual([b.byId(4).pinned, b.byId(4).groupId], [false, 7]);
});

test('split: a grouped tab leaves its group to join an ungrouped or pinned current tab', async () => {
  const b = fakeBrowser([tab(1), tab(2, { groupId: 7 }), tab(3, { groupId: 7 })]);
  await runTabAction('split', 3, 1);
  assert.deepEqual(b.strip(), [1, 3, 2]);
  assert.equal(b.byId(3).groupId, -1);

  const p = fakeBrowser([tab(1, { pinned: true }), tab(2, { groupId: 7 })]);
  await runTabAction('split', 2, 1); // pinning already ungroups it; no second ungroup
  assert.deepEqual([p.byId(2).pinned, p.byId(2).groupId], [true, -1]);
});

test('split: existing splits are undone first; the current tab and old browsers are refused', async () => {
  const b = fakeBrowser([tab(1), tab(2), tab(3)]);
  b.byId(1).splitViewId = b.byId(2).splitViewId = 5;
  await runTabAction('split', 3, 2);
  assert.deepEqual(b.calls, ['unsplit 5', 'split 2,3']);
  await assert.rejects(runTabAction('split', 2, 2), /other than the current/);
  fakeBrowser([tab(1), tab(2)], { split: false });
  await assert.rejects(runTabAction('split', 2, 1), /Chrome 155/);
});

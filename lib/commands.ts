import type { Browser } from 'wxt/browser';
import { notify, PAGE_COMMANDS } from './page.ts';
import { loadSettings, saveSettings } from './settings.ts';
import type { TabAction } from './types.ts';

type Tab = Browser.tabs.Tab;

export interface Command {
  id: string;
  title: string;
  /** Run after the palette has closed (prints, screenshots, overlays). */
  deferred?: boolean;
  run: (ctx: Tab) => Promise<unknown>;
}

async function windowTabs(ctx: Tab) {
  return browser.tabs.query({ windowId: ctx.windowId });
}

async function closeWhere(ctx: Tab, keep: (t: Tab) => boolean) {
  const ids = (await windowTabs(ctx)).filter((t) => !t.pinned && !keep(t)).map((t) => t.id!);
  if (ids.length) await browser.tabs.remove(ids);
}

async function sortTabs(ctx: Tab) {
  const tabs = await windowTabs(ctx);
  const byTitle = (a: Tab, b: Tab) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });
  // Pinned tabs are always first, so sorting each group separately keeps them in place.
  const sorted = [...tabs.filter((t) => t.pinned).sort(byTitle), ...tabs.filter((t) => !t.pinned).sort(byTitle)];
  for (const [i, t] of sorted.entries()) await browser.tabs.move(t.id!, { index: i });
}

async function closeDuplicates(ctx: Tab) {
  const seen = new Set<string>();
  const dupes: number[] = [];
  const tabs = await browser.tabs.query({});
  // Visit the current and pinned tabs first so they are the ones kept.
  tabs.sort((a, b) => Number(b.id === ctx.id) - Number(a.id === ctx.id) || Number(b.pinned) - Number(a.pinned));
  for (const t of tabs) {
    const url = t.url ?? '';
    if (seen.has(url)) dupes.push(t.id!);
    else seen.add(url);
  }
  if (dupes.length) await browser.tabs.remove(dupes);
}

async function mergeWindows(ctx: Tab) {
  const wins = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  for (const w of wins) {
    if (w.id === ctx.windowId || w.incognito !== ctx.incognito) continue;
    for (const t of w.tabs ?? []) {
      await browser.tabs.move(t.id!, { windowId: ctx.windowId, index: -1 });
      if (t.pinned) await browser.tabs.update(t.id!, { pinned: true });
    }
  }
}

async function suspendInactive() {
  const tabs = await browser.tabs.query({ active: false, discarded: false, audible: false });
  await Promise.allSettled(tabs.map((t) => browser.tabs.discard(t.id!)));
}

async function muteAll(muted: boolean) {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((t) => browser.tabs.update(t.id!, { muted })));
}

export const COMMANDS: Command[] = [
  { id: 'new-tab', title: 'New tab', run: (ctx) => browser.tabs.create({ windowId: ctx.windowId }) },
  { id: 'new-window', title: 'New window', run: () => browser.windows.create({}) },
  { id: 'new-incognito', title: 'New incognito window', run: () => browser.windows.create({ incognito: true }) },
  { id: 'reopen-closed', title: 'Undo close tab (reopen last closed)', run: reopenClosed },
  { id: 'close-tab', title: 'Close current tab', run: (ctx) => browser.tabs.remove(ctx.id!) },
  { id: 'duplicate-tab', title: 'Duplicate current tab', run: (ctx) => browser.tabs.duplicate(ctx.id!) },
  { id: 'pin-tab', title: 'Pin / unpin current tab', run: (ctx) => browser.tabs.update(ctx.id!, { pinned: !ctx.pinned }) },
  { id: 'mute-tab', title: 'Mute / unmute current tab', run: (ctx) => browser.tabs.update(ctx.id!, { muted: !ctx.mutedInfo?.muted }) },
  { id: 'reload-tab', title: 'Reload current tab', run: (ctx) => browser.tabs.reload(ctx.id!) },
  { id: 'move-new-window', title: 'Move current tab to new window', run: (ctx) => browser.windows.create({ tabId: ctx.id }) },
  { id: 'bookmark-tab', title: 'Bookmark current tab', run: (ctx) => needs('bookmarks', 'Bookmarks').then(() => browser.bookmarks.create({ title: ctx.title, url: ctx.url })) },
  { id: 'ungroup-tab', title: 'Remove current tab from group', run: (ctx) => browser.tabs.ungroup(ctx.id!) },
  { id: 'close-duplicates', title: 'Close duplicate tabs', run: closeDuplicates },
  { id: 'close-left', title: 'Close tabs to the left', run: (ctx) => closeWhere(ctx, (t) => t.index >= ctx.index) },
  { id: 'close-right', title: 'Close tabs to the right', run: (ctx) => closeWhere(ctx, (t) => t.index <= ctx.index) },
  { id: 'close-others', title: 'Close other tabs', run: (ctx) => closeWhere(ctx, (t) => t.id === ctx.id) },
  { id: 'merge-windows', title: 'Merge all windows into one', run: mergeWindows },
  { id: 'suspend-inactive', title: 'Suspend inactive tabs', run: suspendInactive },
  { id: 'sort-tabs', title: 'Sort tabs alphabetically', run: sortTabs },
  { id: 'mute-all', title: 'Mute all tabs', run: () => muteAll(true) },
  { id: 'unmute-all', title: 'Unmute all tabs', run: () => muteAll(false) },
  { id: 'reload-all', title: 'Reload all tabs in window', run: async (ctx) => (await windowTabs(ctx)).forEach((t) => browser.tabs.reload(t.id!)) },
  ...PAGE_COMMANDS,
  { id: 'settings', title: 'TabCmdr settings', run: () => browser.runtime.openOptionsPage() },
  { id: 'toggle-site', title: 'Disable / enable the palette shortcut on this site', run: toggleSite },
];

/** Optional permissions are granted in Settings; commands that need one explain where to turn it on. */
async function needs(permission: 'bookmarks' | 'sessions', label: string) {
  if (!(await browser.permissions.contains({ permissions: [permission] })))
    throw new Error(`${label} access is off; turn it on in TabCmdr settings → Data sources`);
}

async function reopenClosed() {
  await needs('sessions', 'Recently closed');
  if (!(await browser.sessions.getRecentlyClosed({ maxResults: 1 })).length) throw new Error('No recently closed tabs');
  await browser.sessions.restore();
}

async function toggleSite(ctx: Tab) {
  const host = URL.parse(ctx.url ?? '')?.hostname;
  if (!host) return;
  const s = await loadSettings();
  const off = s.disabledDomains.includes(host);
  s.disabledDomains = off ? s.disabledDomains.filter((d) => d !== host) : [...s.disabledDomains, host];
  await saveSettings(s);
  await notify(ctx, off ? `Shortcut enabled on ${host}` : `Shortcut disabled on ${host}; the toolbar icon still works`);
}

export async function runTabAction(action: TabAction, tabId: number) {
  const t = await browser.tabs.get(tabId);
  switch (action) {
    case 'reload': return browser.tabs.reload(tabId);
    case 'mute': return browser.tabs.update(tabId, { muted: !t.mutedInfo?.muted });
    case 'pin': return browser.tabs.update(tabId, { pinned: !t.pinned });
    case 'duplicate': return browser.tabs.duplicate(tabId);
    case 'incognito': return browser.windows.create({ url: t.url, incognito: true });
    case 'new-window': return browser.windows.create({ tabId });
    case 'close': return browser.tabs.remove(tabId);
  }
}

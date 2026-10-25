import type { Browser } from 'wxt/browser';
import { COMMANDS, runTabAction } from '@/lib/commands';
import { allowLocalModels, listModels, onChatPort, targets } from '@/lib/ai';
import { notify } from '@/lib/page';
import { DATA_SOURCES } from '@/lib/settings';
import { toolDelete, toolItems, toolRun } from '@/lib/toolbox';
import type { Item, Message } from '@/lib/types';

const HISTORY_DAYS = 90;
const HISTORY_MAX = 3000;

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (cmd) => {
    if (cmd !== 'open-palette') return;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) toggle(tab);
  });
  browser.action.onClicked.addListener(toggle);

  // Tabs opened before install have no hotkey listener yet.
  browser.runtime.onConnect.addListener(onChatPort);
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await allowLocalModels();
    // Bookmarks, history, downloads and recently closed are optional; let the user choose them first.
    // Skipped in e2e builds: the new tab steals keyboard focus from the page under test.
    if (reason === 'install' && !import.meta.env.WXT_E2E) browser.runtime.openOptionsPage();
    for (const t of await browser.tabs.query({}))
      browser.scripting.executeScript({ target: { tabId: t.id! }, files: ['/content-scripts/hotkey.js'] }).catch(() => {});
  });

  browser.runtime.onMessage.addListener((msg: Message, sender, reply) => {
    handle(msg, sender).then(reply, (e) => reply({ error: e?.message ?? String(e) }));
    return true;
  });
});

async function toggle(tab: Browser.tabs.Tab) {
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id! }, files: ['/content-scripts/palette.js'] });
  } catch {
    // chrome://, the Web Store etc. can't be scripted: show the palette in its own window instead.
    const w = await browser.windows.get(tab.windowId);
    const width = 720, height = 520;
    browser.windows.create({
      url: browser.runtime.getURL(`/window.html?tab=${tab.id}`),
      type: 'popup', width, height,
      left: Math.round((w.left ?? 0) + ((w.width ?? width) - width) / 2),
      top: Math.round((w.top ?? 0) + 80),
    });
  }
}

async function handle(msg: Message, sender: Browser.runtime.MessageSender) {
  switch (msg.type) {
    case 'toggle':
      if (sender.tab) await toggle(sender.tab);
      return;
    case 'load': {
      const tabId = msg.tabId ?? sender.tab?.id;
      return { ...(await load()), tabId };
    }
    case 'run':
      return run(msg.item, await browser.tabs.get(msg.tabId), msg.newTab);
    case 'tab-action':
      return runTabAction(msg.action, msg.tabId);
    case 'tool':
      return toolItems(msg.tool, msg.text);
    case 'tool-run':
      return toolRun(msg.item, msg.alt);
    case 'tool-delete':
      return toolDelete(msg.item);
    case 'ai-targets':
      return targets();
    case 'ai-models':
      return listModels(msg.provider, msg.baseUrl, msg.key);
    case 'open-settings':
      return browser.runtime.openOptionsPage();
  }
}

async function load(): Promise<{ items: Item[]; missing: string[] }> {
  const granted = new Set<string>((await browser.permissions.getAll()).permissions);
  const missing = DATA_SOURCES.filter((d) => !granted.has(d.permissions[0])).map((d) => d.filter);
  const when = <T,>(perm: string, get: () => Promise<T>, empty: T) => (granted.has(perm) ? get() : Promise.resolve(empty));
  const [tabs, tree, history, downloads, closed] = await Promise.all([
    browser.tabs.query({}),
    when('bookmarks', () => browser.bookmarks.getTree(), []),
    when('history', () => browser.history.search({ text: '', startTime: Date.now() - HISTORY_DAYS * 864e5, maxResults: HISTORY_MAX }), []),
    when('downloads', () => browser.downloads.search({ limit: 200, orderBy: ['-startTime'] }), []),
    when('sessions', () => browser.sessions.getRecentlyClosed({ maxResults: 25 }), []),
  ]);
  const items: Item[] = tabs.map((t) => ({
    id: `tab:${t.id}`, kind: 'tab', title: t.title || t.url || '', url: t.url,
    tabId: t.id, windowId: t.windowId, pinned: t.pinned, muted: t.mutedInfo?.muted, audible: t.audible,
  }));
  for (const c of COMMANDS) items.push({ id: `cmd:${c.id}`, kind: 'command', title: c.title, command: c.id });

  const walk = (nodes: Browser.bookmarks.BookmarkTreeNode[]) => {
    for (const n of nodes) {
      // shortcut: javascript: bookmarklets are skipped, they need MAIN-world injection to run.
      if (n.url && !n.url.startsWith('javascript:')) items.push({ id: `bm:${n.id}`, kind: 'bookmark', title: n.title || n.url, url: n.url });
      if (n.children) walk(n.children);
    }
  };
  walk(tree);

  const open = new Set(tabs.map((t) => t.url));
  for (const h of history)
    if (!open.has(h.url)) items.push({ id: `h:${h.id}`, kind: 'history', title: h.title || h.url!, url: h.url });

  for (const d of downloads)
    items.push({ id: `dl:${d.id}`, kind: 'download', title: d.filename.split(/[\\/]/).pop() || d.url, url: d.finalUrl || d.url, downloadId: d.id });

  for (const s of closed) {
    if (s.tab) items.push({ id: `rc:${s.tab.sessionId}`, kind: 'closed', title: s.tab.title || s.tab.url || '', url: s.tab.url, sessionId: s.tab.sessionId });
    else if (s.window) items.push({ id: `rc:${s.window.sessionId}`, kind: 'closed', title: `Window (${s.window.tabs?.length ?? 0} tabs)`, sessionId: s.window.sessionId });
  }
  return { items, missing };
}

async function run(item: Item, ctx: Browser.tabs.Tab, newTab: boolean) {
  switch (item.kind) {
    case 'tab':
      await browser.tabs.update(item.tabId!, { active: true });
      return browser.windows.update(item.windowId!, { focused: true });
    case 'command': {
      const c = COMMANDS.find((c) => c.id === item.command);
      if (!c?.deferred) return c?.run(ctx);
      // Give the palette time to unmount so it isn't printed or captured.
      setTimeout(() => c.run(ctx).catch((e) => notify(ctx, `${c.title} failed: ${e.message ?? e}`)), 250);
      return;
    }
    case 'download': {
      const [d] = await browser.downloads.search({ id: item.downloadId });
      return d?.state === 'complete' && d.exists ? browser.downloads.open(d.id) : browser.downloads.show(item.downloadId!);
    }
    case 'closed':
      return browser.sessions.restore(item.sessionId);
    default:
      return newTab
        ? browser.tabs.create({ url: item.url, windowId: ctx.windowId, index: ctx.index + 1 })
        : browser.tabs.update(ctx.id!, { url: item.url });
  }
}

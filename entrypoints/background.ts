import type { Browser } from 'wxt/browser';
import { COMMANDS, runTabAction, splitOf } from '@/lib/commands';
import { allowLocalModels, listModels, onChatPort, targets } from '@/lib/ai';
import { notify } from '@/lib/page';
import { parseProvided, providerItems, registerProvider, runProvided } from '@/lib/providers';
import { ago, dedupeHistory, fileSize } from '@/lib/query';
import { DATA_SOURCES } from '@/lib/settings';
import { toolDelete, toolItems, toolRun } from '@/lib/toolbox';
import type { Item, Message, RunResult } from '@/lib/types';

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
    if (reason === 'install' && !import.meta.env.WXT_E2E) browser.tabs.create({ url: browser.runtime.getURL('/options.html#sources') });
    for (const t of await browser.tabs.query({}))
      browser.scripting.executeScript({ target: { tabId: t.id! }, files: ['/content-scripts/hotkey.js'] }).catch(() => {});
  });

  // A thrown error reaches send() (lib/messages.ts) as { error }, which throws it again on the caller's side.
  browser.runtime.onMessage.addListener((msg: Message, sender, reply) => {
    if (!Object.hasOwn(HANDLERS, msg.type)) return false; // e.g. a stale content script from an older build
    (HANDLERS[msg.type] as (m: Message, s: Browser.runtime.MessageSender) => Promise<unknown>)(msg, sender)
      .then(reply, (e) => reply({ error: e?.message ?? String(e) }));
    return true;
  });

  // Command providers (lib/providers.ts): other extensions register, and may open the palette over their own pages.
  browser.runtime.onMessageExternal.addListener((msg: unknown, sender) => {
    if (!sender.id || typeof msg !== 'object' || msg === null || !('type' in msg)) return;
    if (msg.type === 'tabkit:register') registerProvider(sender.id, 'name' in msg ? msg.name : undefined);
    // Only over the provider's own pages: a content script of another extension could otherwise open it over any site.
    else if (msg.type === 'tabkit:open' && sender.tab && sender.url?.startsWith(`chrome-extension://${sender.id}/`)) toggle(sender.tab);
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

type Handlers = { [K in Message['type']]: (msg: Extract<Message, { type: K }>, sender: Browser.runtime.MessageSender) => Promise<unknown> };

// One handler per message type; what each resolves to is that message's reply (Replies below).
const HANDLERS = {
  toggle: async (_, sender) => void (sender.tab && (await toggle(sender.tab))),
  load: async (msg, sender) => {
    const tabId = msg.tabId ?? sender.tab?.id;
    return { ...(await load(tabId)), tabId };
  },
  run: async (msg) => run(msg.item, await browser.tabs.get(msg.tabId), msg.newTab),
  'tab-action': async (msg) => void (await runTabAction(msg.action, msg.tabId, msg.ctxTabId)),
  // erase only drops the list entry; the file stays on disk
  'download-action': async (msg) =>
    void (await (msg.action === 'show' ? browser.downloads.show(msg.downloadId) : browser.downloads.erase({ id: msg.downloadId }))),
  tool: (msg) => toolItems(msg.tool, msg.text),
  'tool-run': (msg) => toolRun(msg.item, msg.alt),
  'tool-delete': (msg) => toolDelete(msg.item),
  'ai-targets': () => targets(),
  'ai-models': (msg) => listModels(msg.provider, msg.baseUrl, msg.key),
  'open-settings': () => browser.runtime.openOptionsPage(),
} satisfies Handlers;

/** The reply each message type resolves to. */
export type Replies = { [K in Message['type']]: Awaited<ReturnType<(typeof HANDLERS)[K]>> };

async function load(current?: number): Promise<{ items: Item[]; missing: string[] }> {
  const granted = new Set<string>((await browser.permissions.getAll()).permissions);
  const missing = DATA_SOURCES.filter((d) => !granted.has(d.permissions[0])).map((d) => d.filter);
  const when = <T,>(perm: string, get: () => Promise<T>, empty: T) => (granted.has(perm) ? get() : Promise.resolve(empty));
  const [tabs, groups, tree, history, downloads, closed, provided] = await Promise.all([
    browser.tabs.query({}),
    when('tabGroups', () => browser.tabGroups.query({}), []),
    when('bookmarks', () => browser.bookmarks.getTree(), []),
    when('history', () => browser.history.search({ text: '', startTime: Date.now() - HISTORY_DAYS * 864e5, maxResults: HISTORY_MAX }), []),
    when('downloads', () => browser.downloads.search({ limit: 100, orderBy: ['-startTime'] }), []),
    when('sessions', () => browser.sessions.getRecentlyClosed({ maxResults: 25 }), []),
    providerItems(),
  ]);
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  // The tab the palette opened on first, then the most recently used.
  tabs.sort((a, b) => +(b.id === current) - +(a.id === current) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const items: Item[] = tabs.map((t) => ({
    id: `tab:${t.id}`, kind: 'tab', title: t.title || t.url || '', url: t.url,
    tabId: t.id, windowId: t.windowId, pinned: t.pinned, muted: t.mutedInfo?.muted, audible: t.audible,
    tabGroup: t.groupId > 0 ? { title: groupOf.get(t.groupId)?.title, color: groupOf.get(t.groupId)?.color } : undefined,
    split: splitOf(t) !== -1 || undefined,
  }));
  // Most-run commands first; a stable sort keeps the list's own order among equals (and for never-run ones).
  const uses = await commandUses();
  const commands = [...COMMANDS.map((c): Item => ({ id: `cmd:${c.id}`, kind: 'command', title: c.title, command: c.id })), ...provided];
  items.push(...commands.sort((a, b) => (uses[b.command!] ?? 0) - (uses[a.command!] ?? 0)));

  const walk = (nodes: Browser.bookmarks.BookmarkTreeNode[]) => {
    for (const n of nodes) {
      // shortcut: javascript: bookmarklets are skipped, they need MAIN-world injection to run.
      if (n.url && !n.url.startsWith('javascript:')) items.push({ id: `bm:${n.id}`, kind: 'bookmark', title: n.title || n.url, url: n.url });
      if (n.children) walk(n.children);
    }
  };
  walk(tree);

  for (const h of dedupeHistory(history, tabs)) items.push({ id: `h:${h.id}`, kind: 'history', title: h.title || h.url!, url: h.url });

  for (const d of downloads) {
    const note = d.state === 'in_progress' ? 'Downloading…' : d.state === 'interrupted' ? 'Failed' : !d.exists ? 'File missing' : fileSize(d.fileSize || d.totalBytes);
    items.push({ id: `dl:${d.id}`, kind: 'download', title: d.filename.split(/[\\/]/).pop() || d.url, url: d.finalUrl || d.url, downloadId: d.id, note });
  }

  for (const s of closed) {
    const note = ago(s.lastModified * 1000); // sessions report seconds
    if (s.tab) items.push({ id: `rc:${s.tab.sessionId}`, kind: 'closed', title: s.tab.title || s.tab.url || '', url: s.tab.url, sessionId: s.tab.sessionId, note });
    else if (s.window) items.push({ id: `rc:${s.window.sessionId}`, kind: 'closed', title: `Window (${s.window.tabs?.length ?? 0} tabs)`, sessionId: s.window.sessionId, note });
  }
  return { items, missing };
}

// shortcut: all-time run counts, so an old favourite outranks a new habit for a while; decay them if that bites.
const commandUses = async () => ((await browser.storage.local.get('commandUses')).commandUses ?? {}) as Record<string, number>;
async function countUse(id: string) {
  const uses = await commandUses();
  await browser.storage.local.set({ commandUses: { ...uses, [id]: (uses[id] ?? 0) + 1 } });
}

async function run(item: Item, ctx: Browser.tabs.Tab, newTab: boolean): Promise<RunResult | void> {
  switch (item.kind) {
    case 'tab':
      await browser.tabs.update(item.tabId!, { active: true });
      return void (await browser.windows.update(item.windowId!, { focused: true }));
    case 'command': {
      const ext = parseProvided(item.command!);
      if (ext) {
        await countUse(item.command!);
        return runProvided(ext.extId, ext.id, ctx.id);
      }
      const c = COMMANDS.find((c) => c.id === item.command);
      if (c) await countUse(c.id);
      if (!c?.deferred) {
        // Commands resolve to whatever their browser call returns; only page.ts's copy/QR ones hand anything back.
        const { copy, qr } = ((await c?.run(ctx)) ?? {}) as RunResult;
        return copy !== undefined || qr ? { copy, qr } : undefined;
      }
      // Give the palette time to unmount so it isn't printed or captured.
      setTimeout(() => c.run(ctx).catch((e) => notify(ctx, `${c.title} failed: ${e.message ?? e}`)), 250);
      return;
    }
    case 'download': {
      const [d] = await browser.downloads.search({ id: item.downloadId });
      return void (await (d?.state === 'complete' && d.exists ? browser.downloads.open(d.id) : browser.downloads.show(item.downloadId!)));
    }
    case 'closed':
      return void (await browser.sessions.restore(item.sessionId));
    default:
      await (newTab
        ? browser.tabs.create({ url: item.url, windowId: ctx.windowId, index: ctx.index + 1 })
        : browser.tabs.update(ctx.id!, { url: item.url }));
  }
}

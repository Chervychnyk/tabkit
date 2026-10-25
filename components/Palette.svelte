<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Chat from '@/components/Chat.svelte';
  import { parseQuery, search, segments } from '@/lib/query';
  import { DEFAULT_SETTINGS, themeStyle, type Settings } from '@/lib/settings';
  import { gridStep, parseTool, type Tool } from '@/lib/tools';
  import { toast } from '@/lib/toast';
  import type { Filter, Item, Message, TabAction } from '@/lib/types';

  let { onClose, tabId, standalone = false, settings = DEFAULT_SETTINGS, demo }: {
    onClose: () => void;
    tabId?: number;
    standalone?: boolean;
    settings?: Settings;
    /** sample rows for the settings preview: no loading, focus grabbing or actions */
    demo?: Item[];
  } = $props();

  const ALL_CHIPS: [Filter, string][] = [
    ['all', 'All'], ['tab', 'Tabs'], ['bookmark', 'Bookmarks'], ['history', 'History'], ['download', 'Downloads'], ['closed', 'Recently closed'], ['tools', 'Tools'],
  ];
  const CHIPS = $derived(ALL_CHIPS.filter(([f]) => f === 'all' || settings.chips.includes(f)));
  // Row button icons: 24×24 stroked paths, drawn in currentColor.
  const PIN = '<path d="M9 3h6l-1 7 4 4H6l4-4z"/><path d="M12 14v7"/>';
  const ICONS: Record<string, string> = {
    reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    muted: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/>',
    pin: PIN,
    pinned: PIN.replace('<path ', '<path fill="currentColor" '),
    duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/><path d="M14.5 11.5v6"/><path d="M11.5 14.5h6"/>',
    window: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    ungroup: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    copy: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  /** A tab row's buttons: [action, icon, label]; labels and icons follow the tab's state. Close stays last. */
  const tabButtons = (t: Item): [TabAction, string, string][] => [
    ['reload', 'reload', 'Reload tab'],
    t.muted ? ['mute', 'muted', 'Unmute tab'] : ['mute', 'speaker', 'Mute tab'],
    t.pinned ? ['pin', 'pinned', 'Unpin tab'] : ['pin', 'pin', 'Pin tab'],
    ['duplicate', 'duplicate', 'Duplicate tab'],
    ['new-window', 'window', 'Move to new window'],
    ...(t.tabGroup ? [['ungroup', 'ungroup', 'Remove from group'] as [TabAction, string, string]] : []),
    ['close', 'close', 'Close tab'],
  ];
  const TAB_TOASTS: Record<TabAction, (t: Item) => string> = {
    reload: () => 'Tab reloaded', mute: (t) => (t.muted ? 'Tab unmuted' : 'Tab muted'), pin: (t) => (t.pinned ? 'Tab unpinned' : 'Tab pinned'),
    duplicate: () => 'Tab duplicated', 'new-window': () => 'Moved to new window', ungroup: () => 'Removed from group', close: () => 'Tab closed',
  };
  // Chrome's tab group colours.
  const GROUP_COLORS: Record<string, string> = {
    grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038', pink: '#d01884', purple: '#a142f4', cyan: '#007b83', orange: '#fa903e',
  };
  const DOWNLOAD_ACTIONS: ['show' | 'copy' | 'erase', string, string][] = [['show', 'folder', 'Show in folder'], ['copy', 'copy', 'Copy source URL'], ['erase', 'close', 'Remove from list (keeps the file)']];
  const GLYPH: Partial<Record<Item['kind'], string>> = { command: '›', search: '⌕', prefix: ':', answer: '=' };
  const GROUPS: Partial<Record<Item['kind'], string>> = {
    tab: 'Tabs', command: 'Commands', bookmark: 'Bookmarks', history: 'History', download: 'Downloads', closed: 'Recently closed',
  };
  const SOURCES: Partial<Record<Filter, string>> = { bookmark: 'Bookmarks', history: 'History', download: 'Downloads', closed: 'Recently closed' };
  const HINTS: [string, string][] = [[':t', 'tabs'], [':b', 'bookmarks'], [':h', 'history'], [':ai', 'AI chat'], [':em', 'emoji'], [':wx', 'weather'], [':', 'all prefixes']];
  const EMOJI_COLS = 10;
  const SKIN_TONES: [string, string][] = [
    ['Default', '#ffc83d'], ['Light', '#f7dece'], ['Medium-Light', '#e0bb95'], ['Medium', '#bf8f68'], ['Medium-Dark', '#9b643d'], ['Dark', '#594539'],
  ];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOOL_KINDS = new Set<Item['kind']>(['emoji', 'todo', 'feed', 'weather']);
  const TOOL_HINTS: Record<Tool, string> = {
    emoji: '←↑↓→ move · ↵ copy · ⇧↵ copy :code: · Esc back to tools',
    todo: '↵ add / check off · {mod}⌫ delete · Esc close',
    rss: '↵ open · paste a feed URL to add it · {mod}⌫ on a feed removes it · Esc close',
    weather: 'type a city to add it · ↵ copy · {mod}⌫ remove · Esc close',
  };
  const isMac = navigator.userAgent.includes('Mac');

  let items = $state<Item[]>([]);
  let ctxTabId = $state<number>();
  let query = $state('');
  let chip = $state<Filter>('all');
  let sel = $state(0);
  let qr = $state<string>();
  let input: HTMLInputElement;
  let list = $state<HTMLUListElement>();
  let toolResults = $state<Item[]>([]);
  let toolRev = $state(0);
  let toolSeq = 0;
  let missing = $state<string[]>([]);
  let closing = $state(false);

  const tool = $derived(parseTool(query));
  const chatMode = $derived(/^:ai(\s|$)/.test(query));
  let chat = $state<Chat>();
  const results = $derived(tool ? toolResults : search(items, query, chip, settings.engines));
  // A filter prefix (:h, :b…) lights its chip; picking a chip drops the prefix so the chip wins.
  const active = $derived(parseQuery(query).filter ?? chip);
  const downloadsView = $derived(!tool && active === 'download');
  const emojiGrid = $derived(tool?.tool === 'emoji');
  const grouped = $derived(!tool && chip !== 'tools');
  // Emoji sections: index ranges of results sharing a group header (one headerless section while searching).
  const sections = $derived(emojiGrid ? results.flatMap((r, i) => (i === 0 || r.group !== results[i - 1]!.group ? [{ start: i, group: r.group }] : []))
    .map((x, k, a) => ({ ...x, items: results.slice(x.start, a[k + 1]?.start ?? results.length) })) : []);
  let emojiTone = $state(0);
  $effect(() => {
    if (emojiGrid && !demo) browser.storage.local.get('emojiTone').then((r) => (emojiTone = (r.emojiTone as number | undefined) ?? 0));
  });

  function setTone(t: number) {
    emojiTone = t;
    browser.storage.local.set({ emojiTone: t }).then(() => toolRev++);
    input.focus();
  }

  // Tools are answered by the background (storage, network); debounce typing and drop stale replies.
  $effect(() => {
    const t = tool;
    toolRev;
    if (!t) return;
    const n = ++toolSeq;
    const timer = setTimeout(async () => {
      const r = await send({ type: 'tool', tool: t.tool, text: t.text });
      if (n !== toolSeq) return;
      toolResults = Array.isArray(r) ? r : [];
      if (r?.error) toast(r.error);
    }, t.text ? 200 : 0);
    return () => clearTimeout(timer);
  });

  const send = (m: Message) => browser.runtime.sendMessage(m);

  async function load() {
    const r = await send({ type: 'load', tabId });
    items = r.items;
    ctxTabId = r.tabId;
    missing = r.missing ?? [];
  }

  onMount(() => {
    if (demo) return void (items = demo);
    input.focus();
    load();
  });

  function select(i: number) {
    sel = Math.max(0, Math.min(results.length - 1, i));
    tick().then(() => list?.querySelector(`#tc-${sel}`)?.scrollIntoView({ block: 'nearest' }));
  }

  /** Close with a short fade; skipped for reduced motion and the standalone window. */
  function close() {
    if (reducedMotion || standalone || closing) return onClose();
    closing = true;
    setTimeout(onClose, 110);
  }

  async function activate(item: Item | undefined, newTab: boolean) {
    if (!item) return;
    if (item.kind === 'prefix') {
      query = item.command!;
      sel = 0;
      input.focus();
      return;
    }
    if (demo) return;
    if (item.kind === 'answer') {
      await copy(item.copy ?? item.title, 'Copied');
      return close();
    }
    if (TOOL_KINDS.has(item.kind) && !item.url) {
      const r: { copy?: string; query?: string; error?: string } | undefined = await send({ type: 'tool-run', item, alt: !newTab });
      if (r?.error) return toast(r.error);
      if (r?.copy !== undefined) {
        await copy(r.copy, 'Copied');
        return close();
      }
      if (r?.query !== undefined) query = r.query;
      toolRev++;
      return input.focus();
    }
    if (item.command === 'color-picker') return pickColor();
    const r: { copy?: string; qr?: string; error?: string } | undefined = await send({ type: 'run', item, tabId: ctxTabId!, newTab });
    if (r?.error) return toast(r.error);
    if (r?.qr) return void (qr = r.qr);
    if (r?.copy !== undefined) await copy(r.copy, 'Copied');
    close();
  }

  async function copy(text: string, message: string) {
    const ok = await navigator.clipboard.writeText(text).then(() => true, () => false);
    if (!standalone) toast(ok ? message : 'Could not copy to clipboard');
  }

  function pickColor() {
    const EyeDropper = (window as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) return toast('Color picker is not supported in this browser');
    const picked = new EyeDropper().open(); // must start inside the keypress, before the palette closes
    onClose();
    picked.then(({ sRGBHex: hex }) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      copy(hex, `${hex} · rgb(${r}, ${g}, ${b}) copied`);
    }, () => {});
  }

  async function tabAction(action: TabAction, item: Item) {
    if (demo) return;
    const r: { error?: string } | undefined = await send({ type: 'tab-action', action, tabId: item.tabId! });
    if (r?.error) return toast(r.error);
    toast(TAB_TOASTS[action](item));
    if (item.tabId === ctxTabId && (action === 'close' || action === 'new-window')) return close();
    await load();
    select(sel);
  }

  async function downloadAction(action: 'show' | 'copy' | 'erase', item: Item) {
    if (demo) return;
    if (action === 'copy') return copy(item.url ?? '', 'URL copied');
    await send({ type: 'download-action', action, downloadId: item.downloadId! });
    if (action === 'erase') {
      await load();
      select(sel);
    }
  }

  function browseDownloads() {
    send({ type: 'run', item: { id: 'downloads-page', kind: 'url', title: '', url: 'chrome://downloads' }, tabId: ctxTabId!, newTab: true });
    close();
  }

  function pick(f: Filter) {
    const p = parseQuery(query);
    if (p.filter) query = p.text;
    chip = f;
    sel = 0;
  }

  function onkeydown(e: KeyboardEvent) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const cur = results[sel];
    // A focused button (chip, row action, code Copy) gets its own Enter.
    if (e.key === 'Enter' && (e.target as Element).closest('button')) return;
    if (e.key === 'Escape' && emojiGrid) {
      query = '';
      chip = 'tools';
      sel = 0;
    } else if (e.key === 'Escape') close();
    else if (chatMode) {
      if (!chat?.key(e, mod)) return;
    } else if (qr) return;
    else if (emojiGrid && e.key === 'ArrowRight') select(sel + 1);
    else if (emojiGrid && e.key === 'ArrowLeft') select(sel - 1);
    else if (emojiGrid && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))
      select(gridStep(sections.map((x) => x.start), results.length, EMOJI_COLS, sel, e.key === 'ArrowDown' ? 1 : -1));
    else if (e.key === 'ArrowDown') select(sel + 1);
    else if (e.key === 'ArrowUp') select(sel - 1);
    else if (e.key === 'Enter') activate(cur, !e.shiftKey);
    else if (e.key === 'Backspace' && mod && cur?.kind === 'tab') tabAction('close', cur);
    else if (e.key === 'Backspace' && mod && cur && TOOL_KINDS.has(cur.kind)) send({ type: 'tool-delete', item: cur }).then(() => toolRev++);
    else if (e.key === 'Tab' && !tool) {
      const i = CHIPS.findIndex(([f]) => f === active);
      pick(CHIPS[(i + (e.shiftKey ? CHIPS.length - 1 : 1)) % CHIPS.length]![0]);
    } else return;
    e.preventDefault();
  }

  function host(url = '') {
    try { return new URL(url).host; } catch { return url; }
  }
  const favicon = (url: string) => `chrome-extension://${browser.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
</script>

{#snippet svg(icon: string)}
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[icon]}</svg>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="backdrop layout-{settings.layout}" style={themeStyle(settings.theme, settings.accent)} class:standalone class:closing onclick={(e) => e.target === e.currentTarget && close()} {onkeydown}>
  <div class="panel" role="dialog" aria-label="Command palette">
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => { sel = 0; qr = undefined; }}
      placeholder="Search tabs, bookmarks, history… or type : for prefixes"
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      aria-expanded="true"
      aria-controls="tc-results"
      aria-activedescendant={results[sel] ? `tc-${sel}` : undefined}
    />
    {#if chatMode}
      <Chat
        bind:this={chat}
        prompt={query.replace(/^:ai\s?/, '')}
        tabId={ctxTabId}
        clearPrompt={() => (query = ':ai ')}
        {copy}
        openSettings={() => { send({ type: 'open-settings' }); close(); }}
      />
    {:else if !tool}
      <div class="chips">
        {#each CHIPS as [f, label]}
          <button class:on={active === f} onclick={() => { pick(f); input.focus(); }}>{label}</button>
        {/each}
      </div>
      {#if !query && chip === 'all'}
        <div class="hints">
          {#each HINTS as [p, label]}
            <button onclick={() => { query = p === ':' ? ':' : `${p} `; sel = 0; input.focus(); }}><kbd>{p}</kbd> {label}</button>
          {/each}
        </div>
      {/if}
    {/if}
    {#if chatMode}
      <!-- chat renders its own body -->
    {:else if qr}
      <div class="qr">{@html qr}<p>Scan to open this page · Esc to close</p></div>
    {:else if emojiGrid}
      {@const cur = results[sel]}
      <div class="emoji-preview">
        <span class="emoji-big">{cur?.icon ?? ''}</span>
        <span class="emoji-name">{cur?.title ?? ''}</span>
        {#if cur?.data}<button class="emoji-code" title="Copy :code: (⇧↵)" onclick={() => activate(cur, false)}>:{cur.data}:</button>{/if}
        <span class="tones" role="group" aria-label="Skin tone">
          {#each SKIN_TONES as [label, color], t}
            <button title={label} aria-label={label} aria-pressed={t === emojiTone} class:on={t === emojiTone} style:background={color} onclick={() => setTone(t)}></button>
          {/each}
        </span>
      </div>
      <ul id="tc-results" role="listbox" class="emoji-grid" bind:this={list} style:--cols={EMOJI_COLS}>
        {#each sections as sec (sec.start + (sec.group ?? ''))}
          {#if sec.group}<li class="group" role="presentation">{sec.group} <span>{sec.items.length}</span></li>{/if}
          {#each sec.items as item, j (item.id)}
            {@const i = sec.start + j}
            <li id="tc-{i}" role="option" aria-selected={i === sel} aria-label={item.title} title={item.title} class:sel={i === sel}
              onmousemove={() => (sel = i)} onclick={(e) => activate(item, !e.shiftKey)}>{item.icon}</li>
          {/each}
        {:else}
          <li class="empty">{tool?.text ? 'No emoji found' : 'Loading…'}</li>
        {/each}
      </ul>
    {:else}
    <ul id="tc-results" role="listbox" bind:this={list}>
      {#if SOURCES[active] && missing.includes(active)}
        <li class="empty notice">
          {SOURCES[active]} access is off.
          <button onclick={() => { send({ type: 'open-settings' }); close(); }}>Turn it on in Settings</button>
        </li>
      {/if}
      {#each results as item, i (item.id)}
        {#if grouped && GROUPS[item.kind] && item.kind !== results[i - 1]?.kind}
          <li class="group" role="presentation">{GROUPS[item.kind]}</li>
        {/if}
        <li
          id="tc-{i}"
          role="option"
          aria-selected={i === sel}
          class:sel={i === sel}
          onmousemove={() => (sel = i)}
          onclick={(e) => activate(item, !e.shiftKey)}
        >
          {#if item.icon}
            <span class="glyph icon">{item.icon}</span>
          {:else if item.image}
            <!-- A strict page CSP can block data: images; fall back to the colour swatch. -->
            <img src={item.image} alt="" width="16" height="16" onerror={() => (item.image = undefined)} />
          {:else if item.color}
            <span class="swatch" style:background={item.color}></span>
          {:else if item.url && !GLYPH[item.kind]}
            <img src={favicon(item.url)} alt="" width="16" height="16" />
          {:else}
            <span class="glyph">{GLYPH[item.kind] ?? '•'}</span>
          {/if}
          <span class="text">
            <span class="title">{#each segments(item.title, item.hl) as s}{#if s.m}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}</span>
            {#if item.note}<span class="url">{item.note}</span>
            {:else if item.url && item.kind !== 'search' && item.kind !== 'url'}<span class="url">{host(item.url)}</span>{/if}
          </span>
          {#if item.kind === 'tab'}
            {#if item.tabGroup?.color}<span class="badge group" style:--c={GROUP_COLORS[item.tabGroup.color]}>{item.tabGroup.title || item.tabGroup.color}</span>{/if}
            {#if item.pinned}<span class="badge">pinned</span>{/if}
            {#if item.audible || item.muted}<span class="badge">{item.muted ? 'muted' : 'playing'}</span>{/if}
            <span class="actions">
              {#each tabButtons(item) as [action, icon, label]}
                <button class:close={action === 'close'} title={label} aria-label={label} onclick={(e) => { e.stopPropagation(); tabAction(action, item); }}>{@render svg(icon)}</button>
              {/each}
            </span>
          {/if}
          {#if item.kind === 'download'}
            <span class="actions">
              {#each DOWNLOAD_ACTIONS as [action, icon, label]}
                <button class:close={action === 'erase'} title={label} aria-label={label} onclick={(e) => { e.stopPropagation(); downloadAction(action, item); }}>{@render svg(icon)}</button>
              {/each}
            </span>
          {/if}
          {#if item.kind === 'answer'}<span class="kind">↵ copy</span>{/if}
        </li>
      {:else}
        {#if !(SOURCES[active] && missing.includes(active))}<li class="empty">{items.length ? 'No results' : 'Loading…'}</li>{/if}
      {/each}
    </ul>
    {/if}
    <footer>{#if chatMode}↵ send · ↵ on empty copies the last answer · Tab switch model · {isMac ? '⌘' : 'Ctrl'}⌫ clear chat · @page adds this page{:else if tool}{TOOL_HINTS[tool.tool].replaceAll('{mod}', isMac ? '⌘' : 'Ctrl')}{:else if downloadsView}↑↓ navigate · ↵ open file · Tab filter · Esc close · <button class="link" onclick={browseDownloads}>Browse downloads</button>{:else}↑↓ navigate · ↵ open · ⇧↵ in current tab · {isMac ? '⌘' : 'Ctrl'}⌫ close tab · Tab filter · Esc close{/if}</footer>
  </div>
</div>

<style>
  /* px, not rem: rem would scale with the host page's font size. cq units = viewport units unless inside the
     settings preview frame (a size container). */
  .backdrop {
    --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --accent: #4f46e5; --on-accent: #fff;
    --hl: color-mix(in srgb, var(--accent) 16%, var(--bg));
    position: fixed; inset: 0; z-index: 2147483647; color-scheme: light dark;
    background: rgba(0, 0, 0, 0.25);
    font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg);
  }
  @media (prefers-color-scheme: dark) {
    .backdrop { --bg: #1c1c1e; --fg: #f2f2f7; --muted: #98989f; --line: #2c2c2e; --accent: #8b87ff; --on-accent: #1c1c1e; }
  }
  .panel {
    position: absolute; top: 12cqh; left: 50%; transform: translateX(-50%);
    width: min(680px, calc(100cqw - 32px)); max-height: 70cqh;
    display: flex; flex-direction: column;
    background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); overflow: hidden;
  }
  .layout-spotlight .panel { top: 20cqh; width: min(760px, calc(100cqw - 32px)); border-radius: 16px; }
  .layout-spotlight input { font-size: 22px; padding: 20px 22px; }
  .layout-notch { background: transparent; }
  .layout-notch .panel { top: 0; width: min(620px, calc(100cqw - 32px)); max-height: 60cqh; border-top: 0; border-radius: 0 0 16px 16px; }
  .layout-notch input { font-size: 15px; padding: 12px 16px; }
  .standalone { background: var(--bg); }
  /* Open/close: fade the backdrop, lift the panel. */
  .backdrop { animation: tc-fade 0.12s ease-out; }
  .panel { animation: tc-pop 0.14s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
  .closing { animation: tc-fade 0.11s ease-in reverse forwards; }
  .closing .panel { animation: tc-pop 0.11s ease-in reverse forwards; }
  .standalone, .standalone .panel { animation: none; }
  @keyframes tc-fade { from { opacity: 0; } }
  @keyframes tc-pop { from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.98); } }
  @media (prefers-reduced-motion: reduce) { .backdrop, .panel { animation: none !important; } }
  .standalone .panel { inset: 0; top: 0; left: 0; transform: none; width: auto; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
  input {
    all: unset; flex: none; padding: 16px 18px; font-size: 17px; border-bottom: 1px solid var(--line);
  }
  input::placeholder { color: var(--muted); }
  .panel :global(.chips) { flex: none; display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .panel :global(.chips button) {
    all: unset; cursor: pointer; padding: 3px 10px; border-radius: 999px; font-size: 12px; color: var(--muted); white-space: nowrap;
  }
  .panel :global(.chips button:hover) { background: var(--hl); color: var(--fg); }
  .panel :global(.chips button.on) { background: var(--accent); color: var(--on-accent); }
  ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; }
  ul, .panel :global(.chips) { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  li {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; min-height: 22px;
  }
  li.sel { background: var(--hl); }
  li.group {
    font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--muted);
    padding: 10px 10px 4px; min-height: 0; cursor: default;
  }
  li.group:first-child { padding-top: 4px; }
  mark { background: none; color: var(--accent); font-weight: 600; }
  li.notice { flex-wrap: wrap; gap: 6px; }
  li.notice button { all: unset; cursor: pointer; color: var(--accent); }
  .hints { flex: none; display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 6px 14px; border-bottom: 1px solid var(--line); font-size: 12px; }
  .hints button { all: unset; cursor: pointer; color: var(--muted); }
  .hints button:hover, .hints button:focus-visible { color: var(--fg); }
  kbd { font: 11px ui-monospace, Menlo, monospace; color: var(--fg); background: var(--hl); padding: 1px 4px; border-radius: 4px; }
  /* max-content rows: auto rows get squeezed below the emoji height once the grid overflows the panel */
  .emoji-grid { display: grid; grid-template-columns: repeat(var(--cols), 1fr); grid-auto-rows: max-content; gap: 2px; align-content: start; }
  .emoji-grid li { justify-content: center; font-size: 22px; padding: 6px 0; min-height: 0; }
  .emoji-grid li.empty, .emoji-grid li.group { grid-column: 1 / -1; font-size: 14px; }
  .emoji-grid li.group { justify-content: flex-start; gap: 6px; font-size: 11px; padding: 10px 6px 4px; }
  .emoji-grid li.group span { font-weight: 400; letter-spacing: 0; }
  .emoji-preview { flex: none; display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); min-height: 36px; }
  .emoji-big { font-size: 30px; line-height: 36px; width: 36px; text-align: center; flex: none; }
  .emoji-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .emoji-code { all: unset; cursor: pointer; flex: none; font: 11px ui-monospace, Menlo, monospace; color: var(--muted); padding: 2px 6px; border-radius: 4px; background: var(--hl); }
  .emoji-code:hover, .emoji-code:focus-visible { color: var(--fg); }
  .tones { flex: none; display: flex; gap: 4px; }
  .tones button { all: unset; cursor: pointer; width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
  .tones button.on, .tones button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  li.empty { color: var(--muted); cursor: default; justify-content: center; }
  img, .glyph, .swatch { width: 16px; height: 16px; flex: none; }
  .swatch { border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4); }
  .glyph { text-align: center; color: var(--muted); line-height: 16px; }
  .icon { color: var(--fg); font-size: 15px; }
  .text { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .url { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; max-width: 40%; }
  .kind, .badge { font-size: 11px; color: var(--muted); flex: none; }
  .badge { border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .badge.group { border-color: var(--c); color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); }
  .actions { display: none; gap: 2px; flex: none; }
  li.sel .actions { display: flex; }
  .actions button {
    all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; color: var(--muted);
  }
  .actions button.close { margin-left: 6px; }
  .actions button:hover, .actions button:focus-visible { background: color-mix(in srgb, var(--accent) 30%, var(--bg)); color: var(--fg); }
  .qr { display: flex; flex-direction: column; align-items: center; padding: 24px; color: var(--muted); font-size: 12px; }
  .qr :global(svg) { width: 240px; height: 240px; border-radius: 8px; }
  footer .link { all: unset; cursor: pointer; color: var(--accent); }
  footer { flex: none; padding: 8px 14px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); }
</style>

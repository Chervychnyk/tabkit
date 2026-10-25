<script lang="ts">
  import { onMount } from 'svelte';
  import Palette from '@/components/Palette.svelte';
  import { getKeys } from '@/lib/ai';
  import {
    ACCENT_THEMES, chatTargets, DATA_SOURCES, hotkeyLabel, hotkeyOf, loadSettings, PROVIDERS, saveSettings, THEMES, themeStyle,
    type Layout, type Preset, type Settings,
  } from '@/lib/settings';
  import type { Filter, Item } from '@/lib/types';

  const isMac = navigator.userAgent.includes('Mac');
  const CHIPS: [Filter, string][] = [['tab', 'Tabs'], ['bookmark', 'Bookmarks'], ['history', 'History'], ['download', 'Downloads'], ['closed', 'Recently closed'], ['tools', 'Tools']];
  const LAYOUTS: [Layout, string, string][] = [
    ['palette', 'Palette', 'Centered panel'],
    ['spotlight', 'Spotlight', 'Wider, larger input, lower on screen'],
    ['notch', 'Notch', 'Compact, attached to the top edge'],
  ];

  // Sample rows for the live preview (no real tabs are read or touched).
  const DEMO: Item[] = [
    { id: 'd1', kind: 'tab', title: 'Pull requests · GitHub', url: 'https://github.com/pulls' },
    { id: 'd2', kind: 'tab', title: 'Inbox (3) · Gmail', url: 'https://mail.google.com/mail/u/0/', pinned: true },
    { id: 'd3', kind: 'tab', title: 'Design system – Figma', url: 'https://www.figma.com/files', audible: true },
    { id: 'd4', kind: 'bookmark', title: 'Q4 planning – Google Docs', url: 'https://docs.google.com/document' },
    { id: 'd5', kind: 'command', title: 'Close duplicate tabs', command: 'close-duplicates' },
    { id: 'd6', kind: 'history', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' },
    { id: 'd7', kind: 'command', title: 'Take a screenshot of the visible area', command: 'shot-visible' },
  ];

  let settings = $state<Settings>();
  let keys = $state<Record<string, string>>({});
  let themeFilter = $state<'all' | 'dark' | 'light'>('all');
  let recording = $state(false);
  let models = $state<Record<string, string[]>>({});
  let modelErrors = $state<Record<string, string>>({});
  let saved = $state(false);
  let granted = $state(new Set<string>());

  const refreshPermissions = async () => (granted = new Set((await browser.permissions.getAll()).permissions));
  onMount(() => {
    refreshPermissions();
    browser.permissions.onAdded.addListener(refreshPermissions);
    browser.permissions.onRemoved.addListener(refreshPermissions);
    return () => {
      browser.permissions.onAdded.removeListener(refreshPermissions);
      browser.permissions.onRemoved.removeListener(refreshPermissions);
    };
  });

  // request() must run inside the click, so no await before it.
  function toggleSource(permissions: (typeof DATA_SOURCES)[number]['permissions'], on: boolean) {
    const p = { permissions: [...permissions] };
    (on ? browser.permissions.request(p) : browser.permissions.remove(p)).finally(refreshPermissions);
  }

  onMount(async () => {
    [settings, keys] = await Promise.all([loadSettings(), getKeys()]);
  });

  // Autosave: settings sync through the browser account; API keys stay on this device.
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!settings) return;
    const s = $state.snapshot(settings) as Settings;
    const k = $state.snapshot(keys);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await Promise.all([saveSettings(s), browser.storage.local.set({ aiKeys: k })]);
      saved = true;
      setTimeout(() => (saved = false), 1200);
    }, 300);
  });

  const themes = $derived(Object.entries(THEMES).filter(([, t]) => themeFilter === 'all' || t.dark === (themeFilter === 'dark')));
  const targets = $derived(settings ? chatTargets(settings, keys) : []);

  function provider(id: string) {
    return (settings!.ai.providers[id] ??= {});
  }

  function toggleChip(f: Filter, on: boolean) {
    settings!.chips = on ? [...settings!.chips, f] : settings!.chips.filter((c) => c !== f);
  }

  function record(e: KeyboardEvent) {
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Escape') return void (recording = false);
    const combo = hotkeyOf(e, isMac);
    if (!combo.includes('+')) return; // a bare key would fire while typing
    settings!.hotkey = combo;
    recording = false;
  }

  async function loadModels(id: string) {
    modelErrors[id] = '';
    const r = await browser.runtime.sendMessage({ type: 'ai-models', provider: id, baseUrl: settings!.ai.providers[id]?.baseUrl, key: keys[id] });
    if (Array.isArray(r)) {
      models[id] = r;
      if (!provider(id).model && r[0]) provider(id).model = r[0];
    } else modelErrors[id] = r?.error ?? 'Could not load models';
  }

  function addPreset() {
    const p: Preset = { id: crypto.randomUUID().slice(0, 8), name: 'New preset', provider: targets[0]?.provider.id ?? 'claude', system: '' };
    settings!.ai.presets.push(p);
  }
</script>

<main>
  <header>
    <h1>TabCmdr settings</h1>
    <span class="saved" class:show={saved} aria-live="polite">Saved</span>
  </header>

  {#if settings}
    <section>
      <h2>Data sources</h2>
      <p class="note">Turn on what the palette may search. Each one asks the browser for its permission; turning it off gives it back.</p>
      <div class="sources">
        {#each DATA_SOURCES as d (d.filter)}
          <label class="source">
            <input type="checkbox" checked={granted.has(d.permissions[0])} onchange={(e) => toggleSource(d.permissions, e.currentTarget.checked)} />
            <span><strong>{d.label}</strong><small>{d.note}</small></span>
          </label>
        {/each}
      </div>
    </section>

    <section class="appearance">
      <div class="preview-frame" aria-label="Live preview">
        <Palette demo={DEMO} {settings} onClose={() => {}} />
      </div>
      <div>
      <h2>Appearance</h2>
      <div class="row">
        <span class="label">Theme · <strong>{settings.theme === 'system' ? 'System' : THEMES[settings.theme]?.name}</strong></span>
        <div class="seg" role="radiogroup" aria-label="Theme filter">
          {#each [['all', 'All'], ['dark', 'Dark'], ['light', 'Light']] as [v, l]}
            <button role="radio" aria-checked={themeFilter === v} class:on={themeFilter === v} onclick={() => (themeFilter = v as typeof themeFilter)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="themes">
        <button class="theme" class:on={settings.theme === 'system'} onclick={() => (settings!.theme = 'system')}>
          <span class="swatch split"></span>System (follows light/dark)
        </button>
        {#each themes as [key, t] (key)}
          <button class="theme" class:on={settings.theme === key} style={themeStyle(key)} onclick={() => (settings!.theme = key)}>
            <span class="swatch"></span>{t.name}
          </button>
        {/each}
      </div>
      <div class="row">
        <label class="label" for="accent">Accent colour</label>
        <input id="accent" type="color" disabled={!ACCENT_THEMES.includes(settings.theme)}
          value={settings.accent ?? '#4f46e5'} oninput={(e) => (settings!.accent = e.currentTarget.value)} />
        {#if settings.accent}<button onclick={() => (settings!.accent = undefined)}>Reset</button>{/if}
        <small class="grow">For System, Light and Dark; named themes keep their own colours. Browsers don't let extensions
          read their colour theme, so pick your browser's accent here to match it. System follows the browser's light/dark mode.</small>
      </div>
      <div class="row">
        <span class="label">Layout</span>
        <div class="layouts">
          {#each LAYOUTS as [v, name, desc]}
            <label class="card" class:on={settings.layout === v}>
              <input type="radio" name="layout" value={v} bind:group={settings.layout} />
              <span class="preview {v}"><span></span></span>
              <strong>{name}</strong><small>{desc}</small>
            </label>
          {/each}
        </div>
      </div>
    </div>
    </section>

    <section>
      <h2>Palette</h2>
      <div class="row">
        <span class="label">Shortcut on web pages</span>
        <button class="key" class:recording onclick={() => (recording = true)} onkeydown={(e) => recording && record(e)} onblur={() => (recording = false)}>
          {recording ? 'Press a combination…' : hotkeyLabel(settings.hotkey, isMac)}
        </button>
        <small>The toolbar shortcut ({isMac ? '⌘⇧K' : 'Ctrl+Shift+K'}) also works on browser pages;
          <button class="link" onclick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>change it here</button>.</small>
      </div>
      <div class="row">
        <span class="label">Filter tabs</span>
        <div class="checks">
          {#each CHIPS as [f, l]}
            <label><input type="checkbox" checked={settings.chips.includes(f)} onchange={(e) => toggleChip(f, e.currentTarget.checked)} /> {l}</label>
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="label">Weather</span>
        <div class="seg" role="radiogroup" aria-label="Temperature unit">
          <button role="radio" aria-checked={!settings.fahrenheit} class:on={!settings.fahrenheit} onclick={() => (settings!.fahrenheit = false)}>°C</button>
          <button role="radio" aria-checked={settings.fahrenheit} class:on={settings.fahrenheit} onclick={() => (settings!.fahrenheit = true)}>°F</button>
        </div>
      </div>
      <div class="row top">
        <label class="label" for="domains">Shortcut disabled on</label>
        <div class="grow">
          <textarea id="domains" rows="3" placeholder="docs.google.com"
            value={settings.disabledDomains.join('\n')}
            onchange={(e) => (settings!.disabledDomains = e.currentTarget.value.split(/\s+/).map((d) => d.trim().toLowerCase()).filter(Boolean))}></textarea>
          <small>One domain per line; subdomains are included. Use this where a site needs its own {hotkeyLabel(settings.hotkey, isMac)}.</small>
        </div>
      </div>
    </section>

    <section>
      <h2>AI chat</h2>
      <p class="note">Type <code>:ai</code> in the palette. Keys are stored only on this device and sent only to their provider.</p>
      <div class="row">
        <label class="label" for="default">Default</label>
        <select id="default" bind:value={settings.ai.default}>
          <option value="">First available</option>
          {#each targets as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </div>
      <div class="providers">
        {#each PROVIDERS as p (p.id)}
          {@const cfg = settings.ai.providers[p.id] ?? {}}
          <div class="provider">
            <strong>{p.name}</strong>
            {#if p.keyless}
              <label class="inline"><input type="checkbox" checked={!!cfg.enabled} onchange={(e) => (provider(p.id).enabled = e.currentTarget.checked)} /> Enabled</label>
            {:else}
              <input type="password" placeholder="API key" autocomplete="off" aria-label="{p.name} API key" bind:value={keys[p.id]} />
            {/if}
            <input list="models-{p.id}" placeholder={p.model || 'model'} aria-label="{p.name} model"
              value={cfg.model ?? ''} oninput={(e) => (provider(p.id).model = e.currentTarget.value)} />
            <datalist id="models-{p.id}">{#each models[p.id] ?? [] as m}<option value={m}></option>{/each}</datalist>
            <button onclick={() => loadModels(p.id)} disabled={!p.keyless && !keys[p.id]}>Load models</button>
            <input class="url" placeholder={p.baseUrl} aria-label="{p.name} base URL"
              value={cfg.baseUrl ?? ''} oninput={(e) => (provider(p.id).baseUrl = e.currentTarget.value.replace(/\/+$/, ''))} />
            {#if modelErrors[p.id]}<small class="error">{modelErrors[p.id]}</small>{/if}
          </div>
        {/each}
      </div>

      <h3>Presets</h3>
      <p class="note">A preset is a provider plus a system prompt; each keeps its own chat history.</p>
      {#each settings.ai.presets as pr, i (pr.id)}
        <div class="preset">
          <input aria-label="Preset name" bind:value={pr.name} />
          <select aria-label="Provider" bind:value={pr.provider}>
            {#each PROVIDERS as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <input aria-label="Model (optional)" placeholder="provider's model" bind:value={pr.model} />
          <button onclick={() => settings!.ai.presets.splice(i, 1)}>Remove</button>
          <textarea aria-label="System prompt" rows="2" placeholder="System prompt, e.g. Translate everything into English." bind:value={pr.system}></textarea>
        </div>
      {/each}
      <button onclick={addPreset}>Add preset</button>
    </section>
  {/if}
</main>

<style>
  :global(:root) {
    --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --accent: #4f46e5; --on-accent: #fff; color-scheme: light dark;
    --hl: color-mix(in srgb, var(--accent) 16%, var(--bg));
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) { --bg: #1c1c1e; --fg: #f2f2f7; --muted: #98989f; --line: #2c2c2e; --accent: #8b87ff; --on-accent: #1c1c1e; }
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display: flex; align-items: baseline; gap: 12px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  h3 { font-size: 14px; margin: 20px 0 4px; }
  .appearance { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
  .preview-frame {
    /* A size container: the palette's cq units resolve against this frame instead of the window. */
    container-type: size; position: sticky; top: 16px; height: 520px; overflow: hidden; border-radius: 12px;
    border: 1px solid var(--line); transform: translateZ(0); /* makes the palette's position:fixed relative to the frame */
    background: repeating-linear-gradient(0deg, transparent 0 22px, color-mix(in srgb, var(--fg) 6%, transparent) 22px 24px), var(--bg);
  }
  @media (max-width: 1000px) {
    .appearance { grid-template-columns: 1fr; }
    .preview-frame { position: relative; top: 0; }
  }
  section { border-top: 1px solid var(--line); padding: 20px 0; }
  .saved { color: var(--muted); font-size: 12px; opacity: 0; transition: opacity 0.2s; }
  .saved.show { opacity: 1; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 12px 0; }
  .row.top { align-items: flex-start; }
  .label { width: 170px; color: var(--muted); }
  .grow { flex: 1; min-width: 240px; }
  small { color: var(--muted); display: block; }
  .note { color: var(--muted); margin: 0 0 8px; }
  code { font: 12px ui-monospace, monospace; background: var(--hl); padding: 1px 4px; border-radius: 4px; }
  input, select, textarea, button { font: inherit; color: inherit; }
  input:not([type='checkbox']):not([type='radio']), select, textarea {
    background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; min-width: 0;
  }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; }
  button { background: var(--hl); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  :is(button, input, select, textarea, label):focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.link { all: unset; color: var(--accent); cursor: pointer; text-decoration: underline; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: none; }
  .seg button.on { background: var(--accent); color: var(--on-accent); }
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .theme { display: flex; align-items: center; gap: 8px; text-align: left; background: var(--bg); color: var(--fg); border: 2px solid var(--line); }
  .theme.on { border-color: var(--accent); }
  .swatch { width: 18px; height: 18px; border-radius: 50%; flex: none; background: linear-gradient(135deg, var(--accent) 50%, color-mix(in srgb, var(--accent) 16%, var(--bg)) 50%); box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4); }
  .swatch.split { background: linear-gradient(135deg, #ffffff 50%, #1c1c1e 50%); }
  .layouts { display: flex; flex-wrap: wrap; gap: 8px; }
  .card { display: flex; flex-direction: column; gap: 2px; width: 180px; padding: 10px; border: 2px solid var(--line); border-radius: 8px; cursor: pointer; }
  .card.on { border-color: var(--accent); }
  .card input { position: absolute; opacity: 0; }
  .card:has(input:focus-visible) { outline: 2px solid var(--accent); }
  .preview { position: relative; height: 54px; background: var(--hl); border-radius: 4px; margin-bottom: 6px; }
  .preview span { position: absolute; background: var(--bg); border: 1px solid var(--line); left: 50%; transform: translateX(-50%); }
  .preview.palette span { top: 10px; width: 60%; height: 30px; border-radius: 4px; }
  .preview.spotlight span { top: 16px; width: 76%; height: 22px; border-radius: 6px; }
  .preview.notch span { top: 0; width: 48%; height: 24px; border-radius: 0 0 6px 6px; border-top: 0; }
  .sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
  .source { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
  .source:has(input:checked) { border-color: var(--accent); }
  .source strong { display: block; }
  .checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .key { min-width: 90px; font-variant-numeric: tabular-nums; }
  .key.recording { border-color: var(--accent); }
  .providers { display: flex; flex-direction: column; gap: 8px; }
  .provider { display: grid; grid-template-columns: 110px minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 6px 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .provider .url { grid-column: 2 / -1; font-size: 12px; }
  .provider .error { grid-column: 2 / -1; color: #e5484d; }
  .inline { display: flex; gap: 6px; align-items: center; }
  .preset { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 6px 8px; margin: 8px 0; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .preset textarea { grid-column: 1 / -1; }
  @media (max-width: 600px) {
    .label { width: 100%; }
    .provider { grid-template-columns: 1fr 1fr; }
    .provider strong { grid-column: 1 / -1; }
    .provider .url, .provider .error { grid-column: 1 / -1; }
    .preset { grid-template-columns: 1fr 1fr; }
  }
</style>

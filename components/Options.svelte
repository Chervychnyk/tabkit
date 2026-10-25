<script lang="ts">
  import { onMount } from 'svelte';
  import Palette from '@/components/Palette.svelte';
  import { getKeys } from '@/lib/ai';
  import {
    ACCENT_THEMES, chatTargets, DATA_SOURCES, hotkeyLabel, hotkeyOf, loadSettings, PROVIDERS, saveSettings, THEMES, themeStyle,
    type Layout, type Preset, type Settings,
  } from '@/lib/settings';
  import { send } from '@/lib/messages';
  import { ENGINES } from '@/lib/query';
  import type { Filter, Item } from '@/lib/types';

  const isMac = navigator.userAgent.includes('Mac');
  const CHIPS: [Filter, string][] = [['tab', 'Tabs'], ['bookmark', 'Bookmarks'], ['history', 'History'], ['download', 'Downloads'], ['closed', 'Recently closed'], ['tools', 'Tools']];
  const LAYOUTS: [Layout, string, string][] = [
    ['palette', 'Palette', 'Centered panel'],
    ['spotlight', 'Spotlight', 'Wider, larger input, lower on screen'],
    ['notch', 'Notch', 'Compact, attached to the top edge'],
  ];
  // One view per area, picked by the URL hash so a reload (or the install page link) lands on it.
  const VIEWS = [
    ['general', 'General', 'How the palette opens and what it offers.'],
    ['appearance', 'Appearance', 'Theme, accent and layout, previewed live.'],
    ['sources', 'Data sources', 'What the palette may search. Each switch asks the browser for its permission; turning it off gives it back.'],
    ['ai', 'AI chat', 'Type :ai in the palette. Keys stay on this device and go only to their provider.'],
  ] as const;
  type View = (typeof VIEWS)[number][0];
  const viewOf = (h: string): View => (VIEWS.find(([v]) => v === h.slice(1))?.[0] ?? 'general');

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
  let view = $state<View>(viewOf(location.hash));
  let themeFilter = $state<'all' | 'dark' | 'light'>('all');
  let recording = $state(false);
  let models = $state<Record<string, string[]>>({});
  let modelErrors = $state<Record<string, string>>({});
  let saved = $state(false);
  let granted = $state(new Set<string>());

  const refreshPermissions = async () => (granted = new Set((await browser.permissions.getAll()).permissions));
  onMount(() => {
    refreshPermissions();
    const onHash = () => (view = viewOf(location.hash));
    browser.permissions.onAdded.addListener(refreshPermissions);
    browser.permissions.onRemoved.addListener(refreshPermissions);
    addEventListener('hashchange', onHash);
    return () => {
      browser.permissions.onAdded.removeListener(refreshPermissions);
      browser.permissions.onRemoved.removeListener(refreshPermissions);
      removeEventListener('hashchange', onHash);
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
  const sources = DATA_SOURCES.filter((d) => d.filter !== 'groups' || !/\bEdg\//.test(navigator.userAgent));
  const current = $derived(VIEWS.find(([v]) => v === view)!);

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
    try {
      const r = await send({ type: 'ai-models', provider: id, baseUrl: settings!.ai.providers[id]?.baseUrl, key: keys[id] });
      models[id] = r;
      if (!provider(id).model && r[0]) provider(id).model = r[0];
    } catch (e) {
      modelErrors[id] = (e as Error).message || 'Could not load models';
    }
  }

  function addPreset() {
    const p: Preset = { id: crypto.randomUUID().slice(0, 8), name: 'New preset', provider: targets[0]?.provider.id ?? 'claude', system: '' };
    settings!.ai.presets.push(p);
  }
</script>

<div class="shell">
  <nav aria-label="Settings">
    <div class="brand">
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" /><path d="m7 8 4 4-4 4M13 16h4" /></svg>
      <span><strong>Tabkit</strong><small>Settings</small></span>
    </div>
    {#each VIEWS as [v, label]}
      <a href="#{v}" aria-current={view === v ? 'page' : undefined}>{label}</a>
    {/each}
  </nav>

  <main>
    <header>
      <div>
        <h1>{current[1]}</h1>
        <p class="lede">{current[2]}</p>
      </div>
      <span class="saved" class:show={saved} aria-live="polite">Saved</span>
    </header>

    {#if settings}
      {#if view === 'general'}
        <section>
          <div class="about"><h2>Shortcut</h2><p>Opens the palette on web pages. The toolbar shortcut ({isMac ? '⌘⇧K' : 'Ctrl+Shift+K'}) also works on browser pages.</p></div>
          <div class="panel">
            <div class="line">
              <button class="key" class:recording onclick={() => (recording = true)} onkeydown={(e) => recording && record(e)} onblur={() => (recording = false)}>
                {recording ? 'Press a combination…' : hotkeyLabel(settings.hotkey, isMac)}
              </button>
              <button class="text" onclick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Change the toolbar shortcut</button>
            </div>
          </div>
        </section>
        <section>
          <div class="about"><h2>Sites without the shortcut</h2><p>For sites that need {hotkeyLabel(settings.hotkey, isMac)} themselves. Subdomains are included; the toolbar icon still works.</p></div>
          <div class="panel">
            <label class="field" for="domains">Domains, one per line</label>
            <textarea id="domains" rows="3" placeholder="docs.google.com"
              value={settings.disabledDomains.join('\n')}
              onchange={(e) => (settings!.disabledDomains = e.currentTarget.value.split(/\s+/).map((d) => d.trim().toLowerCase()).filter(Boolean))}></textarea>
          </div>
        </section>
        <section>
          <div class="about"><h2>Filters</h2><p>The chips under the search box. All is always there; Tab cycles through them.</p></div>
          <div class="panel checks">
            {#each CHIPS as [f, l]}
              <label><input type="checkbox" checked={settings.chips.includes(f)} onchange={(e) => toggleChip(f, e.currentTarget.checked)} /> {l}</label>
            {/each}
          </div>
        </section>
        <section>
          <div class="about"><h2>Web search</h2><p>One row per engine after the results, in this order.</p></div>
          <div class="panel checks">
            {#each Object.keys(ENGINES) as name}
              <label><input type="checkbox" checked={settings.engines.includes(name)}
                onchange={(e) => (settings!.engines = Object.keys(ENGINES).filter((n) => (n === name ? e.currentTarget.checked : settings!.engines.includes(n))))} /> {name}</label>
            {/each}
          </div>
        </section>
        <section>
          <div class="about"><h2>Weather</h2><p>Temperatures in <code>:wx</code>.</p></div>
          <div class="panel">
            <div class="seg" role="radiogroup" aria-label="Temperature unit">
              <button role="radio" aria-checked={!settings.fahrenheit} class:on={!settings.fahrenheit} onclick={() => (settings!.fahrenheit = false)}>°C</button>
              <button role="radio" aria-checked={settings.fahrenheit} class:on={settings.fahrenheit} onclick={() => (settings!.fahrenheit = true)}>°F</button>
            </div>
          </div>
        </section>
      {:else if view === 'appearance'}
        <div class="appearance">
          <div>
            <section class="stack">
              <div class="about head">
                <h2>Theme <span class="value">{settings.theme === 'system' ? 'System' : THEMES[settings.theme]?.name}</span></h2>
                <div class="seg" role="radiogroup" aria-label="Show themes">
                  {#each [['all', 'All'], ['dark', 'Dark'], ['light', 'Light']] as [v, l]}
                    <button role="radio" aria-checked={themeFilter === v} class:on={themeFilter === v} onclick={() => (themeFilter = v as typeof themeFilter)}>{l}</button>
                  {/each}
                </div>
              </div>
              <div class="themes">
                <button class="theme" class:on={settings.theme === 'system'} aria-pressed={settings.theme === 'system'} onclick={() => (settings!.theme = 'system')}>
                  <span class="swatch split"></span>System
                </button>
                {#each themes as [key, t] (key)}
                  <button class="theme" class:on={settings.theme === key} aria-pressed={settings.theme === key} style={themeStyle(key)} onclick={() => (settings!.theme = key)}>
                    <span class="swatch"></span>{t.name}
                  </button>
                {/each}
              </div>
            </section>
            <section class="stack">
              <div class="about"><h2>Accent colour</h2><p>For System, Light and Dark; named themes keep their own. Browsers don't tell extensions their colour theme, so match it here.</p></div>
              <div class="line">
                <input id="accent" type="color" aria-label="Accent colour" disabled={!ACCENT_THEMES.includes(settings.theme)}
                  value={settings.accent ?? '#4f46e5'} oninput={(e) => (settings!.accent = e.currentTarget.value)} />
                <span class="num">{settings.accent ?? 'Default'}</span>
                {#if settings.accent}<button class="text" onclick={() => (settings!.accent = undefined)}>Reset</button>{/if}
              </div>
            </section>
            <section class="stack">
              <div class="about"><h2>Layout</h2></div>
              <div class="layouts">
                {#each LAYOUTS as [v, name, desc]}
                  <label class="card" class:on={settings.layout === v}>
                    <input type="radio" name="layout" value={v} bind:group={settings.layout} />
                    <span class="preview {v}"><span></span></span>
                    <strong>{name}</strong><small>{desc}</small>
                  </label>
                {/each}
              </div>
            </section>
          </div>
          <div class="preview-frame" aria-label="Live preview">
            <Palette demo={DEMO} {settings} onClose={() => {}} />
          </div>
        </div>
      {:else if view === 'sources'}
        <div class="panel list">
          {#each sources as d (d.filter)}
            <label class="switch-row">
              <span><strong>{d.label}</strong><small>{d.note}</small></span>
              <input type="checkbox" role="switch" checked={granted.has(d.permissions[0])} onchange={(e) => toggleSource(d.permissions, e.currentTarget.checked)} />
            </label>
          {/each}
        </div>
      {:else}
        <section>
          <div class="about"><h2>Default</h2><p>What <code>:ai</code> opens with. Tab switches between the ones set up below.</p></div>
          <div class="panel">
            <select aria-label="Default provider" bind:value={settings.ai.default}>
              <option value="">First available</option>
              {#each targets as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </select>
          </div>
        </section>
        <section>
          <div class="about"><h2>Providers</h2><p>{targets.length ? `${targets.filter((t) => !t.id.startsWith('preset:')).length} ready.` : 'None set up yet.'} Add a key, or turn on Ollama for local models.</p></div>
          <div class="panel list">
            {#each PROVIDERS as p (p.id)}
              {@const cfg = settings.ai.providers[p.id] ?? {}}
              {@const ready = p.keyless ? !!cfg.enabled : !!keys[p.id]}
              <details class="provider">
                <summary>
                  <strong>{p.name}</strong>
                  <span class="status" class:ready>{ready ? (p.keyless ? 'On' : 'Key saved') : p.keyless ? 'Off' : 'No key'}</span>
                  <span class="model">{cfg.model || p.model || '—'}</span>
                </summary>
                <div class="fields">
                  {#if p.keyless}
                    <label class="inline"><input type="checkbox" role="switch" checked={!!cfg.enabled} onchange={(e) => (provider(p.id).enabled = e.currentTarget.checked)} /> Use {p.name}</label>
                  {:else}
                    <label class="field">API key<input type="password" autocomplete="off" bind:value={keys[p.id]} /></label>
                  {/if}
                  <label class="field">Model
                    <span class="joined">
                      <input list="models-{p.id}" placeholder={p.model || 'model'} value={cfg.model ?? ''} oninput={(e) => (provider(p.id).model = e.currentTarget.value)} />
                      <button onclick={() => loadModels(p.id)} disabled={!p.keyless && !keys[p.id]}>Load models</button>
                    </span>
                  </label>
                  <datalist id="models-{p.id}">{#each models[p.id] ?? [] as m}<option value={m}></option>{/each}</datalist>
                  <label class="field">Base URL<input placeholder={p.baseUrl}
                    value={cfg.baseUrl ?? ''} oninput={(e) => (provider(p.id).baseUrl = e.currentTarget.value.replace(/\/+$/, ''))} /></label>
                  {#if modelErrors[p.id]}<small class="error">{modelErrors[p.id]}</small>{/if}
                </div>
              </details>
            {/each}
          </div>
        </section>
        <section>
          <div class="about"><h2>Presets</h2><p>A provider plus a system prompt; each keeps its own chat history.</p></div>
          <div class="panel">
            {#each settings.ai.presets as pr, i (pr.id)}
              <div class="preset">
                <input aria-label="Preset name" bind:value={pr.name} />
                <select aria-label="Provider" bind:value={pr.provider}>
                  {#each PROVIDERS as p}<option value={p.id}>{p.name}</option>{/each}
                </select>
                <input aria-label="Model (optional)" placeholder="provider's model" bind:value={pr.model} />
                <button class="text danger" onclick={() => settings!.ai.presets.splice(i, 1)}>Remove</button>
                <textarea aria-label="System prompt" rows="2" placeholder="System prompt, e.g. Translate everything into English." bind:value={pr.system}></textarea>
              </div>
            {:else}
              <p class="empty">No presets yet.</p>
            {/each}
            <button onclick={addPreset}>Add preset</button>
          </div>
        </section>
      {/if}
    {/if}
  </main>
</div>

<style>
  /* Neutral chrome; the palette's accent only shows in the live preview and the theme swatches. */
  :global(:root) {
    --ground: #ffffff; --raised: #f6f6f7; --active: #ececee; --border: #e8e8e8; --control: #d1d5db;
    --text: #111111; --muted: #5f6368; --primary: #1d1f20; --on-primary: #ffffff; --negative: #c4242a; --positive: #247b50;
    color-scheme: light dark;
    /* Palette.svelte inside the preview reads these. */
    --bg: var(--ground); --fg: var(--text); --line: var(--border); --accent: #4f46e5; --on-accent: #fff;
    --hl: color-mix(in srgb, var(--accent) 16%, var(--bg));
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --ground: #111111; --raised: #1b1b1c; --active: #262628; --border: #262628; --control: #444444;
      --text: #f2f2f2; --muted: #b4b4b4; --primary: #ffffff; --on-primary: #111111; --negative: #e5566f; --positive: #3fc07a;
      --accent: #8b87ff; --on-accent: #1c1c1e;
    }
  }
  :global(body) { margin: 0; background: var(--ground); color: var(--text); font: 14px/20px system-ui, -apple-system, 'Segoe UI', sans-serif; }

  .shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
  nav { position: sticky; top: 0; align-self: start; display: flex; flex-direction: column; gap: 2px; padding: 20px 12px; height: 100vh; box-sizing: border-box; border-right: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 10px; padding: 0 8px 20px; }
  .brand span { display: flex; flex-direction: column; }
  .brand strong { font-size: 15px; }
  .brand small { color: var(--muted); font-size: 12px; line-height: 16px; }
  .mark { width: 28px; height: 28px; flex: none; }
  .mark rect { fill: var(--primary); }
  .mark path { fill: none; stroke: var(--on-primary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  nav a { display: block; padding: 6px 10px; border-radius: 8px; color: var(--muted); text-decoration: none; }
  nav a:hover { color: var(--text); }
  nav a[aria-current='page'] { background: var(--active); color: var(--text); font-weight: 500; }

  main { padding: 36px 40px 64px; width: 100%; max-width: 1080px; margin: 0 auto; box-sizing: border-box; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 8px; }
  h1 { font-size: 24px; line-height: 32px; font-weight: 600; margin: 0; }
  .lede { color: var(--muted); margin: 4px 0 0; max-width: 640px; }
  .saved { color: var(--muted); font-size: 12px; opacity: 0; transition: opacity 0.2s; }
  .saved.show { opacity: 1; }

  /* A section: its title and what it does on the left, the controls in a panel on the right. */
  section { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px 40px; padding: 28px 0; border-top: 1px solid var(--border); }
  header + section, header + .panel, header + .appearance { margin-top: 24px; }
  header + .panel { max-width: 720px; }
  .about h2 { font-size: 16px; line-height: 24px; font-weight: 500; margin: 0; }
  .about p { color: var(--muted); margin: 4px 0 0; }
  .value { color: var(--muted); font-weight: 400; margin-left: 6px; }
  .panel { background: var(--raised); border-radius: 12px; padding: 16px; align-self: start; min-width: 0; }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-weight: 500; }
  .field + textarea { margin-top: 8px; }
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 16px; }
  .checks label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  small { color: var(--muted); display: block; }
  .empty { color: var(--muted); margin: 0 0 12px; }
  code { font: 12px ui-monospace, monospace; background: var(--active); padding: 1px 4px; border-radius: 4px; }
  .num { font-variant-numeric: tabular-nums; color: var(--muted); }

  input, select, textarea, button { font: inherit; color: inherit; }
  input[type='checkbox'] { accent-color: var(--primary); width: 16px; height: 16px; margin: 0; }
  input:not([type='checkbox']):not([type='radio']):not([type='color']), select, textarea {
    background: var(--ground); border: 1px solid var(--control); border-radius: 8px; padding: 0 10px; height: 36px; min-width: 0; box-sizing: border-box; font-weight: 400;
  }
  textarea { width: 100%; height: auto !important; padding: 8px 10px !important; resize: vertical; }
  button { background: var(--ground); border: 1px solid var(--control); border-radius: 8px; padding: 0 12px; height: 36px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--active); }
  button:disabled { color: var(--muted); cursor: default; }
  button.text { border: 0; background: none; padding: 0; height: auto; text-decoration: underline; text-underline-offset: 3px; }
  button.text:hover { background: none; color: var(--muted); }
  button.danger { color: var(--negative); }
  :is(a, button, input, select, textarea, summary, label):focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .key { min-width: 96px; font-variant-numeric: tabular-nums; font-weight: 500; }
  .key.recording { border-color: var(--text); }

  /* Switch: a styled checkbox, on in near-black. */
  input[role='switch'] { appearance: none; width: 32px; height: 20px; border-radius: 999px; background: var(--control); position: relative; cursor: pointer; flex: none; transition: background 0.15s; }
  input[role='switch']::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  input[role='switch']:checked { background: var(--primary); }
  input[role='switch']:checked::after { transform: translateX(12px); background: var(--on-primary); }
  .list { padding: 4px 16px; }
  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 0; cursor: pointer; }
  .switch-row + .switch-row, .provider + .provider { border-top: 1px solid var(--border); }
  .switch-row strong { font-weight: 500; }

  .seg { display: inline-flex; gap: 2px; padding: 2px; background: var(--active); border-radius: 8px; }
  .seg button { border: 0; background: none; height: 28px; padding: 0 12px; border-radius: 6px; color: var(--muted); }
  .seg button.on { background: var(--ground); color: var(--text); font-weight: 500; }

  /* 1.25fr gives the theme grid three 172px columns at 1440 (3 × 172 + 2 × 8 = 532). */
  .appearance { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 40px; align-items: start; }
  .stack { display: flex; flex-direction: column; gap: 16px; }
  .stack:first-child { border-top: 0; padding-top: 0; }
  .about.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .preview-frame {
    /* A size container: the palette's cq units resolve against this frame instead of the window. */
    container-type: size; position: sticky; top: 24px; height: 520px; overflow: hidden; border-radius: 12px;
    background: var(--raised); transform: translateZ(0); /* makes the palette's position:fixed relative to the frame */
  }
  /* 172px fits the longest name ("Catppuccin Mocha", 122px of text) on one line, so the grid drops a column instead of wrapping. */
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 8px; }
  .theme { display: flex; align-items: center; gap: 8px; text-align: left; height: 40px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* :not(:disabled) out-ranks the generic button hover, which would paint the page's own --active over the theme's colours. */
  .theme:hover:not(:disabled) { background: var(--bg); box-shadow: inset 0 0 0 1px var(--control); }
  .theme.on, .theme.on:hover:not(:disabled) { box-shadow: 0 0 0 2px var(--text); border-color: transparent; }
  .swatch { width: 16px; height: 16px; border-radius: 50%; flex: none; background: var(--accent); box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4); }
  .swatch.split { background: conic-gradient(#1c1c1e 0 50%, #ffffff 0); }
  input[type='color'] { width: 44px; height: 32px; padding: 0; border: 1px solid var(--control); border-radius: 8px; background: none; cursor: pointer; }
  input[type='color']:disabled { cursor: default; opacity: 0.6; }
  .layouts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .card { display: flex; flex-direction: column; gap: 2px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
  .card.on { box-shadow: 0 0 0 2px var(--text); border-color: transparent; }
  .card input { position: absolute; opacity: 0; }
  .card:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
  .card strong { font-weight: 500; }
  .preview { position: relative; height: 54px; background: var(--active); border-radius: 6px; margin-bottom: 6px; }
  .preview span { position: absolute; background: var(--ground); border: 1px solid var(--control); left: 50%; transform: translateX(-50%); }
  .preview.palette span { top: 10px; width: 60%; height: 30px; border-radius: 4px; }
  .preview.spotlight span { top: 16px; width: 76%; height: 22px; border-radius: 6px; }
  .preview.notch span { top: 0; width: 48%; height: 24px; border-radius: 0 0 6px 6px; border-top: 0; }

  .provider summary { display: grid; grid-template-columns: 120px auto minmax(0, 1fr) 12px; align-items: center; gap: 12px; padding: 12px 0; cursor: pointer; list-style: none; }
  .provider summary::after { content: '›'; color: var(--muted); font-size: 18px; transition: transform 0.15s; }
  .provider[open] summary::after { transform: rotate(90deg); }
  .provider summary::-webkit-details-marker { display: none; }
  .provider summary strong { font-weight: 500; }
  .provider .model { color: var(--muted); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { font-size: 12px; line-height: 20px; padding: 0 8px; border-radius: 999px; background: var(--active); color: var(--muted); white-space: nowrap; justify-self: start; }
  .status.ready { background: color-mix(in srgb, var(--positive) 14%, transparent); color: var(--positive); }
  .fields { display: grid; gap: 12px; padding: 4px 0 16px; }
  .joined { display: flex; }
  .joined input { flex: 1; border-radius: 8px 0 0 8px !important; }
  .joined button { border-radius: 0 8px 8px 0; border-left: 0; }
  .inline { display: flex; gap: 10px; align-items: center; cursor: pointer; }
  .error { color: var(--negative); }
  .preset { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 8px; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .preset textarea { grid-column: 1 / -1; }

  @media (max-width: 1100px) {
    .appearance { grid-template-columns: 1fr; }
    .preview-frame { position: relative; top: 0; order: -1; }
    section { grid-template-columns: 1fr; gap: 12px; }
  }
  /* Phone: the sidebar folds into a top bar with the four areas in one scrolling row. */
  @media (max-width: 720px) {
    .shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    nav { position: sticky; z-index: 1; height: auto; flex-direction: row; align-items: center; gap: 4px; padding: 10px 16px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); background: var(--ground); }
    .brand { padding: 0 8px 0 0; }
    .brand span { display: none; }
    nav a { white-space: nowrap; padding: 10px 12px; }
    main { padding: 24px 16px 48px; }
    .layouts { grid-template-columns: 1fr; }
    .provider summary { grid-template-columns: 1fr auto 12px; }
    .provider .model { display: none; }
    .preset { grid-template-columns: 1fr 1fr; }
  }
</style>

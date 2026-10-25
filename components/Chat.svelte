<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Browser } from 'wxt/browser';
  import type { ChatEvent, ChatMsg, ChatRequest } from '@/lib/ai';
  import { renderMarkdown } from '@/lib/markdown';
  import { send as sendToBackground } from '@/lib/messages';

  let { prompt, tabId, clearPrompt, copy, openSettings }: {
    prompt: string;
    tabId?: number;
    clearPrompt: () => void;
    copy: (text: string, message: string) => void;
    openSettings: () => void;
  } = $props();

  type Target = { id: string; name: string; model: string };
  let targets = $state<Target[]>();
  let target = $state<string>();
  let history = $state<ChatMsg[]>([]);
  let streaming = $state(false);
  let thinking = $state(false);
  let error = $state<string>();
  let box = $state<HTMLDivElement>();
  let port: Browser.runtime.Port | undefined;

  const storeKey = () => `chat:${target}`;
  const current = $derived(targets?.find((t) => t.id === target));

  onMount(async () => {
    const r = await sendToBackground({ type: 'ai-targets' });
    targets = r.targets;
    target = r.default;
    if (target) await loadHistory();
  });

  // Keep a half-streamed answer if the palette closes mid-reply.
  onDestroy(() => {
    if (streaming) save();
    port?.disconnect();
  });

  async function loadHistory() {
    history = ((await browser.storage.local.get(storeKey()))[storeKey()] as ChatMsg[] | undefined) ?? [];
    error = undefined;
    scroll();
  }
  const save = () => browser.storage.local.set({ [storeKey()]: $state.snapshot(history) });

  async function scroll() {
    await tick();
    box?.scrollTo({ top: box.scrollHeight });
  }

  async function select(id: string) {
    if (streaming || id === target) return;
    target = id;
    await loadHistory();
  }

  function send() {
    const text = prompt.trim();
    if (!text || streaming || !target) return;
    clearPrompt();
    error = undefined;
    history.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
    streaming = true;
    scroll();
    port = browser.runtime.connect({ name: 'ai' });
    port.onMessage.addListener((e: ChatEvent) => {
      const reply = history[history.length - 1]!;
      if ('thinking' in e) thinking = true;
      else if ('delta' in e) {
        thinking = false;
        reply.content += e.delta;
        scroll();
      } else if ('page' in e) {
        Object.assign(history[history.length - 2]!, { content: e.page, display: text });
      } else {
        if ('error' in e) {
          error = e.error;
          if (!reply.content) history.splice(-2, 2); // drop the failed exchange so a retry starts clean
        }
        streaming = false;
        thinking = false;
        port?.disconnect();
        port = undefined;
        save();
      }
    });
    const req: ChatRequest = { target, tabId: tabId!, messages: $state.snapshot(history.slice(0, -1)) };
    port.postMessage(req);
  }

  // Copy buttons live inside rendered markdown, so handle them by delegation.
  function onChatClick(e: MouseEvent) {
    const btn = (e.target as Element).closest('.copy-code');
    const code = btn?.nextElementSibling?.textContent;
    if (!btn || code == null) return;
    copy(code.replace(/\n$/, ''), 'Code copied');
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  }

  function stop() {
    port?.disconnect();
    port = undefined;
    streaming = false;
    save();
  }

  /** Keys the palette forwards in chat mode; returns true when handled. */
  export function key(e: KeyboardEvent, mod: boolean): boolean {
    if (e.key === 'Enter') {
      if (streaming) stop();
      else if (prompt.trim()) send();
      else {
        const last = history.findLast((m) => m.role === 'assistant');
        if (last) copy(last.content, 'Answer copied');
      }
      return true;
    }
    if (e.key === 'Tab' && targets && targets.length > 1) {
      const i = targets.findIndex((t) => t.id === target);
      select(targets[(i + (e.shiftKey ? targets.length - 1 : 1)) % targets.length]!.id);
      return true;
    }
    if (e.key === 'Backspace' && mod && !prompt && !streaming) {
      history = [];
      error = undefined;
      browser.storage.local.remove(storeKey());
      return true;
    }
    return false;
  }
</script>

{#if targets && !targets.length}
  <div class="empty">
    <p>No AI provider is set up yet.</p>
    <button onclick={openSettings}>Open settings to add an API key or enable Ollama</button>
  </div>
{:else if targets}
  <div class="chips">
    {#each targets as t (t.id)}
      <button class:on={t.id === target} title={t.model} onclick={() => select(t.id)}>{t.name}</button>
    {/each}
    {#if current}<span class="model">{current.model}</span>{/if}
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (clicks come from real <button>s inside) -->
  <div class="chat" bind:this={box} onclick={onChatClick}>
    {#each history as m, i (i)}
      <div class="msg {m.role}">
        {#if m.role === 'user'}{m.display ?? m.content}
        {:else if !m.content && streaming}<span class="dots">{thinking ? 'Thinking…' : '…'}</span>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML and allows only safe links (markdown.test.ts) -->
        {:else}{@html renderMarkdown(m.content)}{/if}
      </div>
    {:else}
      <p class="hint">Ask anything. Add <code>@page</code> to include the current page.</p>
    {/each}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .chips .model { margin-left: auto; align-self: center; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .chat { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-height: 120px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  .msg { overflow-wrap: anywhere; line-height: 1.5; max-width: 92%; }
  .msg.user { white-space: pre-wrap; align-self: flex-end; background: var(--hl); padding: 6px 10px; border-radius: 10px; }
  .msg.assistant { align-self: flex-start; min-width: 0; }
  /* Rendered markdown ({@html} content isn't scoped, hence :global). */
  .msg.assistant :global(:is(p, ul, ol, pre, table, blockquote, h1, h2, h3, h4)) { margin: 0 0 8px; }
  .msg.assistant :global(> :last-child) { margin-bottom: 0; }
  .msg.assistant :global(:is(h1, h2, h3, h4)) { font-size: 15px; line-height: 1.3; }
  .msg.assistant :global(:is(ul, ol)) { padding-left: 20px; }
  .msg.assistant :global(li + li) { margin-top: 2px; }
  .msg.assistant :global(a) { color: var(--accent); }
  .msg.assistant :global(code) { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--hl); padding: 1px 4px; border-radius: 4px; }
  .msg.assistant:has(:global(.code)) { width: 92%; }
  .msg.assistant :global(.code) { position: relative; margin: 0 0 8px; }
  .msg.assistant :global(.code pre) { padding-right: 64px; }
  .msg.assistant :global(.copy-code) {
    all: unset; position: absolute; top: 6px; right: 6px; cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 6px;
    background: var(--bg); color: var(--muted); border: 1px solid var(--line); opacity: 0; transition: opacity 0.15s;
  }
  .msg.assistant :global(.code:hover .copy-code), .msg.assistant :global(.copy-code:focus-visible) { opacity: 1; }
  .msg.assistant :global(.copy-code:hover) { color: var(--fg); border-color: var(--accent); }
  .msg.assistant :global(.copy-code:focus-visible) { outline: 2px solid var(--accent); }
  .msg.assistant :global(pre) { background: var(--hl); padding: 10px 12px; border-radius: 8px; overflow-x: auto; scrollbar-width: thin; }
  .msg.assistant :global(pre code) { background: none; padding: 0; white-space: pre; }
  .msg.assistant :global(blockquote) { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); }
  .msg.assistant :global(table) { border-collapse: collapse; display: block; overflow-x: auto; }
  .msg.assistant :global(:is(th, td)) { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
  .msg.assistant :global(hr) { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
  .dots { color: var(--muted); animation: pulse 1s infinite alternate; }
  @keyframes pulse { to { opacity: 0.3; } }
  .hint, .empty p { color: var(--muted); margin: 0; }
  .error { color: #e5484d; margin: 0; }
  code { font: 12px ui-monospace, monospace; background: var(--hl); padding: 1px 4px; border-radius: 4px; }
  .empty { padding: 24px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .empty button { all: unset; cursor: pointer; color: var(--accent); }
  .empty button:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }
</style>

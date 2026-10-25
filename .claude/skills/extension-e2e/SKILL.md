---
name: extension-e2e
description: Drive the Tabkit extension in a real browser (agent-browser MCP). Use when checking a change in the palette, settings page, tools or AI chat in the browser, or taking screenshots of the UI.
---

The Bash sandbox can't launch Chrome, so all browser work goes through the agent-browser MCP tools, session `tabkit`. The extension id is `mfkkblanhdohfjjhffnpfdcbbgbhmmbd` (pinned by the manifest `key` in wxt.config.ts).

## Steps

1. **Build for tests**: `npm run build:e2e`. It grants the optional data sources (bookmarks, history, downloads, sessions) up front and skips opening Settings on install, which would steal keyboard focus from the page. Run `npm run build` again before handing the build to the user.
2. **Load the build.** Content-script and options-page changes load on a page reload (`location.reload()`). A background change needs a relaunch, one call per message (close and open in the same message race, and the open comes up without the extension): `agent_browser_close`, then `agent_browser_open` with `session: "tabkit"`, `headed: true`, `extraArgs: ["--extension", "/Users/artem/code/tabkit/.output/chrome-mv3", "--profile", "/Users/artem/.agent-browser/profiles/tabkit"]`, `url: "https://example.com"`. The `--profile` folder keeps storage (settings, Ollama, chats) across relaunches; delete it for a first-install state.
   - **Prove the build is live** before testing. e2e builds stamp `version_name` with their build time, so on `chrome-extension://mfkkblanhdohfjjhffnpfdcbbgbhmmbd/options.html` run `(async () => chrome.runtime.getManifest().version_name === (await (await fetch('/manifest.json')).json()).version_name ? 'fresh' : 'stale')()`. `stale` means the browser still runs an older build (the open result's `launched`/`reused` flags don't tell you this): open a new `session` name with a new `--profile` folder and check again.
3. **Seed settings** only when the profile lacks them (see Seeding).
4. **Open the palette**: `agent_browser_press` `Meta+k` on the page, then install the helpers (see Helpers). A fresh launch leaves the page `document.visibilityState === 'hidden'` and the keypress lost: `agent_browser_tab_switch` to the tab, then press again.
5. **Drive and assert** with `agent_browser_eval`, returning short strings. Anything slower than a couple of seconds (AI streaming, feeds, weather) runs as a background job: the script writes `window.__t`, then `agent_browser_wait_ms`, then read `window.__t`.
6. **Screenshot** after any UI change: All view, one tool view (`:em`), and chat (`:ai`). Done when each screenshot shows the change and nothing else moved.

## Helpers

Paste once per page load, after the palette is open:

```js
(() => {
  const root = () => document.querySelector('tabkit-palette')?.shadowRoot;
  const input = () => root().querySelector('input');
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__q = async (v, wait = 800) => { input().value = v; input().dispatchEvent(new Event('input', { bubbles: true })); await __sleep(wait); };
  window.__key = (key, o = {}) => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...o }));
  window.__rows = (n = 8) => [...root().querySelectorAll('#tc-results > li')].slice(0, n)
    .map((l) => (l.classList.contains('group') ? '#' : '') + l.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)).join(' | ');
  window.__toasts = [];
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.localName === 'tabkit-toast' && __toasts.push(n.shadowRoot.textContent))))
    .observe(document.documentElement, { childList: true });
  return 'helpers ready';
})()
```

Synthetic `__key('Enter')` runs actions but carries no user activation, so clipboard writes fail with "Could not copy". For copy checks use a real `agent_browser_press Enter`, or `agent_browser_snapshot` then `agent_browser_click @ref` for buttons inside the palette, then read the clipboard with the agent-browser clipboard tool (`read`) to assert the exact text.

## Debugging

The repo's `.mcp.json` loads agent-browser with `--tools core,debug,mobile`: the debug set adds console and page-error reading, clipboard, and DevTools; mobile adds viewport and mouse tools. A user-level `agent-browser` server of the same name wins over it, so confirm with `agent_browser_tools_profiles` that the active set lists all three. Reach for the console tool first when something silently doesn't happen (palette doesn't open, a row does nothing): content-script and page errors land there. Background-worker errors don't; reproduce the call from an extension page instead (`chrome.runtime.sendMessage({ type: 'load' })` on `window.html`).

## Settings page

`options.html` has one view per area, picked by hash: `#general`, `#appearance`, `#sources`, `#ai`. Check layout at 1440 and 390 wide with the `mobile` tool set's viewport emulation, and hover states with its mouse tools; `agent_browser_tools_profiles` lists what is active. Without them: render `options.html#<view>` in an iframe of the target width scaled to fit the window, and force hover by copying every `:hover` rule onto a class (`cssText.replaceAll(':hover', '.__h')`) so the rules compete as under a real pointer.

## Seeding

Open `chrome-extension://mfkkblanhdohfjjhffnpfdcbbgbhmmbd/options.html#ai` (or the view holding the setting) and change settings through the form (set `.value`, dispatch `input`), never with `chrome.storage.*.set`: the open page autosaves its own state about 300 ms later and overwrites direct writes. Example, enabling Ollama:

```js
(async () => {
  const row = [...document.querySelectorAll('.provider')].find((r) => r.querySelector('strong').textContent === 'Ollama');
  row.querySelector('input[type=checkbox]').click();
  const m = row.querySelector('input[list]'); m.value = 'gemma4:e4b-mlx'; m.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  return JSON.stringify((await chrome.storage.sync.get('settings')).settings.ai.providers);
})()
```

Chat history and other per-device state can be written straight to `chrome.storage.local` keys (`chat:<target>`, `feedIcons`) when the options page isn't the one holding them.

## Gotchas

- Use agent-browser only through the MCP tools; the `agent-browser` CLI shares the daemon and its `close` kills the MCP session.
- After the daemon's idle timeout (1 h) the next call starts a fresh browser (`launched: true` on a plain eval) on `about:blank`: page state and installed helpers are gone, so reopen the page.
- The real mouse cursor in the headed window moves the palette selection (`onmousemove`), so a synthetic Enter can run whatever row sits under it. Set `sel` by query text and assert the selected row before pressing Enter.
- `chrome.runtime.reload()` disables the command-line-loaded extension (pages then fail with ERR_BLOCKED_BY_CLIENT). Relaunch instead.
- An eval that awaits for long fails with "Promise was collected"; use the background-job pattern from step 5.
- A normal `npm run build` opens Settings on first launch; if `press` stops reaching the page (`document.visibilityState === 'hidden'`), close that tab from an extension page: `chrome.tabs.query({ url: chrome.runtime.getURL('options.html') })` then `chrome.tabs.remove`.
- Ollama runs at `localhost:11434`; `gemma4:e4b-mlx` is the small, fast model. It streams `delta.reasoning` before content, which exercises the "Thinking…" state.

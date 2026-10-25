# TabCmdr (personal)

Command palette for Chromium browsers. WXT + Svelte 5.

```sh
npm install
npm run dev      # opens a dev browser with the extension and hot reload
npm run build    # -> .output/chrome-mv3, load via chrome://extensions → Load unpacked
npm test         # search/prefix logic
npm run check    # type-check
npm run verify   # check + test + build; the git pre-commit hook runs this
npm run build:e2e  # test build: data-source permissions granted, no Settings tab on install
```

⌘K / Ctrl+K opens it on normal pages. ⌘⇧K / Ctrl+Shift+K or the toolbar icon also work on
chrome:// pages, where the palette opens in its own window.

Prefixes: `:t` tabs+commands · `:b` bookmarks · `:h` history · `:d` downloads · `:r` recently closed
· `:p` pinned · `:c` commands · `:s` web search · `:ss` screenshots · `:cp` colour picker · `:rl` ruler.
Type `:` to list them; the Tools tab lists every tool. Results are grouped by kind with matched letters
highlighted.

Data sources: bookmarks, history, downloads and recently closed are optional permissions. Settings opens on
install so you can switch them on (Settings → Data sources); turning one off gives the permission back.

Page tools (`:c` or just type): zoom, hard reload, print, scroll, view source, full screen, copy
URL / title / Markdown link, open in incognito, QR code, color picker, ruler, and screenshots
(visible / selected area / full page → copy or save PNG).

Instant answers (just type; Enter copies): math (`sqrt(144) * 2`, `200 + 10%`, `15% of 80`), units
(`5 km to mi`, `32px to rem`, `1.5 GB to MB`, `100 f to c`), `time in tokyo`, `now + 3 days`, unix
timestamps, colors (`#f80`, `rgb(…)`, `hsl(…)`), bases (`0xff`, `10 to binary`), and the prefixes
`:tx <text>` (case conversion), `:uuid`, `:pwd [length]`.

Tools: `:em` emoji (grid grouped by category with a preview header and six skin-tone swatches; Enter
copies, Shift+Enter copies `:code:`, Esc goes back to Tools, last 32 picks on top) · `:todo` / `:td` to-do list (type to add, Enter checks off) · `:rss` reader (six preset
feeds, paste a feed URL to add one) · `:wx` weather via Open-Meteo (type a city to add, up to 15;
type a saved city's name for its 7-day forecast; °C unless you pick °F in Settings). ⌘⌫ / Ctrl+Backspace deletes a to-do, feed or place.
To-dos, feeds and places sync through `chrome.storage.sync`.

AI chat: `:ai <message>` streams an answer; Enter on an empty prompt copies the last answer, Tab switches
provider/preset (each keeps its own history), ⌘⌫ clears the chat, and `@page` attaches the current page's
text. Answers render as Markdown (raw HTML shown as text, only http(s)/mailto links, images as links).
Providers: Claude (Anthropic SDK), ChatGPT, Gemini, Grok, Groq, DeepSeek, Mistral, Perplexity,
OpenRouter (OpenAI-compatible) and Ollama/local servers (no key; the extension strips its `Origin`
header on localhost so Ollama accepts it without `OLLAMA_ORIGINS`). Keys live in `chrome.storage.local`.

Settings (command "TabCmdr settings", or the extension's options page): 16 themes plus System, an accent
colour for System/Light/Dark (browsers don't expose their theme colours to extensions), Palette /
Spotlight / Notch layouts, the in-page shortcut, which filter tabs show, sites where the shortcut is off
(also the "Disable / enable the palette shortcut on this site" command), AI keys, models and presets.
Everything except keys syncs through `chrome.storage.sync`.

/background.ts` does all the browser API work, `lib/commands.ts` has the tab
commands, `lib/query.ts` does the prefix parsing and fuzzy ranking (pure, tested), and
`components/Palette.svelte` is the UI, `lib/page.ts` has page commands and screenshots, and
`ruler.content.ts` is the ruler overlay. `lib/tools.ts` has the pure tool logic (tested) and
`lib/toolbox.ts` the storage/network side, which runs in the background. `lib/settings.ts` holds
settings, themes and the provider catalog; `lib/ai.ts` streams chats over a runtime port;
`components/Chat.svelte` and `components/Options.svelte` are the chat view and settings page. `hotkey.content.ts` is the only script that runs on every
page; the palette is injected only when you open it.

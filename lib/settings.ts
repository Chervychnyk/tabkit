// User settings (chrome.storage.sync), themes and the AI provider catalog. Pure apart from load/save.
import type { Filter } from './types.ts';

export type Layout = 'palette' | 'spotlight' | 'notch';

export interface Preset { id: string; name: string; provider: string; model?: string; system: string }

export interface ProviderSettings { model?: string; baseUrl?: string; enabled?: boolean }

export interface Settings {
  /** a THEMES key, or 'system' to follow the OS light/dark setting */
  theme: string;
  /** optional accent override, e.g. to match the browser's colour theme (Chromium doesn't expose it to extensions) */
  accent?: string;
  layout: Layout;
  chips: Filter[];
  /** in-page shortcut, e.g. "Mod+KeyK"; Mod = ⌘ on Mac, Ctrl elsewhere */
  hotkey: string;
  disabledDomains: string[];
  /** web search engines offered for a query, in ENGINES order */
  engines: string[];
  /** weather temperatures */
  fahrenheit: boolean;
  ai: { default: string; providers: Record<string, ProviderSettings>; presets: Preset[] };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  layout: 'palette',
  chips: ['tab', 'bookmark', 'history', 'download', 'closed', 'tools'],
  hotkey: 'Mod+KeyK',
  disabledDomains: [],
  engines: ['Google', 'Bing', 'DuckDuckGo'],
  fahrenheit: false,
  ai: { default: '', providers: {}, presets: [] },
};

export async function loadSettings(): Promise<Settings> {
  const s = (await browser.storage.sync.get('settings')).settings as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...s, ai: { ...DEFAULT_SETTINGS.ai, ...s?.ai } };
}

export const saveSettings = (s: Settings) => browser.storage.sync.set({ settings: s });

// --- Optional data sources (permissions granted from Settings) ---

export const DATA_SOURCES = [
  { filter: 'bookmark', label: 'Bookmarks', permissions: ['bookmarks'], note: 'Search bookmarks; "Bookmark current tab"' },
  { filter: 'history', label: 'History', permissions: ['history'], note: 'Search the last 90 days of history' },
  { filter: 'download', label: 'Downloads', permissions: ['downloads', 'downloads.open'], note: 'List and open downloads; save screenshots without a prompt' },
  { filter: 'closed', label: 'Recently closed', permissions: ['sessions'], note: 'Restore closed tabs and windows; "Undo close tab"' },
  // Not a filter: grouped tabs get a badge with the group's name and colour. Edge doesn't offer the permission.
  { filter: 'groups', label: 'Tab groups', permissions: ['tabGroups'], note: 'Show group names and colours on tabs (Chrome)' },
] as const;

// --- Shortcut ---

interface Keys { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

export function hotkeyOf(e: Keys, isMac: boolean): string {
  const mods = [(isMac ? e.metaKey : e.ctrlKey) && 'Mod', isMac && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'];
  return [...mods.filter(Boolean), e.code].join('+');
}

// e.code, not e.key: Alt+K types "˚" on a Mac but its code is still KeyK.
export const matchesHotkey = (e: Keys, hotkey: string, isMac: boolean) => hotkeyOf(e, isMac) === hotkey;

export function hotkeyLabel(hotkey: string, isMac: boolean): string {
  const names: Record<string, string> = isMac ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' } : { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  const parts = hotkey.split('+').map((p) => names[p] ?? p.replace(/^Key|^Digit/, ''));
  return parts.join(isMac ? '' : '+');
}

export const domainDisabled = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

// --- Themes ---

// The highlight (--hl) is derived from the accent in CSS, so hover and selection follow it.
export interface Theme { name: string; dark: boolean; bg: string; fg: string; muted: string; line: string; accent: string }

/** Themes the custom accent applies to; named themes keep their own palette. */
export const ACCENT_THEMES = ['system', 'light', 'dark'];

export const THEMES: Record<string, Theme> = {
  light: { name: 'Light', dark: false, bg: '#ffffff', fg: '#1d1d1f', muted: '#6e6e73', line: '#e5e5ea', accent: '#4f46e5' },
  dark: { name: 'Dark', dark: true, bg: '#1c1c1e', fg: '#f2f2f7', muted: '#98989f', line: '#2c2c2e', accent: '#8b87ff' },
  paper: { name: 'Paper', dark: false, bg: '#fbf8f1', fg: '#2b2620', muted: '#7d7468', line: '#e9e2d3', accent: '#b45309' },
  'github-light': { name: 'GitHub Light', dark: false, bg: '#ffffff', fg: '#1f2328', muted: '#656d76', line: '#d0d7de', accent: '#0969da' },
  'solarized-light': { name: 'Solarized Light', dark: false, bg: '#fdf6e3', fg: '#586e75', muted: '#93a1a1', line: '#eee8d5', accent: '#268bd2' },
  'catppuccin-latte': { name: 'Catppuccin Latte', dark: false, bg: '#eff1f5', fg: '#4c4f69', muted: '#8c8fa1', line: '#ccd0da', accent: '#8839ef' },
  midnight: { name: 'Midnight', dark: true, bg: '#0b0d12', fg: '#e6e8ee', muted: '#8a90a2', line: '#1c2030', accent: '#5b8cff' },
  'github-dark': { name: 'GitHub Dark', dark: true, bg: '#0d1117', fg: '#e6edf3', muted: '#8d96a0', line: '#30363d', accent: '#2f81f7' },
  nord: { name: 'Nord', dark: true, bg: '#2e3440', fg: '#eceff4', muted: '#a3abba', line: '#3b4252', accent: '#88c0d0' },
  dracula: { name: 'Dracula', dark: true, bg: '#282a36', fg: '#f8f8f2', muted: '#a4a8c3', line: '#363949', accent: '#bd93f9' },
  'solarized-dark': { name: 'Solarized Dark', dark: true, bg: '#002b36', fg: '#93a1a1', muted: '#657b83', line: '#073642', accent: '#2aa198' },
  gruvbox: { name: 'Gruvbox Dark', dark: true, bg: '#282828', fg: '#ebdbb2', muted: '#a89984', line: '#3c3836', accent: '#fabd2f' },
  'tokyo-night': { name: 'Tokyo Night', dark: true, bg: '#1a1b26', fg: '#c0caf5', muted: '#7a83ad', line: '#24283b', accent: '#7aa2f7' },
  'catppuccin-mocha': { name: 'Catppuccin Mocha', dark: true, bg: '#1e1e2e', fg: '#cdd6f4', muted: '#a6adc8', line: '#313244', accent: '#cba6f7' },
  'one-dark': { name: 'One Dark', dark: true, bg: '#282c34', fg: '#abb2bf', muted: '#7f848e', line: '#3e4451', accent: '#61afef' },
  monokai: { name: 'Monokai', dark: true, bg: '#272822', fg: '#f8f8f2', muted: '#a59f85', line: '#3e3d32', accent: '#a6e22e' },
  palenight: { name: 'Material Palenight', dark: true, bg: '#292d3e', fg: '#a6accd', muted: '#676e95', line: '#34324a', accent: '#c792ea' },
  kanagawa: { name: 'Kanagawa', dark: true, bg: '#1f1f28', fg: '#dcd7ba', muted: '#727169', line: '#2a2a37', accent: '#7e9cd8' },
  'everforest-dark': { name: 'Everforest Dark', dark: true, bg: '#2d353b', fg: '#d3c6aa', muted: '#859289', line: '#3d484d', accent: '#a7c080' },
  'night-owl': { name: 'Night Owl', dark: true, bg: '#011627', fg: '#d6deeb', muted: '#637777', line: '#1d3b53', accent: '#82aaff' },
  'ayu-dark': { name: 'Ayu Dark', dark: true, bg: '#0b0e14', fg: '#bfbdb6', muted: '#565b66', line: '#1c212b', accent: '#e6b450' },
  'rose-pine-dawn': { name: 'Rosé Pine Dawn', dark: false, bg: '#faf4ed', fg: '#575279', muted: '#797593', line: '#f2e9e1', accent: '#b4637a' },
  'gruvbox-light': { name: 'Gruvbox Light', dark: false, bg: '#fbf1c7', fg: '#3c3836', muted: '#7c6f64', line: '#ebdbb2', accent: '#af3a03' },
  'nord-light': { name: 'Nord Light', dark: false, bg: '#eceff4', fg: '#2e3440', muted: '#4c566a', line: '#d8dee9', accent: '#5e81ac' },
  'one-light': { name: 'One Light', dark: false, bg: '#fafafa', fg: '#383a42', muted: '#696c77', line: '#e5e5e6', accent: '#4078f2' },
  'everforest-light': { name: 'Everforest Light', dark: false, bg: '#fdf6e3', fg: '#5c6a72', muted: '#829181', line: '#efebd4', accent: '#8da101' },
  'ayu-light': { name: 'Ayu Light', dark: false, bg: '#fcfcfc', fg: '#5c6166', muted: '#8a9199', line: '#e7eaed', accent: '#fa8d3e' },
  'tomorrow-light': { name: 'Tomorrow Light', dark: false, bg: '#ffffff', fg: '#4d4d4c', muted: '#8e908c', line: '#e0e0e0', accent: '#4271ae' },
  'material-light': { name: 'Material Light', dark: false, bg: '#fafafa', fg: '#546e7a', muted: '#90a4ae', line: '#e7eaec', accent: '#6182b8' },
  'rose-pine': { name: 'Rosé Pine', dark: true, bg: '#191724', fg: '#e0def4', muted: '#908caa', line: '#26233a', accent: '#ebbcba' },
};

/** Readable text colour on top of a #rrggbb background. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.55 ? '#111111' : '#ffffff';
}

/** CSS custom properties for a theme ('system' keeps the stylesheet's light/dark defaults), plus the custom accent on default themes. */
export function themeStyle(key: string, accent?: string): string {
  const t = THEMES[key];
  const base = t
    ? `--bg:${t.bg};--fg:${t.fg};--muted:${t.muted};--line:${t.line};--accent:${t.accent};--on-accent:${textOn(t.accent)};color-scheme:${t.dark ? 'dark' : 'light'}`
    : '';
  return accent && ACCENT_THEMES.includes(key) ? `${base}${base && ';'}--accent:${accent};--on-accent:${textOn(accent)}` : base;
}

// --- AI providers ---

export interface Provider { id: string; name: string; kind: 'openai' | 'anthropic'; baseUrl: string; model: string; keyless?: boolean }

// shortcut: default model names go stale; Settings → "Load models" lists what each provider currently offers.
export const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  { id: 'openai', name: 'ChatGPT', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'gemini', name: 'Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { id: 'grok', name: 'Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { id: 'perplexity', name: 'Perplexity', kind: 'openai', baseUrl: 'https://api.perplexity.ai', model: 'sonar' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  { id: 'ollama', name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', keyless: true },
];

/** A provider (or a preset on top of one) the user can chat with. */
export interface ChatTarget { id: string; name: string; provider: Provider; model: string; baseUrl: string; system?: string }

export function chatTargets(s: Settings, keys: Record<string, string>): ChatTarget[] {
  const ready = (p: Provider) => (p.keyless ? !!s.ai.providers[p.id]?.enabled : !!keys[p.id]);
  const resolve = (p: Provider, model?: string) => ({
    provider: p,
    model: model || s.ai.providers[p.id]?.model || p.model,
    baseUrl: s.ai.providers[p.id]?.baseUrl || p.baseUrl,
  });
  const targets: ChatTarget[] = PROVIDERS.filter(ready).map((p) => ({ id: p.id, name: p.name, ...resolve(p) }));
  for (const pr of s.ai.presets) {
    const p = PROVIDERS.find((p) => p.id === pr.provider);
    if (p && ready(p)) targets.push({ id: `preset:${pr.id}`, name: pr.name, ...resolve(p, pr.model), system: pr.system });
  }
  return targets.filter((t) => t.model);
}

import type { Tool } from './tools.ts';

export type Kind = 'tab' | 'bookmark' | 'history' | 'download' | 'closed' | 'command' | 'search' | 'url' | 'prefix' | 'answer' | 'emoji' | 'todo' | 'feed' | 'weather';
export type Filter = 'all' | 'tab' | 'bookmark' | 'history' | 'download' | 'closed' | 'pinned' | 'command' | 'search' | 'tools';
export type TabAction = 'reload' | 'mute' | 'pin' | 'duplicate' | 'new-window' | 'close' | 'ungroup' | 'split' | 'unsplit';

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  url?: string;
  tabId?: number;
  windowId?: number;
  pinned?: boolean;
  muted?: boolean;
  /** set when the tab is in a group; name and colour need the optional tabGroups permission */
  tabGroup?: { title?: string; color?: string };
  /** set when the tab is in a split view */
  split?: true;
  audible?: boolean;
  downloadId?: number;
  sessionId?: string;
  /** command id, or the query to insert for prefix hints */
  command?: string;
  /** answers: the text Enter copies, and an optional swatch color */
  copy?: string;
  color?: string;
  /** tools: a glyph shown instead of the favicon, and a payload for the background */
  icon?: string;
  /** tools: an image URL (e.g. a feed's site icon) shown instead of the favicon */
  image?: string;
  /** history: the id of a tab showing this page; All leaves the page to that tab, and Enter switches to it */
  openTab?: number;
  /** a short status shown instead of the host: a download's size or state, how long ago a tab was closed */
  note?: string;
  /** positions of the query's matched characters in title, for highlighting */
  hl?: readonly number[];
  data?: unknown;
  /** tools: the section header this item sits under (emoji categories) */
  group?: string;
}

/** What running a row can hand back to the palette: text to copy, or a QR code to show. */
export type RunResult = { copy?: string; qr?: string };

export type Message =
  | { type: 'toggle' }
  | { type: 'load'; tabId?: number }
  | { type: 'run'; item: Item; tabId: number; newTab: boolean }
  /** ctxTabId: the tab the palette was opened on (split pairs tabId with it) */
  | { type: 'tab-action'; action: TabAction; tabId: number; ctxTabId?: number }
  | { type: 'download-action'; action: 'show' | 'erase'; downloadId: number }
  | { type: 'tool'; tool: Tool; text: string }
  | { type: 'tool-run'; item: Item; alt: boolean }
  | { type: 'tool-delete'; item: Item }
  | { type: 'ai-targets' }
  | { type: 'ai-models'; provider: string; baseUrl?: string; key?: string }
  | { type: 'favicon'; url: string }
  | { type: 'open-settings' };

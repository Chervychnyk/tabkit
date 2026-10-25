import type { Tool } from './tools.ts';

export type Kind = 'tab' | 'bookmark' | 'history' | 'download' | 'closed' | 'command' | 'search' | 'url' | 'prefix' | 'answer' | 'emoji' | 'todo' | 'feed' | 'weather';
export type Filter = 'all' | 'tab' | 'bookmark' | 'history' | 'download' | 'closed' | 'pinned' | 'command' | 'search' | 'tools';
export type TabAction = 'reload' | 'mute' | 'pin' | 'duplicate' | 'incognito' | 'new-window' | 'close';

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  url?: string;
  tabId?: number;
  windowId?: number;
  pinned?: boolean;
  muted?: boolean;
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
  /** positions of the query's matched characters in title, for highlighting */
  hl?: readonly number[];
  data?: unknown;
  /** tools: the section header this item sits under (emoji categories) */
  group?: string;
}

export type Message =
  | { type: 'toggle' }
  | { type: 'load'; tabId?: number }
  | { type: 'run'; item: Item; tabId: number; newTab: boolean }
  | { type: 'tab-action'; action: TabAction; tabId: number }
  | { type: 'tool'; tool: Tool; text: string }
  | { type: 'tool-run'; item: Item; alt: boolean }
  | { type: 'tool-delete'; item: Item }
  | { type: 'ai-targets' }
  | { type: 'ai-models'; provider: string; baseUrl?: string; key?: string }
  | { type: 'open-settings' };

// The palette's keyboard and chip logic as one pure step: state + event → next state and the side effect to run.
// Palette.svelte owns the async work (messages, clipboard, focus, scrolling) and runs the effect.
import { parseQuery } from './query.ts';
import { gridStep, type Tool } from './tools.ts';
import type { Filter, Item } from './types.ts';

export interface PaletteState { query: string; chip: Filter; sel: number }

/** What step reads but doesn't own. */
export interface View {
  results: Item[];
  chips: Filter[];
  tool?: Tool;
  chat: boolean;
  qr: boolean;
  /** first index of each emoji section (grid only) */
  sections: number[];
}

export type PaletteEvent =
  | { type: 'key'; key: string; shift: boolean; mod: boolean }
  | { type: 'pick'; chip: Filter }
  | { type: 'activate'; item: Item; newTab: boolean };

export type Effect =
  | { do: 'close' }
  | { do: 'chat' } // the chat panel takes the key
  | { do: 'run'; item: Item; newTab: boolean }
  | { do: 'tab-close' | 'tool-delete'; item: Item };

export const EMOJI_COLS = 10;
export const TOOL_KINDS = new Set<Item['kind']>(['emoji', 'todo', 'feed', 'weather']);

/** The chip shown as on: a filter prefix (:h, :b…) lights its chip, otherwise the picked one. */
export const activeChip = (s: Pick<PaletteState, 'query' | 'chip'>): Filter => parseQuery(s.query).filter ?? s.chip;

/** The next state and effect, or null when the event isn't the palette's (a key then keeps its default action). */
export function step(s: PaletteState, e: PaletteEvent, v: View): { state: PaletteState; effect?: Effect } | null {
  const at = (sel: number) => ({ state: { ...s, sel: Math.max(0, Math.min(v.results.length - 1, sel)) } });
  // Picking a chip drops a filter prefix so the chip wins.
  if (e.type === 'pick') {
    const p = parseQuery(s.query);
    return { state: { query: p.filter ? p.text : s.query, chip: e.chip, sel: 0 } };
  }
  if (e.type === 'activate')
    return e.item.kind === 'prefix' ? { state: { ...s, query: e.item.command!, sel: 0 } } : { state: s, effect: { do: 'run', item: e.item, newTab: e.newTab } };

  const { key, shift, mod } = e;
  const cur = v.results[s.sel];
  const grid = v.tool === 'emoji';
  if (key === 'Escape') return grid ? { state: { query: '', chip: 'tools', sel: 0 } } : { state: s, effect: { do: 'close' } };
  if (v.chat) return { state: s, effect: { do: 'chat' } };
  if (v.qr) return null;
  if (grid && key === 'ArrowRight') return at(s.sel + 1);
  if (grid && key === 'ArrowLeft') return at(s.sel - 1);
  if (grid && (key === 'ArrowDown' || key === 'ArrowUp'))
    return at(gridStep(v.sections, v.results.length, EMOJI_COLS, s.sel, key === 'ArrowDown' ? 1 : -1));
  if (key === 'ArrowDown') return at(s.sel + 1);
  if (key === 'ArrowUp') return at(s.sel - 1);
  if (key === 'Enter') return cur ? step(s, { type: 'activate', item: cur, newTab: !shift }, v) : { state: s };
  if (key === 'Backspace' && mod && cur?.kind === 'tab') return { state: s, effect: { do: 'tab-close', item: cur } };
  if (key === 'Backspace' && mod && cur && TOOL_KINDS.has(cur.kind)) return { state: s, effect: { do: 'tool-delete', item: cur } };
  if (key === 'Tab' && !v.tool) {
    const i = v.chips.indexOf(activeChip(s));
    return step(s, { type: 'pick', chip: v.chips[(i + (shift ? v.chips.length - 1 : 1)) % v.chips.length]! }, v);
  }
  return null;
}

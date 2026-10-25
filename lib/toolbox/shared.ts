// What every tool module shares: the interface toolbox.ts dispatches to, and storage helpers.
import type { Item } from '../types.ts';

export type Result = { copy?: string; query?: string } | void;

/** One tool, as the palette sees it: its rows for some text, what Enter does on a row, what Mod+Backspace does. */
export interface ToolModule {
  items(text: string): Promise<Item[]>;
  run(item: Item, alt: boolean): Promise<Result>;
  remove?(item: Item): Promise<void>;
}

export const LIMIT = 100;

export async function get<T>(area: 'local' | 'sync', key: string, fallback: T): Promise<T> {
  return ((await browser.storage[area].get(key))[key] as T | undefined) ?? fallback;
}
export const set = (area: 'local' | 'sync', key: string, value: unknown) => browser.storage[area].set({ [key]: value });

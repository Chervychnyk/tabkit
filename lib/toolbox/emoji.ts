import data from 'emojibase-data/en/compact.json' with { type: 'json' };
import github from 'emojibase-data/en/shortcodes/github.json' with { type: 'json' };
import { searchEmoji, withTone } from '../tools.ts';
import type { Item } from '../types.ts';
import { get, LIMIT, set, type Result, type ToolModule } from './shared.ts';

const RECENT_MAX = 32;
const GROUPS = ['Smileys & Emotion', 'People & Body', 'Component', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags'];

let cache: ((typeof data)[number] & { key: string; code: string })[] | undefined;

function emojiList() {
  return (cache ??= data
    .filter((e) => e.group !== undefined && e.group !== 2) // drop loose regional letters and skin/hair components
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => {
      const c = (github as Record<string, string | string[]>)[e.hexcode];
      const code = (Array.isArray(c) ? c[0] : c) ?? e.label.replace(/\W+/g, '_');
      return { ...e, code, key: [e.label, code, ...(e.tags ?? [])].join(' ') };
    }));
}

async function items(text: string): Promise<Item[]> {
  const [tone, recent] = await Promise.all([get('local', 'emojiTone', 0), get<string[]>('local', 'emojiRecent', [])]);
  const list = emojiList();
  const toItem = (e: (typeof list)[number], group?: string, id = `em:${e.hexcode}`): Item => {
    const char = withTone(e, tone);
    return { id, kind: 'emoji', title: e.label, icon: char, copy: char, data: e.code, group };
  };
  if (text) return searchEmoji(list, text, LIMIT).map((e) => toItem(e));
  const byHex = new Map(list.map((e) => [e.hexcode, e]));
  // Recents also stay in their category, so they need their own ids.
  const recents = recent.flatMap((h) => byHex.get(h) ?? []).map((e) => toItem(e, 'Recently used', `em:${e.hexcode}:recent`));
  return [...recents, ...list.map((e) => toItem(e, GROUPS[e.group!]))];
}

async function run(item: Item, alt: boolean): Promise<Result> {
  const hex = item.id.split(':')[1]!; // em:<hex> or em:<hex>:recent
  const recent = await get<string[]>('local', 'emojiRecent', []);
  await set('local', 'emojiRecent', [hex, ...recent.filter((h) => h !== hex)].slice(0, RECENT_MAX));
  return { copy: alt ? `:${item.data}:` : item.copy };
}

export const emoji: ToolModule = { items, run };

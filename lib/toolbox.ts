// Tools that need storage or the network; runs in the background worker. Each tool is a module in toolbox/.
import { emoji } from './toolbox/emoji.ts';
import { rss } from './toolbox/rss.ts';
import type { ToolModule } from './toolbox/shared.ts';
import { todo } from './toolbox/todo.ts';
import { weather } from './toolbox/weather.ts';
import { toolOf, type Tool } from './tools.ts';
import type { Item } from './types.ts';

const MODULES: Record<Tool, ToolModule> = { emoji, todo, rss, weather };

export const toolItems = (tool: Tool, text: string) => MODULES[tool].items(text);

/** Enter on a tool row: the tool that listed it (found by the row's kind) decides. */
export async function toolRun(item: Item, alt: boolean) {
  const t = toolOf(item.kind);
  return t && MODULES[t].run(item, alt);
}

export async function toolDelete(item: Item) {
  const t = toolOf(item.kind);
  if (t) await MODULES[t].remove?.(item);
}

import type { Item } from '../types.ts';
import { get, set, type Result, type ToolModule } from './shared.ts';

// Rows: todo:item:<id>, todo:add (data: the text), todo:clear.
interface Todo { id: string; text: string; done: boolean }
const todos = () => get<Todo[]>('sync', 'todos', []);

async function items(text: string): Promise<Item[]> {
  const all = await todos();
  const q = text.toLowerCase();
  const shown = all.filter((t) => t.text.toLowerCase().includes(q)).sort((a, b) => +a.done - +b.done);
  const out: Item[] = shown.map((t) => ({ id: `todo:item:${t.id}`, kind: 'todo', title: t.text, icon: t.done ? '☑' : '☐' }));
  if (text && !all.some((t) => t.text.toLowerCase() === q)) out.unshift({ id: 'todo:add', kind: 'todo', title: `Add “${text}”`, icon: '+', data: text });
  if (!text && all.some((t) => t.done)) out.push({ id: 'todo:clear', kind: 'todo', title: 'Clear completed', icon: '✕' });
  return out;
}

async function run(item: Item): Promise<Result> {
  const [, action, id] = item.id.split(':');
  const all = await todos();
  if (action === 'add') {
    await set('sync', 'todos', [...all, { id: crypto.randomUUID(), text: item.data as string, done: false }]);
    return { query: ':todo ' };
  }
  if (action === 'clear') return void (await set('sync', 'todos', all.filter((t) => !t.done)));
  await set('sync', 'todos', all.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
}

async function remove(item: Item) {
  const [, action, id] = item.id.split(':');
  if (action === 'item') await set('sync', 'todos', (await todos()).filter((t) => t.id !== id));
}

export const todo: ToolModule = { items, run, remove };

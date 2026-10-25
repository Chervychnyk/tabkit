// AI chat, run in the background worker. The palette streams through a runtime port named 'ai'.
import Anthropic from '@anthropic-ai/sdk';
import type { Browser } from 'wxt/browser';
import { chatTargets, loadSettings, PROVIDERS, type ChatTarget } from './settings.ts';

export interface ChatMsg { role: 'user' | 'assistant'; content: string; /** what the user typed, when content was expanded (@page) */ display?: string }

export type ChatRequest = { target: string; tabId: number; messages: ChatMsg[] };
export type ChatEvent = { delta: string } | { thinking: true } | { page: string } | { done: true } | { error: string };

const PAGE_CHARS = 30_000;
const MAX_TOKENS = 16_000;

export const getKeys = async () => ((await browser.storage.local.get('aiKeys')).aiKeys ?? {}) as Record<string, string>;

export async function targets() {
  const [s, keys] = await Promise.all([loadSettings(), getKeys()]);
  const list = chatTargets(s, keys);
  return { targets: list.map(({ id, name, model }) => ({ id, name, model })), default: list.some((t) => t.id === s.ai.default) ? s.ai.default : list[0]?.id };
}

/** Local model servers (Ollama, LM Studio) reject the chrome-extension:// Origin; drop it on our own requests to localhost. */
export function allowLocalModels() {
  return browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
      condition: {
        regexFilter: '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?/',
        initiatorDomains: [browser.runtime.id],
        resourceTypes: ['xmlhttprequest'],
      },
    }],
  });
}

export function onChatPort(port: Browser.runtime.Port) {
  if (port.name !== 'ai') return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  const post = (e: ChatEvent) => { if (!abort.signal.aborted) port.postMessage(e); };
  port.onMessage.addListener((req: ChatRequest) =>
    chat(req, post, abort.signal).then(
      () => post({ done: true }),
      (e) => abort.signal.aborted || post({ error: e?.message ?? String(e) }),
    ));
}

async function chat(req: ChatRequest, post: (e: ChatEvent) => void, signal: AbortSignal) {
  const [s, keys] = await Promise.all([loadSettings(), getKeys()]);
  const target = chatTargets(s, keys).find((t) => t.id === req.target);
  if (!target) throw new Error('That AI provider is not set up anymore; check Settings');
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const last = messages.at(-1)!;
  if (/(^|\s)@page\b/.test(last.content)) {
    last.content = `${last.content}\n\n${await pageContext(req.tabId)}`;
    post({ page: last.content });
  }
  const key = keys[target.provider.id] ?? '';
  return target.provider.kind === 'anthropic'
    ? anthropic(target, key, messages, post, signal)
    : openai(target, key, messages, post, signal);
}

async function pageContext(tabId: number): Promise<string> {
  const [res] = await browser.scripting
    .executeScript({ target: { tabId }, func: () => ({ title: document.title, url: location.href, text: document.body?.innerText ?? '' }) })
    .catch(() => { throw new Error("Can't read this page (browser pages and the Web Store are off-limits)"); });
  const p = res!.result as { title: string; url: string; text: string };
  // shortcut: long pages are cut at PAGE_CHARS; summarise in chunks if that loses too much.
  const text = p.text.length > PAGE_CHARS ? `${p.text.slice(0, PAGE_CHARS)}\n[…page truncated]` : p.text;
  return `<page title="${p.title.replace(/"/g, "'")}" url="${p.url}">\n${text}\n</page>`;
}

type Msgs = { role: 'user' | 'assistant'; content: string }[];

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

async function anthropic(t: ChatTarget, apiKey: string, messages: Msgs, post: (e: ChatEvent) => void, signal: AbortSignal) {
  const client = new Anthropic({ apiKey, baseURL: t.baseUrl, dangerouslyAllowBrowser: true });
  const fallback = FALLBACK_MODELS.has(t.model);
  const stream = client.beta.messages.stream(
    {
      model: t.model,
      max_tokens: MAX_TOKENS,
      ...(t.system && { system: t.system }),
      messages,
      ...(fallback && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    },
    { signal },
  );
  stream.on('text', (delta) => post({ delta }));
  stream.on('streamEvent', (e) => {
    if (e.type === 'content_block_start' && e.content_block.type === 'thinking') post({ thinking: true });
  });
  const final = await stream.finalMessage().catch((e) => {
    if (!(e instanceof Anthropic.APIError)) throw e;
    const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
    throw new Error(e.status === 401 || e.status === 403 ? `Claude: ${e.status} — check the API key (${detail})` : `Claude: ${e.status ?? ''} ${detail}`.trim());
  });
  if (final.stop_reason === 'refusal') throw new Error('Claude declined to answer this request');
  if (final.stop_reason === 'max_tokens') post({ delta: '\n\n[answer cut off at the length limit]' });
}

async function openai(t: ChatTarget, key: string, messages: Msgs, post: (e: ChatEvent) => void, signal: AbortSignal) {
  const res = await fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: t.model,
      stream: true,
      messages: t.system ? [{ role: 'system', content: t.system }, ...messages] : messages,
    }),
  });
  if (!res.ok) throw new Error(await errorText(res, t));
  for await (const data of sse(res.body!)) {
    if (data === '[DONE]') break;
    const json = JSON.parse(data);
    if (json.error) throw new Error(json.error.message ?? String(json.error));
    const d = json.choices?.[0]?.delta;
    if (d?.content) post({ delta: d.content });
    // Reasoning models (Ollama gpt-oss/qwen, DeepSeek R1, OpenRouter) stream their reasoning separately.
    else if (d?.reasoning || d?.reasoning_content) post({ thinking: true });
  }
}

async function errorText(res: Response, t: ChatTarget) {
  const body = await res.text();
  let msg = body;
  try { msg = JSON.parse(body).error?.message ?? JSON.parse(body).error ?? body; } catch { /* not JSON: keep the raw body */ }
  if (res.status === 401 || res.status === 403) return `${t.provider.name}: ${res.status} — check the API key (${msg})`.slice(0, 300);
  return `${t.provider.name}: HTTP ${res.status} ${String(msg).slice(0, 240)}`;
}

/** Yields the data payload of each server-sent event. */
export async function* sse(body: ReadableStream<BufferSource>): AsyncGenerator<string> {
  let buf = '';
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
}

/** Model ids a provider offers, for the Settings model picker. */
export async function listModels(providerId: string, baseUrl?: string, key?: string): Promise<string[]> {
  const p = PROVIDERS.find((p) => p.id === providerId);
  if (!p) return [];
  key ??= (await getKeys())[p.id];
  const base = baseUrl || p.baseUrl;
  if (p.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: key, baseURL: base, dangerouslyAllowBrowser: true });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${p.name}: HTTP ${res.status}`);
  return ((await res.json()).data ?? []).map((m: { id: string }) => m.id).sort();
}

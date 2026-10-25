import type { Browser } from 'wxt/browser';
import { renderSVG } from 'uqr';
import type { Command } from './commands.ts';
import { toast } from './toast.ts';

type Tab = Browser.tabs.Tab;
type Mode = 'copy' | 'save';

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MAX_CANVAS_PX = 32000; // Chrome's canvas height limit is 32767
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function inPage<A extends unknown[], R>(ctx: Tab, func: (...args: A) => R, ...args: A): Promise<Awaited<R>> {
  return browser.scripting
    .executeScript({ target: { tabId: ctx.id! }, func, args } as never)
    .then((r: { result?: unknown }[]) => r[0]?.result as Awaited<R>);
}

export const notify = (ctx: Tab, text: string) => inPage(ctx, toast, text).catch(() => {});

async function zoom(ctx: Tab, dir: 1 | -1) {
  const z = await browser.tabs.getZoom(ctx.id!);
  const next = dir > 0 ? ZOOM_LEVELS.find((l) => l > z + 0.001) : ZOOM_LEVELS.findLast((l) => l < z - 0.001);
  if (next) await browser.tabs.setZoom(ctx.id!, next);
}

// --- screenshots ---------------------------------------------------------------

const capture = (ctx: Tab) => browser.tabs.captureVisibleTab(ctx.windowId, { format: 'png' });

async function bitmap(dataUrl: string) {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

export async function blobToDataUrl(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(s)}`;
}

const canvasToDataUrl = async (c: OffscreenCanvas) => blobToDataUrl(await c.convertToBlob({ type: 'image/png' }));

// Injected: writes a PNG data URL to the clipboard. Needs the page focused, so false means "save instead".
async function copyImage(dataUrl: string) {
  try {
    const bin = atob(dataUrl.split(',')[1] ?? '');
    const blob = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

async function deliver(ctx: Tab, dataUrl: string, mode: Mode) {
  if (mode === 'copy' && (await inPage(ctx, copyImage, dataUrl).catch(() => false)))
    return notify(ctx, 'Screenshot copied to clipboard');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `screenshot-${stamp}.png`;
  if (await browser.permissions.contains({ permissions: ['downloads'] }))
    return void (await browser.downloads.download({ url: dataUrl, filename }));
  // Downloads permission is optional: fall back to a download link clicked inside the page.
  await inPage(ctx, (url: string, name: string) => {
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
  }, dataUrl, filename);
}

// Injected: lets the user drag a rectangle. Resolves after the overlay is gone from the screen.
function selectArea(): Promise<{ x: number; y: number; w: number; h: number; vw: number } | null> {
  return new Promise((resolve) => {
    const o = document.createElement('div');
    o.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.25)';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;display:none;outline:1px dashed #fff;background:rgba(255,255,255,.15)';
    o.append(box);
    document.documentElement.append(o);
    let sx = 0, sy = 0, r: { x: number; y: number; w: number; h: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    const done = (v: typeof r) => {
      o.remove();
      removeEventListener('keydown', onKey, true);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(v && v.w > 2 && v.h > 2 ? { ...v, vw: innerWidth } : null)));
    };
    addEventListener('keydown', onKey, true);
    o.onmousedown = (e) => {
      sx = e.clientX;
      sy = e.clientY;
      box.style.display = 'block';
      o.onmousemove = (m) => {
        r = { x: Math.min(sx, m.clientX), y: Math.min(sy, m.clientY), w: Math.abs(m.clientX - sx), h: Math.abs(m.clientY - sy) };
        Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      };
    };
    o.onmouseup = () => done(r);
  });
}

function scrollAndSettle(y: number): Promise<number> {
  scrollTo({ top: y, behavior: 'instant' });
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY))));
}

async function shotVisible(ctx: Tab, mode: Mode) {
  await deliver(ctx, await capture(ctx), mode);
}

async function shotArea(ctx: Tab, mode: Mode) {
  const sel = await inPage(ctx, selectArea);
  if (!sel) return;
  const img = await bitmap(await capture(ctx));
  const k = img.width / sel.vw;
  const c = new OffscreenCanvas(Math.round(sel.w * k), Math.round(sel.h * k));
  c.getContext('2d')!.drawImage(img, sel.x * k, sel.y * k, sel.w * k, sel.h * k, 0, 0, c.width, c.height);
  await deliver(ctx, await canvasToDataUrl(c), mode);
}

// shortcut: scroll-and-stitch repeats sticky headers and only scrolls the document, not inner scroll
// containers (Gmail, Notion); switch to chrome.debugger Page.captureScreenshot if that matters.
async function shotFull(ctx: Tab, mode: Mode) {
  const m = await inPage(ctx, () => ({ h: document.documentElement.scrollHeight, vh: innerHeight, vw: innerWidth, y: scrollY, dpr: devicePixelRatio }));
  const height = Math.min(m.h, Math.floor(MAX_CANVAS_PX / m.dpr));
  let c: OffscreenCanvas | undefined;
  let k = 1;
  for (let y = 0; y < height; y += m.vh) {
    const top = await inPage(ctx, scrollAndSettle, y);
    const img = await bitmap(await capture(ctx));
    if (!c) {
      k = img.width / m.vw;
      c = new OffscreenCanvas(img.width, Math.round(height * k));
    }
    c.getContext('2d')!.drawImage(img, 0, Math.round(top * k));
    await sleep(550); // captureVisibleTab allows 2 calls per second
  }
  await inPage(ctx, (y: number) => scrollTo({ top: y, behavior: 'instant' }), m.y);
  await deliver(ctx, await canvasToDataUrl(c!), mode);
}

// --- commands -----------------------------------------------------------------

const screenshots: Command[] = (
  [['visible area', shotVisible], ['selected area', shotArea], ['full page', shotFull]] as const
).flatMap(([what, fn]) => [
  { id: `shot-${what}-copy`, title: `Screenshot ${what} → copy`, deferred: true, run: (ctx: Tab) => fn(ctx, 'copy') },
  { id: `shot-${what}-save`, title: `Screenshot ${what} → save PNG`, deferred: true, run: (ctx: Tab) => fn(ctx, 'save') },
]);

export const PAGE_COMMANDS: Command[] = [
  { id: 'zoom-in', title: 'Zoom in', run: (ctx) => zoom(ctx, 1) },
  { id: 'zoom-out', title: 'Zoom out', run: (ctx) => zoom(ctx, -1) },
  { id: 'zoom-reset', title: 'Reset zoom', run: (ctx) => browser.tabs.setZoom(ctx.id!, 0) },
  { id: 'hard-reload', title: 'Hard reload (bypass cache)', run: (ctx) => browser.tabs.reload(ctx.id!, { bypassCache: true }) },
  { id: 'print', title: 'Print page', deferred: true, run: (ctx) => inPage(ctx, () => print()) },
  { id: 'scroll-top', title: 'Scroll to top', run: (ctx) => inPage(ctx, () => scrollTo({ top: 0, behavior: 'smooth' })) },
  { id: 'scroll-bottom', title: 'Scroll to bottom', run: (ctx) => inPage(ctx, () => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })) },
  { id: 'view-source', title: 'View page source', run: (ctx) => browser.tabs.create({ url: `view-source:${ctx.url}`, index: ctx.index + 1 }) },
  {
    id: 'fullscreen', title: 'Toggle full screen',
    run: async (ctx) => {
      const w = await browser.windows.get(ctx.windowId);
      await browser.windows.update(ctx.windowId, { state: w.state === 'fullscreen' ? 'normal' : 'fullscreen' });
    },
  },
  { id: 'copy-url', title: 'Copy page URL', run: async (ctx) => ({ copy: ctx.url ?? '' }) },
  { id: 'copy-title', title: 'Copy page title', run: async (ctx) => ({ copy: ctx.title ?? '' }) },
  { id: 'copy-markdown', title: 'Copy page as Markdown link', run: async (ctx) => ({ copy: `[${ctx.title}](${ctx.url})` }) },
  { id: 'open-incognito', title: 'Open page in incognito', run: (ctx) => browser.windows.create({ url: ctx.url, incognito: true }) },
  { id: 'qr-code', title: 'QR code for this page', run: async (ctx) => ({ qr: renderSVG(ctx.url ?? '', { pixelSize: 6 }) }) },
  // Runs in the palette itself: EyeDropper needs the keypress's user activation.
  { id: 'color-picker', title: 'Color picker (HEX / RGB)', run: async () => {} },
  { id: 'ruler', title: 'Ruler: measure elements and gaps', deferred: true, run: (ctx) => browser.scripting.executeScript({ target: { tabId: ctx.id! }, files: ['/content-scripts/ruler.js'] }) },
  ...screenshots,
];

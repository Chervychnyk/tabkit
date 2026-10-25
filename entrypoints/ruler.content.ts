import { axisGaps } from '@/lib/ruler';

// Injected by the "Ruler" command; running it again (or Esc) exits.
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const g = globalThis as { __tabkitRuler?: (() => void) | null };
    if (g.__tabkitRuler) return g.__tabkitRuler();
    g.__tabkitRuler = start(() => (g.__tabkitRuler = null));
  },
});

const CSS = `
  .layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; font: 11px/1 ui-monospace, Menlo, monospace; }
  .box { position: fixed; outline: 1px solid #f43f5e; background: rgba(244, 63, 94, .08); }
  .box.anchor { outline-color: #3b82f6; background: rgba(59, 130, 246, .08); }
  .label { position: fixed; background: #111; color: #fff; padding: 3px 5px; border-radius: 3px; white-space: nowrap; }
  .gap { position: fixed; background: #f59e0b; }
  .guide { position: fixed; background: #06b6d4; pointer-events: auto; }
  .guide.h { left: 0; right: 0; height: 1px; cursor: ns-resize; }
  .guide.v { top: 0; bottom: 0; width: 1px; cursor: ew-resize; }
  .guide::after { content: ''; position: absolute; inset: -4px; }
  .help { position: fixed; bottom: 12px; right: 12px; background: #111; color: #fff; padding: 8px 10px; border-radius: 6px; font: 12px/1.5 system-ui, sans-serif; }
`;

function start(onStop: () => void) {
  const host = document.createElement('tabkit-ruler');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="marks"></div><div class="guides"></div>
    <div class="help">Hover: size · Click: anchor, then hover to measure gaps<br>H / V: add guide at cursor · drag to move · double-click to remove · Esc: exit</div></div>`;
  const marks = root.querySelector('.marks')!;
  const guides = root.querySelector('.guides')!;
  document.documentElement.append(host);

  let mouse = { x: 0, y: 0 };
  let hover: Element | null = null;
  let anchor: Element | null = null;

  const add = (cls: string, s: Partial<Record<'left' | 'top' | 'width' | 'height', number>>, text?: string) => {
    const el = document.createElement('div');
    el.className = cls;
    for (const [k, v] of Object.entries(s)) el.style.setProperty(k, `${v}px`);
    if (text) el.textContent = text;
    marks.append(el);
  };
  const round = (n: number) => Math.round(n * 10) / 10;

  function render() {
    marks.replaceChildren();
    const box = (el: Element, cls: string) => {
      const r = el.getBoundingClientRect();
      add(cls, { left: r.left, top: r.top, width: r.width, height: r.height });
      add('label', { left: r.left, top: Math.max(0, r.top - 18) }, `${round(r.width)} × ${round(r.height)}`);
      return r;
    };
    const a = anchor && box(anchor, 'box anchor');
    if (!hover || hover === anchor) return;
    const b = box(hover, 'box');
    if (!a) return;
    const cy = b.top + b.height / 2, cx = b.left + b.width / 2;
    for (const [s, e] of axisGaps(a.left, a.right, b.left, b.right)) {
      add('gap', { left: s, top: cy, width: e - s, height: 1 });
      add('label', { left: (s + e) / 2 - 12, top: cy + 4 }, `${round(e - s)}`);
    }
    for (const [s, e] of axisGaps(a.top, a.bottom, b.top, b.bottom)) {
      add('gap', { left: cx, top: s, width: 1, height: e - s });
      add('label', { left: cx + 4, top: (s + e) / 2 - 6 }, `${round(e - s)}`);
    }
  }

  function addGuide(dir: 'h' | 'v') {
    const g = document.createElement('div');
    g.className = `guide ${dir}`;
    const label = document.createElement('span');
    label.className = 'label';
    g.append(label);
    const place = (p: number) => {
      g.style.setProperty(dir === 'h' ? 'top' : 'left', `${p}px`);
      label.textContent = `${Math.round(p)}`;
      label.style.cssText = dir === 'h' ? `left:${mouse.x + 8}px;top:${p + 4}px` : `left:${p + 4}px;top:${mouse.y + 8}px`;
    };
    place(dir === 'h' ? mouse.y : mouse.x);
    g.onpointerdown = (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.onpointermove = (m) => place(dir === 'h' ? m.clientY : m.clientX);
      g.onpointerup = () => (g.onpointermove = null);
    };
    g.ondblclick = () => g.remove();
    guides.append(g);
  }

  const onMove = (e: MouseEvent) => {
    mouse = { x: e.clientX, y: e.clientY };
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== host && el !== hover) {
      hover = el;
      render();
    }
  };
  const onClick = (e: MouseEvent) => {
    if (e.target === host) return; // guide interaction
    e.preventDefault();
    e.stopPropagation();
    anchor = anchor === hover ? null : hover;
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') stop();
    else if ((k === 'h' || k === 'v') && !e.metaKey && !e.ctrlKey && !e.altKey) addGuide(k);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const opts = { capture: true };
  addEventListener('mousemove', onMove, opts);
  addEventListener('click', onClick, opts);
  addEventListener('keydown', onKey, opts);
  addEventListener('scroll', render, opts);
  addEventListener('resize', render, opts);

  function stop() {
    removeEventListener('mousemove', onMove, opts);
    removeEventListener('click', onClick, opts);
    removeEventListener('keydown', onKey, opts);
    removeEventListener('scroll', render, opts);
    removeEventListener('resize', render, opts);
    host.remove();
    onStop();
  }
  return stop;
}

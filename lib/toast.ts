// Self-contained (no imports, no closures): also injected into pages via scripting.executeScript.
export function toast(text: string) {
  const host = document.createElement('tabkit-toast');
  const root = host.attachShadow({ mode: 'open' });
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.style.cssText =
    'all:initial;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'background:#1c1c1e;color:#f2f2f7;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none';
  root.append(el);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 2500);
}

import { interpret } from './prefixes.ts';
import type { Item } from './types.ts';

// Instant answers: pure functions of the query, computed in the palette on each keystroke.

const ans = (title: string, copy = title, color?: string): Item => ({ id: '', kind: 'answer', title, copy, color });
const fmt = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }).format(n);
const raw = (n: number) => String(+n.toPrecision(12));

export function answer(query: string, now = new Date()): Item[] {
  return compute(query.trim(), now).map((item, i) => ({ ...item, id: `ans:${i}` }));
}

function compute(q: string, now: Date): Item[] {
  const p = interpret(q);
  if (p?.prefix.mode === 'answer') {
    const { key } = p.prefix;
    return key === 'tx' ? textCase(p.text) : key === 'uuid' ? [ans(crypto.randomUUID())] : passwords(p.text);
  }
  if (!q || q.startsWith(':')) return [];
  for (const f of [color, bases, units, timeZone, dateMath, unix, percentOf, math]) {
    const r = f(q, now);
    if (r.length) return r;
  }
  return [];
}

// --- math -------------------------------------------------------------------------

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

/** Recursive-descent evaluator. `a + b%` / `a - b%` add or subtract b percent of a. Throws on bad input. */
export function evaluate(src: string): number {
  const toks = src.replace(/×/g, '*').replace(/÷/g, '/').match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+|\*\*|\S/gi) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const eat = (t?: string) => {
    if (t && toks[i] !== t) throw new Error(`expected ${t}`);
    return toks[i++];
  };
  const add = (): number => {
    const first = mul();
    let v = first.pct ? first.v / 100 : first.v;
    while (peek() === '+' || peek() === '-') {
      const op = eat();
      const r = mul();
      const d = r.pct ? (v * r.v) / 100 : r.v;
      v = op === '+' ? v + d : v - d;
    }
    return v;
  };
  const mul = (): { v: number; pct: boolean } => {
    let r = unary();
    while (peek() === '*' || peek() === '/') {
      const op = eat();
      const b = unary();
      const bv = b.pct ? b.v / 100 : b.v;
      r = { v: op === '*' ? r.v * bv : r.v / bv, pct: false };
    }
    return r;
  };
  const unary = (): { v: number; pct: boolean } => {
    if (peek() === '-') return eat(), { v: -unary().v, pct: false };
    if (peek() === '+') eat();
    let v = power();
    if (peek() === '%') return eat(), { v, pct: true };
    return { v, pct: false };
  };
  const power = (): number => {
    const base = primary();
    if (peek() === '^' || peek() === '**') {
      eat();
      return base ** unary().v; // right-associative
    }
    return base;
  };
  const primary = (): number => {
    const t = eat();
    if (t === undefined) throw new Error('unexpected end');
    if (t === '(') {
      const v = add();
      eat(')');
      return v;
    }
    if (/^\d|^\./.test(t)) return parseFloat(t);
    const name = t.toLowerCase();
    if (FUNCS[name] && peek() === '(') {
      eat('(');
      const args = [add()];
      while (peek() === ',') eat(), args.push(add());
      eat(')');
      return FUNCS[name](...args);
    }
    if (name in CONSTS) return CONSTS[name]!;
    throw new Error(`unknown ${t}`);
  };
  const v = add();
  if (i < toks.length) throw new Error('trailing input');
  return v;
}

function math(q: string): Item[] {
  // A lone number or word isn't a question; require an operator, function call or parenthesis.
  if (!/[-+*/^%×÷(]/.test(q.replace(/^-/, '')) || /^\d{4}-\d\d?-\d\d?$/.test(q)) return [];
  try {
    const v = evaluate(q);
    return Number.isFinite(v) ? [ans(fmt(v), raw(v))] : [];
  } catch {
    return [];
  }
}

function percentOf(q: string): Item[] {
  const m = /^(.+?)\s*%\s*of\s+(.+)$/i.exec(q);
  if (!m) return [];
  try {
    const v = (evaluate(m[1]!) / 100) * evaluate(m[2]!);
    return [ans(fmt(v), raw(v))];
  } catch {
    return [];
  }
}

// --- units ------------------------------------------------------------------------

const UNITS: Record<string, [cat: string, factor: number]> = {};
const def = (cat: string, factor: number, ...names: string[]) => names.forEach((n) => (UNITS[n] = [cat, factor]));
const INCH = 0.0254;
// Length in metres; CSS units use 96px = 1in and a 16px root font size.
def('len', 1e-3, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres');
def('len', 1e-2, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres');
def('len', 1, 'm', 'meter', 'meters', 'metre', 'metres');
def('len', 1e3, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
def('len', INCH, 'in', 'inch', 'inches', '"');
def('len', INCH * 12, 'ft', 'foot', 'feet', "'");
def('len', INCH * 36, 'yd', 'yard', 'yards');
def('len', 1609.344, 'mi', 'mile', 'miles');
def('len', 1852, 'nmi', 'nautical');
def('len', INCH / 96, 'px', 'pixel', 'pixels');
def('len', INCH / 72, 'pt', 'point', 'points');
def('len', INCH / 6, 'pc', 'pica', 'picas');
def('len', (INCH / 96) * 16, 'rem', 'em');
// Mass in grams.
def('mass', 1e-3, 'mg', 'milligram', 'milligrams');
def('mass', 1, 'g', 'gram', 'grams');
def('mass', 1e3, 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms');
def('mass', 1e6, 't', 'tonne', 'tonnes', 'ton', 'tons');
def('mass', 28.349523125, 'oz', 'ounce', 'ounces');
def('mass', 453.59237, 'lb', 'lbs', 'pound', 'pounds');
def('mass', 6350.29318, 'st', 'stone', 'stones');
// Data in bytes: KB/MB/... are decimal, KiB/MiB/... binary.
def('data', 1 / 8, 'bit', 'bits');
def('data', 1, 'b', 'byte', 'bytes');
['k', 'm', 'g', 't', 'p'].forEach((p, i) => {
  def('data', 1000 ** (i + 1), `${p}b`, `${p}bytes`);
  def('data', 1024 ** (i + 1), `${p}ib`);
});
def('temp', 0, 'c', '°c', 'celsius');
def('temp', 0, 'f', '°f', 'fahrenheit');
def('temp', 0, 'k', 'kelvin');

const toKelvin: Record<string, (v: number) => number> = { c: (v) => v + 273.15, f: (v) => ((v - 32) * 5) / 9 + 273.15, k: (v) => v };
const fromKelvin: Record<string, (v: number) => number> = { c: (v) => v - 273.15, f: (v) => ((v - 273.15) * 9) / 5 + 32, k: (v) => v };
const tempKey = (u: string) => (u.includes('c') ? 'c' : u.includes('f') ? 'f' : 'k');

function units(q: string): Item[] {
  const m = /^(-?[\d.,]+)\s*([a-z°"']+)\s+(?:to|in|as|=)\s+([a-z°"']+)$/i.exec(q);
  if (!m) return [];
  const v = parseFloat(m[1]!.replace(/,/g, ''));
  const [from, to] = [m[2]!.toLowerCase(), m[3]!.toLowerCase()];
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b || a[0] !== b[0] || Number.isNaN(v)) return [];
  const r = a[0] === 'temp' ? fromKelvin[tempKey(to)]!(toKelvin[tempKey(from)]!(v)) : (v * a[1]) / b[1];
  return [ans(`${fmt(v)} ${m[2]} = ${fmt(+r.toPrecision(10))} ${m[3]}`, raw(r))];
}

// --- number bases -----------------------------------------------------------------

const BASES: [string, number, string][] = [['dec', 10, ''], ['hex', 16, '0x'], ['oct', 8, '0o'], ['bin', 2, '0b']];
const BASE_NAMES: Record<string, number> = { dec: 10, decimal: 10, hex: 16, hexadecimal: 16, oct: 8, octal: 8, bin: 2, binary: 2 };

function bases(q: string): Item[] {
  const lit = /^0([xob])([\da-f]+)$/i.exec(q);
  const conv = /^(-?\d+)\s+(?:to|in|as)\s+([a-z]+)$/i.exec(q);
  let n: number;
  if (lit) n = parseInt(lit[2]!, { x: 16, o: 8, b: 2 }[lit[1]!.toLowerCase() as 'x' | 'o' | 'b']);
  else if (conv && BASE_NAMES[conv[2]!.toLowerCase()]) n = parseInt(conv[1]!, 10);
  else return [];
  if (!Number.isSafeInteger(n)) return [];
  const all = BASES.map(([name, radix, prefix]) => ans(`${prefix}${n.toString(radix)}  (${name})`, n.toString(radix)));
  return conv ? all.filter((_, i) => BASES[i]![1] === BASE_NAMES[conv[2]!.toLowerCase()]) : all;
}

// --- colors -----------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): number[] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
}

function rgbToHsl(r: number, g: number, b: number): number[] {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

function color(q: string): Item[] {
  let rgb: number[] | undefined;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(q)?.[1];
  const fn = /^(rgb|hsl)a?\(\s*([\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i.exec(q);
  if (hex) {
    const h = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (fn) {
    const [a, b, c] = [fn[2], fn[3], fn[4]].map(Number) as [number, number, number];
    rgb = fn[1]!.toLowerCase() === 'rgb' ? [a, b, c] : hslToRgb(a, b, c);
  }
  if (!rgb || rgb.some((v) => !(v >= 0 && v <= 255))) return [];
  const [r, g, b] = rgb as [number, number, number];
  const hexStr = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const [h, s, l] = rgbToHsl(r, g, b);
  return [hexStr, `rgb(${r}, ${g}, ${b})`, `hsl(${h}, ${s}%, ${l}%)`].map((t) => ans(t, t, hexStr));
}

// --- time -------------------------------------------------------------------------

const ZONE_ALIASES: Record<string, string> = {
  utc: 'UTC', gmt: 'UTC', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
  est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', cst: 'America/Chicago', cdt: 'America/Chicago',
  mst: 'America/Denver', mdt: 'America/Denver', cet: 'Europe/Paris', cest: 'Europe/Paris', bst: 'Europe/London',
  ist: 'Asia/Kolkata', jst: 'Asia/Tokyo', kst: 'Asia/Seoul', aest: 'Australia/Sydney', msk: 'Europe/Moscow', eet: 'Europe/Athens',
  'san francisco': 'America/Los_Angeles', 'sf': 'America/Los_Angeles', seattle: 'America/Los_Angeles', 'new york': 'America/New_York',
  nyc: 'America/New_York', boston: 'America/New_York', miami: 'America/New_York', washington: 'America/New_York',
  beijing: 'Asia/Shanghai', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata',
  kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv', 'tel aviv': 'Asia/Jerusalem', munich: 'Europe/Berlin', barcelona: 'Europe/Madrid',
};

let zoneIndex: Map<string, string> | undefined;
function findZone(name: string): string | undefined {
  const key = name.toLowerCase().trim();
  if (ZONE_ALIASES[key]) return ZONE_ALIASES[key];
  zoneIndex ??= new Map(Intl.supportedValuesOf('timeZone').map((z) => [z.split('/').pop()!.replace(/_/g, ' ').toLowerCase(), z]));
  return zoneIndex.get(key);
}

function timeZone(q: string, now: Date): Item[] {
  const m = /^(?:(?:time|now)\s+in\s+(.+)|(.+?)\s+time)$/i.exec(q);
  const place = m?.[1] ?? m?.[2];
  const zone = place && findZone(place);
  if (!zone) return [];
  const time = now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  const detail = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', timeZoneName: 'short' }).format(now);
  return [ans(`${time} in ${place.replace(/\b\w/g, (c) => c.toUpperCase())} (${detail})`, time)];
}

const DATE_UNITS: Record<string, string> = {
  m: 'min', min: 'min', mins: 'min', minute: 'min', minutes: 'min', h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
  d: 'day', day: 'day', days: 'day', w: 'week', wk: 'week', week: 'week', weeks: 'week', month: 'month', months: 'month',
  y: 'year', yr: 'year', year: 'year', years: 'year',
};

function dateMath(q: string, now: Date): Item[] {
  const m = /^(now|today|tomorrow|yesterday)(?:\s*([+-])\s*(\d+)\s*([a-z]+))?$/i.exec(q);
  if (!m || (!m[2] && /^now$/i.test(m[1]!))) return [];
  const d = new Date(now);
  const base = m[1]!.toLowerCase();
  if (base === 'tomorrow') d.setDate(d.getDate() + 1);
  if (base === 'yesterday') d.setDate(d.getDate() - 1);
  const unit = m[4] ? DATE_UNITS[m[4].toLowerCase()] : undefined;
  if (m[4] && !unit) return [];
  const n = m[3] ? Number(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
  if (unit === 'min') d.setMinutes(d.getMinutes() + n);
  if (unit === 'hour') d.setHours(d.getHours() + n);
  if (unit === 'day') d.setDate(d.getDate() + n);
  if (unit === 'week') d.setDate(d.getDate() + 7 * n);
  if (unit === 'month') d.setMonth(d.getMonth() + n);
  if (unit === 'year') d.setFullYear(d.getFullYear() + n);
  const withTime = unit === 'min' || unit === 'hour';
  const title = d.toLocaleString(undefined, { dateStyle: 'full', ...(withTime ? { timeStyle: 'short' } : {}) });
  return [ans(title, withTime ? d.toISOString() : d.toLocaleDateString('sv-SE'))];
}

function unix(q: string, now: Date): Item[] {
  if (/^(unix|epoch|timestamp)$/i.test(q)) return [ans(`${Math.floor(now.getTime() / 1000)}  (unix time now)`, String(Math.floor(now.getTime() / 1000)))];
  if (!/^\d{10}(\d{3})?$/.test(q)) return [];
  const d = new Date(q.length === 13 ? Number(q) : Number(q) * 1000);
  return [ans(`${d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}`, d.toISOString())];
}

// --- answer prefixes ----------------------------------------------------------------

function textCase(s: string): Item[] {
  if (!s) return [];
  const words = s.match(/[A-Z]{2,}(?=[A-Z][a-z]|\b|\d)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ?? [];
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const lower = words.map((w) => w.toLowerCase());
  return [
    s.toUpperCase(),
    s.toLowerCase(),
    s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
    lower.map((w, i) => (i ? cap(w) : w)).join(''),
    lower.map(cap).join(''),
    lower.join('_'),
    lower.join('-'),
    lower.join('_').toUpperCase(),
  ].map((t) => ans(t));
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SYMBOLS = '!@#$%^&*-_=+?';

export function password(length: number, chars: string): string {
  const out: string[] = [];
  const buf = new Uint8Array(64);
  const limit = 256 - (256 % chars.length); // rejection sampling keeps every character equally likely
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < limit && out.length < length) out.push(chars[b % chars.length]!);
  }
  return out.join('');
}

function passwords(arg = ''): Item[] {
  const n = Math.min(128, Math.max(4, parseInt(arg, 10) || 20));
  return [password(n, ALNUM + SYMBOLS), password(n, ALNUM)].map((p) => ans(p));
}

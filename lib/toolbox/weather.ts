import { loadSettings } from '../settings.ts';
import { WMO } from '../tools.ts';
import type { Item } from '../types.ts';
import { get, set, type Result, type ToolModule } from './shared.ts';

// Open-Meteo, no key. Rows: wx:place:<index>, wx:day:<n>, wx:add:<id> (data: the Place), wx:hint.
interface Place { name: string; lat: number; lon: number }
const PLACES_MAX = 15;
const places = () => get<Place[]>('sync', 'places', []);

async function json(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Weather service: HTTP ${r.status}`);
  return r.json();
}

async function items(text: string): Promise<Item[]> {
  const [all, { fahrenheit }] = await Promise.all([places(), loadSettings()]);
  const q = text.toLowerCase();
  const shown = all.map((p, i) => ({ p, i })).filter(({ p }) => p.name.toLowerCase().includes(q));
  const out: Item[] = [];
  const t = (n: number) => `${Math.round(n)}°`;
  if (shown.length) {
    const params = new URLSearchParams({
      latitude: shown.map(({ p }) => p.lat).join(), longitude: shown.map(({ p }) => p.lon).join(),
      current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto', forecast_days: '7', ...(fahrenheit && { temperature_unit: 'fahrenheit' }),
    });
    const res = [await json(`https://api.open-meteo.com/v1/forecast?${params}`)].flat();
    shown.forEach(({ p, i }, n) => {
      const { current: c, daily: d } = res[n];
      const [icon, desc] = WMO[c.weather_code] ?? ['', ''];
      out.push({ id: `wx:place:${i}`, kind: 'weather', icon, title: `${p.name}  ${t(c.temperature_2m)} · ${desc} · H ${t(d.temperature_2m_max[0])} L ${t(d.temperature_2m_min[0])}` });
      if (shown.length === 1 && text)
        d.time.forEach((day: string, k: number) => {
          const [icon, desc] = WMO[d.weather_code[k]] ?? ['', ''];
          const name = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
          out.push({ id: `wx:day:${k}`, kind: 'weather', icon, title: `${name}  ${t(d.temperature_2m_max[k])} / ${t(d.temperature_2m_min[k])} · ${desc}` });
        });
    });
  }
  if (text.length >= 2) {
    const geo = await json(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(text)}`);
    for (const g of geo.results ?? []) {
      const name = [g.name, g.admin1, g.country].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(', ');
      if (!all.some((p) => p.lat === g.latitude && p.lon === g.longitude))
        out.push({ id: `wx:add:${g.id}`, kind: 'weather', icon: '+', title: `Add ${name}`, data: { name: g.name, lat: g.latitude, lon: g.longitude } });
    }
  }
  if (!all.length && !text) out.push({ id: 'wx:hint', kind: 'weather', icon: '⌕', title: 'Type a city to add it' });
  return out;
}

async function addPlace(place: Place): Promise<Result> {
  const all = await places();
  if (all.length >= PLACES_MAX) throw new Error(`Up to ${PLACES_MAX} places, remove one first`);
  await set('sync', 'places', [...all, place]);
  return { query: ':wx ' };
}

async function run(item: Item): Promise<Result> {
  const [, action] = item.id.split(':');
  if (action === 'add') return addPlace(item.data as Place);
  if (action !== 'hint') return { copy: item.title };
}

async function remove(item: Item) {
  const [, action, i] = item.id.split(':');
  if (action === 'place') await set('sync', 'places', (await places()).filter((_, k) => k !== +i!));
}

export const weather: ToolModule = { items, run, remove };

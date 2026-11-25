// Free routing & maps: OpenStreetMap (Nominatim geocoding, OSRM routing, OSM tiles).
// No API keys, no billing. Google Maps is offered as a one-tap deep link for verification.

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';
const TILE = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

let lastCall = 0;
async function politeFetch(url: string): Promise<Response> {
  // Nominatim policy: max 1 request / second
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Map service error ${res.status}`);
  return res;
}

const geoCache = new Map<string, Place[]>();

export async function geocode(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  if (geoCache.has(key)) return geoCache.get(key)!;
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0' });
  if (near) {
    const d = 1.5;
    p.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  const res = await politeFetch(`${NOMINATIM}/search?${p}`);
  const json = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  const out = json.map((r) => ({ label: r.display_name, lat: +r.lat, lon: +r.lon }));
  geoCache.set(key, out);
  return out;
}

export async function reverseGeocode(lat: number, lon: number): Promise<Place> {
  const res = await politeFetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18`);
  const j = (await res.json()) as { display_name?: string };
  return { label: j.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => rej(new Error(e.message || 'Location unavailable')),
      { enableHighAccuracy: true, timeout: 15000 },
    ),
  );
}

export interface Route {
  distanceKm: number;
  durationMin: number;
  coords: [number, number][]; // [lon, lat]
}

export async function route(points: Place[], roundTrip = false): Promise<Route> {
  const pts = roundTrip ? [...points, points[0]] : points;
  const path = pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetch(`${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`Routing error ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('No driving route found');
  const r = j.routes[0];
  return { distanceKm: r.distance / 1000, durationMin: r.duration / 60, coords: r.geometry.coordinates };
}

export function googleMapsUrl(stops: string[], roundTrip = false): string {
  const all = roundTrip ? [...stops, stops[0]] : stops;
  const p = new URLSearchParams({ api: '1', origin: all[0], destination: all[all.length - 1], travelmode: 'driving' });
  if (all.length > 2) p.set('waypoints', all.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${p}`;
}

// ---------- Static map rendering (Web Mercator) ----------
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2y = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};

async function loadTile(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

/** Draws the route over OSM tiles and returns a JPEG suitable for the expense PDF. */
export async function renderRouteMap(rt: Route, stops: Place[], opts: { width?: number; height?: number; title?: string } = {}): Promise<Blob> {
  const W = opts.width ?? 1400, H = opts.height ?? 1000;
  const lons = rt.coords.map((c) => c[0]).concat(stops.map((s) => s.lon));
  const lats = rt.coords.map((c) => c[1]).concat(stops.map((s) => s.lat));
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const pad = 80, header = 70;
  let z = 17;
  for (; z > 2; z--) {
    const w = lon2x(maxLon, z) - lon2x(minLon, z);
    const h = lat2y(minLat, z) - lat2y(maxLat, z);
    if (w <= W - 2 * pad && h <= H - 2 * pad - header) break;
  }
  const cx = (lon2x(minLon, z) + lon2x(maxLon, z)) / 2;
  const cy = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2 - header / 2;
  const ox = cx - W / 2, oy = cy - H / 2;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eef0f2';
  ctx.fillRect(0, 0, W, H);

  const tx0 = Math.floor(ox / 256), tx1 = Math.floor((ox + W) / 256);
  const ty0 = Math.floor(oy / 256), ty1 = Math.floor((oy + H) / 256);
  const jobs: Promise<void>[] = [];
  const n = 2 ** z;
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue;
    const wrapped = ((tx % n) + n) % n;
    jobs.push(loadTile(TILE(z, wrapped, ty)).then((img) => { if (img) ctx.drawImage(img, tx * 256 - ox, ty * 256 - oy); }));
  }
  await Promise.all(jobs);

  const px = (lon: number, lat: number): [number, number] => [lon2x(lon, z) - ox, lat2y(lat, z) - oy];
  // Route casing + line
  for (const [color, width] of [['#ffffff', 11], ['#1a73e8', 6]] as const) {
    ctx.beginPath();
    rt.coords.forEach(([lon, lat], i) => { const [x, y] = px(lon, lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }
  // Markers
  stops.forEach((s, i) => {
    const [x, y] = px(s.lon, s.lat);
    const last = i === stops.length - 1;
    ctx.beginPath();
    ctx.arc(x, y - 22, 17, 0, Math.PI * 2);
    ctx.moveTo(x - 11, y - 11); ctx.lineTo(x, y); ctx.lineTo(x + 11, y - 11);
    ctx.fillStyle = i === 0 ? '#188038' : last ? '#d93025' : '#f29900';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String.fromCharCode(65 + i), x, y - 22);
  });
  // Header band
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(0, 0, W, header);
  ctx.fillStyle = '#202124'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(`${rt.distanceKm.toFixed(1)} km driving`, 24, header / 2);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillStyle = '#5f6368';
  if (opts.title) ctx.fillText(opts.title, 330, header / 2);
  // Attribution (required by OSM licence)
  ctx.font = '16px system-ui, sans-serif';
  const attr = '© OpenStreetMap contributors · Route: OSRM';
  const aw = ctx.measureText(attr).width + 16;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(W - aw, H - 26, aw, 26);
  ctx.fillStyle = '#333';
  ctx.fillText(attr, W - aw + 8, H - 13);

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('map encode failed'))), 'image/jpeg', 0.88));
}

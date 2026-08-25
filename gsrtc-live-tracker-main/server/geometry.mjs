/**
 * Road geometry for a route.
 *
 * Until now the map drew straight lines between stops, which is why `insight.locateOnRoute`
 * needs an eight-kilometre tolerance before it will trust a position: a real road between two
 * stops wanders a long way from the line joining them. Snapping to the actual road fixes both
 * the picture and the arithmetic underneath it.
 *
 * Why fetch rather than compute: routing needs the road network, and India's OSM extract does
 * not fit on a 1 GB instance. So we ask a public OSRM once per route and keep the answer
 * **forever** — a bus route's shape changes on the order of years, and the coordinates that
 * key it come from the operator's own stop list.
 *
 * That makes this a cache problem rather than a traffic problem. Concretely: a few hundred
 * requests in the lifetime of the app, one per distinct route, never repeated. The politeness
 * measures below exist to keep it that way — a bug that turned this into a per-request call
 * would be abusing somebody's donated infrastructure.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  enabled: process.env.ROUTE_GEOMETRY !== '0',
  // FOSSGIS run this for the OSM community. Their policy asks for a real User-Agent, modest
  // volume and caching — all of which this does.
  host: process.env.OSRM_HOST || 'https://routing.openstreetmap.de/routed-car',
  userAgent: process.env.GEOMETRY_UA
    || 'ST-Tracker/1.7 (+https://tracker.shivrajsinh.in; community bus tracker)',
  cacheDir: process.env.GEOMETRY_CACHE || path.join(PROJECT_ROOT, '.data', 'geometry'),
  timeoutMs: 20000,
  maxStops: 25,             // OSRM rejects very long coordinate lists
  minGapMs: 1500,           // never more than one request every 1.5s, app-wide
};

const memory = new Map();
let lastRequestAt = 0;
let inFlight = null;        // one outbound request at a time, ever
const counters = { hits: 0, fetched: 0, failed: 0, skipped: 0 };

/** Route identity is its stop coordinates: same stops, same road, same answer. */
function cacheKey(points) {
  const canonical = points.map(([lat, lng]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(';');
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

function diskPath(key) {
  return path.join(config.cacheDir, `${key}.json`);
}

function readDisk(key) {
  try {
    return JSON.parse(fs.readFileSync(diskPath(key), 'utf8'));
  } catch {
    return null;
  }
}

function writeDisk(key, value) {
  try {
    fs.mkdirSync(config.cacheDir, { recursive: true });
    fs.writeFileSync(diskPath(key), JSON.stringify(value));
  } catch { /* a cache that cannot be written is still a working app */ }
}

/**
 * The road line through a list of stop coordinates, as [[lat, lng], …].
 * Returns null when it is unavailable — callers must fall back to straight lines, never wait.
 */
export async function forStops(points) {
  if (!config.enabled) return null;
  const usable = (points || []).filter(
    ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0),
  );
  if (usable.length < 2) return null;

  // Long routes get thinned rather than refused: the shape survives, the request stays sane.
  const step = Math.ceil(usable.length / config.maxStops);
  const sampled = step > 1 ? usable.filter((_, i) => i % step === 0 || i === usable.length - 1) : usable;

  const key = cacheKey(sampled);
  if (memory.has(key)) { counters.hits += 1; return memory.get(key); }

  const onDisk = readDisk(key);
  if (onDisk) {
    counters.hits += 1;
    memory.set(key, onDisk.line);
    return onDisk.line;
  }

  // Serialise every outbound call and space them out. Two riders opening the same new route
  // at once must produce one request, not two.
  if (inFlight) {
    try { await inFlight; } catch { /* the other caller reports its own failure */ }
    if (memory.has(key)) { counters.hits += 1; return memory.get(key); }
  }

  inFlight = fetchGeometry(sampled, key);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function fetchGeometry(points, key) {
  const wait = config.minGapMs - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  // OSRM wants lng,lat — the reverse of every other coordinate in this codebase.
  const coords = points.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const url = `${config.host}/route/v1/driving/${coords}`
    + '?overview=full&geometries=geojson&steps=false&alternatives=false';

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) {
      counters.failed += 1;
      return null;
    }
    const body = await res.json();
    const coordinates = body?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      counters.failed += 1;
      return null;
    }

    const line = coordinates.map(([lng, lat]) => [lat, lng]);
    memory.set(key, line);
    writeDisk(key, { line, at: Date.now(), distanceM: body.routes[0].distance });
    counters.fetched += 1;
    return line;
  } catch {
    counters.failed += 1;
    return null;   // never let a routing outage break the map
  }
}

export function stats() {
  return { enabled: config.enabled, ...counters, cached: memory.size };
}

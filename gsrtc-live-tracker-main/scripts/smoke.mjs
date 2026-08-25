/**
 * End-to-end smoke test against a running server: every API route, plus the static shell.
 * Hits the real upstream, so a failure here can mean either our bug or the operator being down.
 *
 *   npm start &                 # or have it running already
 *   node scripts/smoke.mjs      # BASE=https://... to point elsewhere
 */

const BASE = process.env.BASE || 'http://localhost:8787';
const results = [];

async function check(name, path, verify) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const problem = verify(res, body);
    results.push({
      name,
      ok: !problem,
      detail: problem || summarise(body),
      ms: Date.now() - started,
      status: res.status,
    });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message, ms: Date.now() - started, status: 0 });
  }
}

const summarise = (b) => (Array.isArray(b) ? `${b.length} rows`
  : typeof b === 'object' && b ? Object.keys(b).slice(0, 4).join(',')
    : `${String(b).length} bytes`);

const ok200 = (res) => (res.ok ? null : `HTTP ${res.status}`);
const isArray = (res, body) => ok200(res) || (Array.isArray(body) ? null : 'expected an array');
const nonEmpty = (res, body) => isArray(res, body) || (body.length ? null : 'empty result');

const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

await check('shell', '/', (res, body) =>
  ok200(res) || (String(body).includes('<title>ST Tracker') ? null : 'not the app shell'));
await check('styles', '/styles.css', ok200);
await check('app module', '/js/app.js', ok200);
await check('manifest', '/manifest.webmanifest', (res, body) =>
  ok200(res) || (body?.icons?.length ? null : 'no icons declared'));
await check('service worker', '/sw.js', ok200);
await check('icon 192', '/icons/icon-192.png', ok200);

await check('health', '/api/health', (res, body) =>
  ok200(res) || (body?.status === 'ok' && body?.tracker ? null : 'missing status or tracker stats'));
await check('vehicle', '/api/vehicle/GJ-18-ZT-1028', (res, body) =>
  ok200(res) || (body && 'vehicle' in body && 'track' in body ? null : 'expected { vehicle, track }'));
await check('stations', '/api/stations/Rajkot', nonEmpty);
await check('plates', '/api/plates?q=zt10', nonEmpty);
await check('service types', '/api/servicetypes', nonEmpty);
await check('nearby', '/api/nearby?lat=23.0225&lng=72.5714', nonEmpty);
await check('timetable', `/api/timetable?from=464&to=470&date=${ymd}&pageSize=5`, nonEmpty);
await check('live route map', `/api/live?from=464&to=470&date=${ymd}&limit=10`, (res, body) =>
  ok200(res) || (Array.isArray(body?.buses) ? null : 'expected a buses array'));

// Validation must reject junk rather than forwarding it upstream.
await check('rejects bad plate', '/api/vehicle/%3Cscript%3E', (res, body) =>
  (res.status === 400 && body?.error ? null : `expected 400, got ${res.status}`));
await check('rejects bad station id', '/api/timetable?from=abc&to=470', (res) =>
  (res.status === 400 ? null : `expected 400, got ${res.status}`));
await check('rejects bad live query', '/api/live?from=x&to=470', (res) =>
  (res.status === 400 ? null : `expected 400, got ${res.status}`));
await check('rejects unknown route', '/api/nope', (res) =>
  (res.status === 404 ? null : `expected 404, got ${res.status}`));
await check('rejects path traversal', '/../package.json', (res) =>
  (res.status === 404 || res.status === 403 ? null : `expected 404/403, got ${res.status}`));

// The trip endpoint needs a live running trip, so derive one from today's timetable.
const timetable = await fetch(`${BASE}/api/timetable?from=464&to=470&date=${ymd}&pageSize=60`)
  .then((r) => r.json()).catch(() => []);
const running = (Array.isArray(timetable) ? timetable : [])
  .find((r) => /run|progress|depart/i.test(r.BusRunningStatus || ''));

if (running) {
  const q = `tripId=${running.TripId}&status=1&start=${encodeURIComponent(running.ArrivalTimeAtBoarding || '')}`;
  await check(`trip (${running.BusNo})`, `/api/trip?${q}`, (res, body) =>
    nonEmpty(res, body) || (body[0]?.LocationName ? null : 'no stop names'));
} else {
  results.push({ name: 'trip', ok: true, detail: 'skipped — no running trip right now', ms: 0, status: 0 });
}

const pad = Math.max(...results.map((r) => r.name.length));
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

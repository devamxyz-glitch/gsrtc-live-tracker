/**
 * Load test.
 *
 * The question this answers is not "how fast is the server" — it is the one that actually
 * matters for this app: **does serving N commuters cost N times as much upstream traffic?**
 * The cache, the in-flight de-duplication and the tracker exist to make the answer no. This
 * measures whether they do, by reading the upstream poll counter out of /api/health before
 * and after and comparing it against the number of requests the virtual riders made.
 *
 *   node scripts/loadtest.mjs                        # 50 riders at the app's real cadence
 *   node scripts/loadtest.mjs --users 200 --seconds 60
 *   node scripts/loadtest.mjs --users 100 --gap 2     # stress: poll far harder than the app
 *   BASE=https://tracker.example.com node scripts/loadtest.mjs
 *
 * `--gap` is the seconds between one rider's requests; it defaults to the app's own polling
 * interval. Anything much lower is a stress test rather than a simulation, and will trip the
 * per-IP rate limit because every virtual rider shares this machine's address. To measure raw
 * server capacity instead, run the server with RATE_LIMIT_RPM=0.
 *
 * Point it at a staging server, not something people are relying on.
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const BASE = process.env.BASE || 'http://localhost:8787';
const USERS = Number(args.get('users') || 50);
const SECONDS = Number(args.get('seconds') || 30);
// The app polls a tracked bus on its refresh interval (20s by default), not continuously.
const GAP_MS = Number(args.get('gap') || 20) * 1000;
const PLATES = ['GJ-18-ZT-1028', 'GJ-18-Z-8925', 'GJ-07-TU-6416', 'GJ-18-ZT-3763'];
const ROUTES = [['464', '470'], ['470', '464'], ['464', '644']];

const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const samples = [];          // { path, ms, status }
let errors = 0;
let throttled = 0;   // 429s are the rate limiter doing its job, not a failure
let stop = false;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(path) {
  const started = performance.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
    await res.arrayBuffer();
    samples.push({ path: path.split('?')[0], ms: performance.now() - started, status: res.status });
    if (res.status === 429) throttled += 1;
    else if (!res.ok) errors += 1;
  } catch {
    errors += 1;
    samples.push({ path: path.split('?')[0], ms: performance.now() - started, status: 0 });
  }
}

/** One rider doing what riders actually do, not a synthetic hammer on one endpoint. */
async function rider(id) {
  // Stagger arrivals; everyone starting on the same tick is not a real load shape.
  await sleep(Math.random() * 3000);
  const plate = pick(PLATES);
  const [from, to] = pick(ROUTES);

  while (!stop) {
    const roll = Math.random();
    if (roll < 0.55) {
      await hit(`/api/vehicle/${plate}?focus=1`);          // the common case: watching a bus
    } else if (roll < 0.75) {
      await hit(`/api/timetable?from=${from}&to=${to}&date=${ymd}&pageSize=80`);
    } else if (roll < 0.9) {
      await hit(`/api/live?from=${from}&to=${to}&date=${ymd}&limit=25`);
    } else {
      await hit('/api/stations/Rajkot');
    }
    // Match the app's own cadence, jittered — real riders are not a tight loop.
    await sleep(GAP_MS * (0.75 + Math.random() * 0.5));
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function health() {
  try {
    return await fetch(`${BASE}/api/health`).then((r) => r.json());
  } catch {
    return null;
  }
}

console.log(`Load test → ${BASE}`);
console.log(`${USERS} concurrent riders for ${SECONDS}s, ~${GAP_MS / 1000}s between requests each\n`);

const before = await health();
if (!before) {
  console.error(`Cannot reach ${BASE}/api/health — is the server running?`);
  process.exit(1);
}

const startedAt = Date.now();
const riders = Array.from({ length: USERS }, (_, i) => rider(i));
setTimeout(() => { stop = true; }, SECONDS * 1000);
await Promise.all(riders);

const after = await health();
const elapsed = (Date.now() - startedAt) / 1000;

const all = samples.map((s) => s.ms).sort((a, b) => a - b);
const byPath = new Map();
for (const s of samples) {
  if (!byPath.has(s.path)) byPath.set(s.path, []);
  byPath.get(s.path).push(s.ms);
}

console.log('Client-side');
console.log(`  requests        ${samples.length}  (${(samples.length / elapsed).toFixed(1)}/s)`);
console.log(`  errors          ${errors}  (${((errors / Math.max(1, samples.length)) * 100).toFixed(2)}%)`);
console.log(`  rate-limited    ${throttled}  (${((throttled / Math.max(1, samples.length)) * 100).toFixed(2)}%)`);
const codes = samples.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
console.log(`  status codes    ${Object.entries(codes).map(([c, n]) => `${c}:${n}`).join('  ')}`);
console.log(`  latency p50     ${percentile(all, 50).toFixed(0)} ms`);
console.log(`  latency p95     ${percentile(all, 95).toFixed(0)} ms`);
console.log(`  latency p99     ${percentile(all, 99).toFixed(0)} ms`);
console.log(`  slowest         ${(all[all.length - 1] || 0).toFixed(0)} ms`);

console.log('\nBy endpoint');
for (const [path, times] of [...byPath].sort((a, b) => b[1].length - a[1].length)) {
  const sorted = times.sort((a, b) => a - b);
  console.log(`  ${path.padEnd(24)} n=${String(times.length).padStart(5)}  `
    + `p50 ${percentile(sorted, 50).toFixed(0).padStart(5)} ms  p95 ${percentile(sorted, 95).toFixed(0).padStart(5)} ms`);
}

// The headline number: how much of this reached the operator.
const upstreamBefore = before?.tracker?.polls ?? 0;
const upstreamAfter = after?.tracker?.polls ?? 0;
const upstreamPolls = Math.max(0, upstreamAfter - upstreamBefore);

console.log('\nUpstream cost — the number that matters');
console.log(`  client requests served      ${samples.length}`);
console.log(`  upstream polls by tracker   ${upstreamPolls}  (${(upstreamPolls / elapsed).toFixed(2)}/s)`);
console.log(`  amplification               ${(upstreamPolls / Math.max(1, samples.length)).toFixed(3)}x`);
console.log(`  vehicles watched            ${after?.tracker?.watching ?? '?'}`);
console.log(`  server cache entries        ${after?.cacheEntries ?? '?'}`);
console.log(`  tracker backing off         ${after?.tracker?.backingOff ? 'YES — upstream unhappy' : 'no'}`);

const verdicts = [];
if (errors / Math.max(1, samples.length) > 0.01) verdicts.push('FAIL: error rate above 1%');
if (throttled / Math.max(1, samples.length) > 0.05) {
  verdicts.push('WARN: heavy rate limiting. Every virtual rider shares one IP here, which real '
    + 'users do too behind carrier NAT — check RATE_LIMIT_RPM is not set for a single person.');
}
if (percentile(all, 95) > 1500) verdicts.push('WARN: p95 above 1.5s');
if (upstreamPolls > samples.length) verdicts.push('FAIL: more upstream calls than client requests — caching is not working');
if (after?.tracker?.backingOff) verdicts.push('WARN: tracker is backing off; the upstream was returning errors');

console.log('');
if (verdicts.length) verdicts.forEach((v) => console.log(`  ${v}`));
else console.log('  All good: errors under 1%, p95 under 1.5s, upstream load well below client load.');

process.exit(verdicts.some((v) => v.startsWith('FAIL')) ? 1 : 0);

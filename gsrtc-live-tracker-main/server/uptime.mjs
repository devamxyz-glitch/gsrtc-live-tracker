/**
 * Whether the operator's API is actually answering, per method.
 *
 * This app is a window onto someone else's system, reused without an agreement, and the whole
 * thing stops working the moment that system does. When that happens the app looks broken —
 * riders blame the app, not the backend it depends on — so the point of this is to be able to
 * say "GSRTC is not answering right now" instead of showing an empty screen and no explanation.
 *
 * Rolling windows in memory rather than rows in a table: the question is "is it working *now*",
 * which needs the last few minutes, not a year of history. A restart losing it is correct — a
 * process that just started genuinely does not know yet.
 */

// At one probe a minute this is a rolling hour, which is the span an uptime figure should
// cover: long enough to survive a single blip, short enough to still mean "right now".
const WINDOW = 60;           // samples kept per method
const STALE_MS = 6 * 60 * 1000;   // six missed probes is a fault, not a quiet patch

/** Method name to something a rider could read. Unknown methods fall back to the raw name. */
const LABELS = {
  GetVehicleCurrentStatus_V1: 'Live bus positions',
  VehicleMaster_V1: 'Bus list',
  GetStationList_V1: 'Station search',
  Page_GetSourceDestinationWiseBusList_V1: 'Timetables',
  GetBusServiceTypeList: 'Service types',
  GetNearByDepotList_V1: 'Nearby stations',
  GetBusTrackerDetails_V1: 'Route and stops',
};

/** The handful that riders actually depend on, in the order they matter. */
const HEADLINE = [
  'GetVehicleCurrentStatus_V1',
  'Page_GetSourceDestinationWiseBusList_V1',
  'GetBusTrackerDetails_V1',
  'GetStationList_V1',
  'GetNearByDepotList_V1',
];

const services = new Map();

const blank = () => ({ samples: [], lastOkAt: 0, lastFailAt: 0, lastError: '', calls: 0, dataErrors: 0 });

export function record(method, ok, ms, error = '', { dataError = false } = {}) {
  const s = services.get(method) || blank();
  if (dataError) s.dataErrors = (s.dataErrors || 0) + 1;
  s.samples.push(ok ? 1 : 0);
  if (s.samples.length > WINDOW) s.samples.shift();
  s.calls += 1;
  if (ok) s.lastOkAt = Date.now();
  else { s.lastFailAt = Date.now(); s.lastError = String(error).slice(0, 120); }
  if (typeof ms === 'number') {
    s.times = s.times || [];
    s.times.push(ms);
    if (s.times.length > WINDOW) s.times.shift();
  }
  services.set(method, s);
}

function stateOf(s) {
  if (!s || !s.samples.length) return 'unknown';
  const failures = s.samples.filter((v) => v === 0).length;
  // The most recent call carries more weight than the window average: a service that has just
  // started failing is down now, whatever its hourly figure says.
  const latest = s.samples[s.samples.length - 1];
  if (latest === 0 && failures >= 3) return 'down';
  if (failures > 0) return 'degraded';
  // Every method is probed on a fixed cadence now, so a long gap since the last success means
  // the probe itself is failing to complete — which is a fault, not idleness.
  if (Date.now() - s.lastOkAt > STALE_MS) return 'degraded';
  return 'ok';
}

const median = (arr) => {
  if (!arr?.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

/**
 * What the app shows riders.
 *
 * `overall` is the worst state among the methods people actually depend on. A rarely-used
 * method failing is not an outage, and calling it one would train everyone to ignore the dot.
 */
export function snapshot() {
  const list = HEADLINE.map((method) => {
    const s = services.get(method);
    const samples = s?.samples || [];
    const failures = samples.filter((v) => v === 0).length;
    return {
      id: method,
      name: LABELS[method] || method,
      state: stateOf(s),
      uptimePct: samples.length ? Math.round(((samples.length - failures) / samples.length) * 100) : null,
      samples: samples.length,
      // The outcomes themselves, oldest first, so the app can draw a heartbeat rather than
      // quote an average. A run of failures and the same count scattered across an hour mean
      // very different things, and only the sequence shows which one happened.
      beats: samples.slice(-24),
      medianMs: median(s?.times),
      lastOkAt: s?.lastOkAt || 0,
      lastFailAt: s?.lastFailAt || 0,
    };
  });

  const rank = { down: 3, degraded: 2, idle: 1, unknown: 0, ok: 0 };
  const worst = list.reduce((acc, x) => (rank[x.state] > rank[acc] ? x.state : acc), 'ok');
  // "idle" is an absence of evidence, not a fault; it must not colour the dot amber.
  const overall = worst === 'idle' ? 'ok' : worst;

  return {
    overall,
    checkedAt: Date.now(),
    services: list,
  };
}

/** Everything, including methods not in the headline list — for the owner dashboard. */
export function all() {
  return [...services.entries()].map(([method, s]) => ({
    id: method,
    name: LABELS[method] || method,
    state: stateOf(s),
    calls: s.calls,
    // Answered-but-unusable replies. Sustained ones mean the credentials have rotated, not that
    // the operator is offline — the owner needs to see that; riders do not.
    dataErrors: s.dataErrors || 0,
    medianMs: median(s.times),
    lastError: s.lastError,
    lastOkAt: s.lastOkAt,
    lastFailAt: s.lastFailAt,
  })).sort((a, b) => b.calls - a.calls);
}

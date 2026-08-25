/**
 * Active health checks on a steady cadence.
 *
 * Every headline method is probed every cycle, whether or not real traffic has touched it. An
 * earlier version skipped anything organic requests had already exercised, which halved the
 * request cost — and produced a status panel reading "100%" from a single sample. An uptime
 * figure is only meaningful when the sampling rate is constant: percentages built on one call
 * for one service and forty for another are not comparable, and a run of green bars means
 * nothing if the gaps between them are hours.
 *
 * The cost is roughly six requests a minute against an API that serves a state's bus network,
 * which is a rounding error next to the official app's own traffic. Requests are spaced rather
 * than fired in parallel, so it never arrives as a burst.
 *
 * Probes call the upstream client directly rather than over HTTP, so `uptime` records them and
 * the usage counters never do — synthetic traffic in a usage report is a lie about how the app
 * is used.
 */

import { gsrtc, ymd } from './upstream.mjs';
import * as uptime from './uptime.mjs';

const env = process.env;

export const config = {
  enabled: env.PROBE_ENABLED !== '0',
  everyMs: Math.max(30000, Number(env.PROBE_INTERVAL_MS) || 60000),
  spacingMs: 1200,
};

/**
 * One safe, cheap call per method.
 *
 * Each is a read that the app makes constantly anyway, with arguments chosen to be as light as
 * possible — a well-known station name rather than a broad search, a single plate rather than
 * the whole fleet.
 */
const CHECKS = [
  ['GetStationList_V1', () => gsrtc.stations('Rajkot')],
  ['GetBusServiceTypeList', () => gsrtc.serviceTypes()],
  ['GetNearByDepotList_V1', () => gsrtc.nearbyStations(22.3039, 70.8022)],
  ['GetVehicleCurrentStatus_V1', () => gsrtc.vehicleStatus('GJ-18-ZT-1028')],
  // A real two-station search, kept to one small page. Rajkot to Morbi is the busiest pair in
  // the app's own numbers, so this is a query the operator serves constantly anyway.
  ['Page_GetSourceDestinationWiseBusList_V1',
    () => gsrtc.timetable({ from: '470', to: '462', date: ymd(), pageSize: '1' })],
  // Route-and-stops, using whichever service is running right now. Without this the panel
  // showed it as never checked, which is the one row a rider is most likely to care about.
  ['GetBusTrackerDetails_V1', async () => {
    const trip = liveTrip || await findLiveTrip();
    if (!trip) return null;   // nothing running at this hour is not a fault
    return gsrtc.tripDetails({ tripId: trip.tripId, status: '1', start: trip.start });
  }],
];

let timer = null;
let running = false;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

async function tick() {
  if (running) return;
  running = true;
  try {
    for (const [, run] of CHECKS) {
      // Errors are the observation, not a failure of the probe — `call()` has already recorded
      // the outcome by the time it throws.
      await run().catch(() => {});
      // Spaced rather than fired together: a burst of parallel requests is the shape of traffic
      // that gets an unofficial client noticed.
      await sleep(config.spacingMs);
    }
  } finally {
    running = false;
  }
}

/**
 * Route-and-stops needs a TripId from a service that is actually running, so it cannot be
 * probed with a fixed argument. The id is found once per cycle from a timetable the app queries
 * constantly anyway, then reused — so monitoring it costs one extra request, not two.
 */
let liveTrip = null;

async function findLiveTrip() {
  const rows = await gsrtc.timetable({ from: '470', to: '462', date: ymd(), pageSize: '40' });
  const running_ = (rows || []).find((r) => /run/i.test(String(r.BusRunningStatus || '')));
  liveTrip = running_
    ? { tripId: running_.TripId, start: running_.ArrivalTimeAtBoarding }
    : null;
  return liveTrip;
}

/**
 * Runs a cycle now, without making the caller wait.
 *
 * Called when someone opens the status panel — the one moment the answer has to be current, and
 * the worst moment to block on a backend that may be the very thing failing.
 */
export function refreshNow() {
  if (!config.enabled) return;
  tick().catch(() => {});
}

/** The trip id goes stale as services finish; re-find it every few minutes. */
setInterval(() => { liveTrip = null; }, 10 * 60 * 1000).unref();

/**
 * Fills the station gazetteer, so ids resolve to names everywhere.
 *
 * The operator's station list can only be searched by *name*, never by id — so an id arriving
 * through a saved commute or a shared link cannot be looked up on demand, and would stay a bare
 * number on the dashboard forever. Matching is by prefix (verified: "Tank" finds Tankal,
 * "ankara" finds nothing), so sweeping a-z reaches every station whose name starts with a
 * letter — about nineteen thousand of them.
 *
 * The threshold is deliberately close to that full total. A complete sweep takes a minute, and
 * every deploy restarts the process, so partial runs are the normal failure — treating 7,000
 * names as "done" is how station 8526 stayed unnamed through several attempts.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

export async function warmStations(db, { minKnown = 15000 } = {}) {
  if (!config.enabled) return;
  try {
    if (db.stations.count() >= minKnown) return;
  } catch { return; }

  const before = db.stations.count();
  for (const letter of ALPHABET) {
    try {
      const rows = await gsrtc.stations(letter);
      db.stations.learn((rows || []).map((r) => [r.StationId, r.StationName, r.StationNameGuj]));
    } catch { /* a letter with no matches is not a failure worth abandoning the rest for */ }
    await sleep(2000);
  }
  console.log(JSON.stringify({
    at: new Date().toISOString(), level: 'info', msg: 'station gazetteer warmed',
    before, after: db.stations.count(),
  }));
}

/**
 * Fills in *where* the bus stands are, so they can be drawn on a map.
 *
 * The gazetteer learns names from autocomplete and from trip responses, but names alone cannot
 * be placed. Coordinates arrive from two sources: every trip response gives its own stops, and
 * the nearby-depot call gives everything around a point. The first only ever covers stations on
 * routes somebody harvested; this covers the rest.
 *
 * A grid, because the nearby call is the only method that will answer "what is around here" —
 * there is no way to ask for a station's position by id. The spacing is set by that call's
 * reach, which measures about 10 km, so the cells overlap enough not to leave holes between
 * them.
 *
 * Deliberately slow, and resumable across restarts — it is a few thousand reads of a public
 * timetable service, which is a fraction of what the official app does in a minute, but it is
 * still someone else's API. It walks, saves its place every cell, and stops once it has enough.
 */
const GUJARAT = { south: 20.1, north: 24.7, west: 68.1, east: 74.5 };
const GRID_STEP = 0.12;          // ~13 km, inside the nearby call's reach
const GRID_SPACING_MS = Math.max(400, Number(env.STANDS_SPACING_MS) || 1000);
const GRID_CURSOR = 'stands.grid.cursor';

/** Every cell of the sweep, in a fixed order, so a saved position means the same thing later. */
function gridCells() {
  const cells = [];
  for (let lat = GUJARAT.south; lat <= GUJARAT.north; lat += GRID_STEP) {
    for (let lng = GUJARAT.west; lng <= GUJARAT.east; lng += GRID_STEP) {
      cells.push([Number(lat.toFixed(4)), Number(lng.toFixed(4))]);
    }
  }
  return cells;
}

export async function warmStandCoordinates(db, { minLocated = 4000 } = {}) {
  if (!config.enabled || env.STANDS_WARM_ENABLED === '0') return;
  try {
    if (db.stations.located() >= minLocated) return;
  } catch { return; }

  const cells = gridCells();
  // Resumed, not restarted. This sweep is the best part of an hour and every deploy restarts
  // the process — beginning from the first cell each time meant it never reached the end.
  let i = Math.max(0, Math.min(cells.length, Number(db.state.get(GRID_CURSOR, 0)) || 0));
  if (i >= cells.length) return;

  const before = db.stations.located();
  const startedAt = Date.now();
  console.log(JSON.stringify({
    at: new Date().toISOString(), level: 'info', msg: 'stand coordinate sweep resuming',
    fromCell: i, ofCells: cells.length, located: before,
  }));

  for (; i < cells.length; i += 1) {
    if (db.stations.located() >= minLocated) break;
    const [lat, lng] = cells[i];
    try {
      const rows = await gsrtc.nearbyStations(String(lat), String(lng));
      db.stations.learn((rows || []).map((r) =>
        [r.StationId, r.StationName, r.StationNameGuj, r.Center_Lat, r.Center_Lon]));
    } catch { /* an empty or failed cell is not a reason to abandon the rest of the state */ }
    // Written every cell, so the most a restart can cost is the one in flight.
    db.state.set(GRID_CURSOR, i + 1);
    await sleep(GRID_SPACING_MS);
  }

  console.log(JSON.stringify({
    at: new Date().toISOString(), level: 'info', msg: 'stand coordinate sweep paused',
    atCell: i, ofCells: cells.length, before, after: db.stations.located(),
    minutes: Math.round((Date.now() - startedAt) / 60000),
  }));
}

export function start() {
  if (!config.enabled || timer) return;
  // Not immediately on boot: a deploy restarts the process, and probing every method the moment
  // it comes up turns each release into a burst.
  setTimeout(tick, 20000).unref();
  timer = setInterval(tick, config.everyMs);
  timer.unref();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export const stats = () => ({
  enabled: config.enabled,
  everySec: Math.round(config.everyMs / 1000),
  checks: CHECKS.length,
  perDay: Math.round((86400 / (config.everyMs / 1000)) * CHECKS.length),
});

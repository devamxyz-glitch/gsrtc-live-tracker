/**
 * Builds an observed timetable from services that have already run.
 *
 * The published schedule is a plan. What a commuter needs is what actually happens — and the
 * operator's own trip feed answers that, because it reports the real time a bus reached each
 * stop it has passed. Every one of those is a free observation; nothing has to be inferred.
 *
 * Until now those observations were only recorded when a rider happened to open a route view,
 * which needs trip context that typing a plate never provides. In a full day of traffic that
 * produced none at all. This collects them deliberately instead.
 *
 * **What makes it cheap.** It harvests only routes people actually search, only services that
 * have already departed (a bus yet to leave has nothing to report), and only once per service
 * per day — the unique index on `arrivals` makes a repeat a no-op, so there is no value in
 * asking twice. A busy route yields its whole day for roughly one request per service.
 *
 */

import { gsrtc, ymd } from './upstream.mjs';
import * as tracker from './tracker.mjs';

const env = process.env;

export const config = {
  enabled: env.HARVEST_ENABLED !== '0',
  // Running more often does not multiply the work: a service already harvested is refused by
  // the unique index, so the day's total is bounded by how many *distinct* services run on the
  // chosen routes — a few hundred — however frequently the loop wakes up. A shorter interval
  // just spreads that same work out and catches each service sooner after it finishes.
  everyMs: Math.max(60000, Number(env.HARVEST_INTERVAL_MS) || 2 * 60000),
  routes: Math.max(1, Number(env.HARVEST_ROUTES) || 10),
  perRun: Math.max(1, Number(env.HARVEST_PER_RUN) || 15),
  spacingMs: 1200,
  /**
   * Keep the pinned corridor's running buses on the live tracker.
   *
   * The timetable this already fetches says which services are running right now, so knowing
   * their plates costs nothing extra — only the position polls themselves, which is the point.
   * Capped, because the tracker is a budget against somebody else's API and an unbounded watch
   * list is exactly the fleet-wide polling the rest of this codebase refuses to do.
   */
  trackPinned: env.HARVEST_TRACK_PINNED !== '0',
  trackMax: Math.max(0, Number(env.HARVEST_TRACK_MAX) || 25),
  // Exploring costs one timetable query per pair plus the trips it finds. Kept small: it runs
  // every two minutes for ever, so it does not need to be fast to get everywhere.
  explore: env.HARVEST_EXPLORE !== '0',
  // Six pairs, both directions, two trips each: about thirty requests a cycle on top of the
  // timekeeping routes, which mostly skip once they have been read. Walking the geocoded list
  // two at a time would have taken most of a day to get round it.
  explorePerRun: Math.max(1, Number(env.HARVEST_EXPLORE_PER_RUN) || 6),
  exploreTrips: Math.max(1, Number(env.HARVEST_EXPLORE_TRIPS) || 2),
};

let timer = null;
let running = false;
const counters = { runs: 0, trips: 0, arrivals: 0, errors: 0, watched: 0, located: 0 };

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

/** Minutes since midnight IST, for comparing against a timetable's clock times. */
const IST_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function nowMinutesIST() {
  const [h, m] = IST_CLOCK.format(new Date()).split(':').map(Number);
  return h * 60 + m;
}

function clockToMinutes(value) {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])M/i.exec(String(value || '').trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (/p/i.test(m[3])) hour += 12;
  return hour * 60 + Number(m[2]);
}

/**
 * Routes that are always harvested, whatever the day's popularity looks like.
 *
 * Morbi and Rajkot in both directions: it is the corridor this app's community actually rides,
 * and leaving it to popularity meant it could be missed on a quiet morning or straight after a
 * restart, when the day's metrics are still empty. A timetable is only worth building if it is
 * built every day without a gap — one missing day is a hole in every median that follows.
 */
const PINNED = (env.HARVEST_PINNED || '470>462,462>470')
  .split(',').map((pair) => pair.trim().split('>'))
  .filter(([from, to]) => /^\d+$/.test(from || '') && /^\d+$/.test(to || ''));

/**
 * The station pairs worth harvesting: the pinned corridor first, then whatever people are
 * actually searching. Popularity is the right selector for the rest — an observed timetable
 * for a route nobody travels helps nobody.
 */
function topRoutes(db, limit) {
  const seen = new Set();
  const out = [];
  const add = ([from, to]) => {
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([from, to]);
  };

  PINNED.forEach(add);
  db.metrics.top('route', { day: db.today(), limit: limit * 2 })
    .map((r) => String(r.key).split('>'))
    .filter(([from, to]) => /^\d+$/.test(from) && /^\d+$/.test(to))
    .forEach(add);

  return out.slice(0, Math.max(limit, PINNED.length));
}

/**
 * A couple of routes nobody asked for, so the map can learn where the villages are.
 *
 * Only the trip feed knows where a village stop is — the nearby-depot call answers with depots
 * and nothing else, which is why a geographic sweep tops out around five hundred places out of
 * nineteen thousand names. A trip, by contrast, geocodes every stop along its way.
 *
 * So the harvester explores. The grid sweep walks Gujarat in order, so consecutive entries in
 * the geocoded list are neighbouring towns, and asking the timetable for a service between two
 * of them usually finds one — whose trip then places every village in between. Pairs that carry
 * no service cost a single cheap query and are simply skipped.
 *
 * Two pairs a cycle, cursor kept in the database so a restart continues rather than restarting.
 */
/**
 * The far ends of the network, for pairing anchors against.
 *
 * Verified ids: Rajkot 470, Ahmedabad 464, Surat 505, Bhuj 594, Junagadh 1052, Jamnagar 497,
 * Bhavnagar 595, Palanpur 576, Godhra 529. Spread deliberately across the state so that
 * whichever anchor comes up, at least one hub is a long way from it.
 */
const HUBS = (env.HARVEST_HUBS || '470,464,505,594,1052,497,595,576,529')
  .split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x));

/** Rough distance in degrees; only ever used to pick the *further* of two options. */
const spread = (a, b) => Math.hypot((a.lat ?? 0) - (b.lat ?? 0), (a.lng ?? 0) - (b.lng ?? 0));

function explorePairs(db) {
  if (!config.explore || !HUBS.length) return [];
  try {
    const seq = db.stations.toExplore(config.explorePerRun);
    if (!seq.length) return [];

    // Paired against a *distant* hub, not the next station along.
    //
    // Adjacent geocoded stations are neighbours by construction, so the service between them is
    // short and stops only at places both ends already told us about — 120 anchors explored that
    // way added two new positions. A village-to-hub service crosses the whole intervening
    // country and names every stop on the way, which is where the unknown ones are.
    const hubs = db.stations.positions(HUBS);
    const pairs = [];
    for (const anchor of seq) {
      const far = hubs
        .filter((h) => String(h.id) !== String(anchor.id))
        .sort((a, b) => spread(b, anchor) - spread(a, anchor))[0];
      if (!far) continue;
      pairs.push([anchor.id, String(far.id)]);
      pairs.push([String(far.id), anchor.id]);   // the return serves a different set of villages
    }
    return pairs;
  } catch {
    return [];
  }
}

/**
 * Services on this route that have already left, most recently first.
 *
 * A bus still to depart has reported nothing yet, and one that left ten hours ago was harvested
 * on an earlier pass. The window keeps each run to services whose data is both complete and new.
 */
function departedRecently(rows, { minAgo = 3, maxAgo = 900 } = {}) {
  const now = nowMinutesIST();
  return rows
    .map((row) => ({ row, at: clockToMinutes(row.ArrivalTime) }))
    .filter(({ row, at }) => {
      if (at == null || !row.TripId || !row.BusNo) return false;
      // Wrapped, because the clock does. At 00:15 a bus that left at 23:45 is fifteen minutes
      // in the past, not fourteen hundred in the future — and the plain subtraction made every
      // late-night service invisible to the harvester, permanently.
      const ago = ((now - at) + 1440) % 1440;
      return ago >= minAgo && ago <= maxAgo;
    })
    .sort((a, b) => (((now - a.at) + 1440) % 1440) - (((now - b.at) + 1440) % 1440))
    .map(({ row }) => row);
}

const IS_RUNNING = /run|progress|track/i;

async function harvestRoute(db, from, to, {
  pinned = false, running_ = null, maxTrips = config.perRun, wantRunning = false,
} = {}) {
  const rows = await gsrtc.timetable({ from, to, date: ymd(), pageSize: '80' });

  if (pinned && running_) collectRunning(rows || [], running_);

  // Exploring wants a trip the operator will actually describe. `GetBusTrackerDetails_V1` only
  // answers for a service that is running *now* — a bus that finished this morning returns
  // nothing — so selecting "departed recently" fetched trips that were always going to be
  // empty. For timetable-building, departed is still the right filter; those rows are the
  // record of what already happened.
  if (wantRunning) {
    const live = (rows || []).filter((r) => IS_RUNNING.test(String(r.BusRunningStatus || '')));
    const done = db.arrivals.harvested(
      live.map((r) => String(r.BusNo || '').trim()).filter(Boolean), ymd(),
    );
    return harvestTrips(db, live.filter((r) => !done.has(String(r.BusNo || '').trim())).slice(0, maxTrips));
  }

  // Ask the database what it already has before asking the operator for it again. Without this
  // the same fifteen recently-departed services were re-fetched every couple of minutes, their
  // rows refused by the unique index, and the rest of the day never reached.
  const departed = departedRecently(rows || []);
  const done = db.arrivals.harvested(
    departed.map((r) => String(r.BusNo || '').trim()).filter(Boolean), ymd(),
  );
  return harvestTrips(db, departed
    .filter((r) => !done.has(String(r.BusNo || '').trim()))
    .slice(0, maxTrips));
}

async function harvestTrips(db, candidates) {
  for (const row of candidates) {
    const plate = String(row.BusNo || '').trim();
    const route = String(row.RouteName || '').trim();
    if (!plate || !route) continue;
    // The scheduled departure is what identifies this service among all the others on the route.
    const schedMin = clockToMinutes(row.ArrivalTime);

    try {
      const stops = await gsrtc.tripDetails({
        tripId: row.TripId, status: '1', start: row.ArrivalTimeAtBoarding,
      });
      counters.trips += 1;

      // Every stop on this trip, with its position — learned before the arrivals loop, because
      // that loop skips stops the bus has not reached yet and those need placing on a map just
      // as much. This is the fastest source of stand coordinates the app has: a couple of
      // hundred trips an hour, ten to twenty geocoded stops each, and not one extra request,
      // since the response is already in hand. The grid sweep only reaches what the
      // nearby-depot call knows; this reaches the village stops it does not.
      counters.located += db.stations.learn((stops || []).map((stop) =>
        [stop.LocationId, stop.LocationName, stop.LocationNameGuj,
          stop.LocationLat, stop.LocationLong]));

      for (const stop of stops || []) {
        const arrivedMin = clockToMinutes(stop.ArrivedTime);
        const stopName = String(stop.LocationName || '').trim();
        if (arrivedMin === null || !stopName) continue;
        // A repeat for the same bus, stop and day is refused by the unique index, so a service
        // seen on an earlier pass costs nothing but the insert attempt.
        if (db.arrivals.record({
          plate, route, stopName, serviceDay: ymd(), arrivedMin, schedMin,
        })) counters.arrivals += 1;
      }
    } catch {
      counters.errors += 1;
    }
    await sleep(config.spacingMs);
  }
}

/**
 * Puts every bus currently running the pinned corridor on the live tracker.
 *
 * Tracking is otherwise demand-driven — a plate is polled only while somebody is looking at it,
 * and dropped five minutes after the last interest. That is the right default for the fleet, but
 * it means the corridor this app was built for is only observed when somebody happens to have it
 * open. Re-asserting interest on every cycle keeps those buses continuously watched, which is
 * what turns a scatter of sightings into a position history.
 *
 * The plates come out of a timetable already being fetched, so this adds no request of its own.
 */
function collectRunning(rows, into) {
  if (!config.trackPinned) return;
  for (const row of rows) {
    if (into.size >= config.trackMax) return;
    if (!/run|progress|track/i.test(String(row.BusRunningStatus || ''))) continue;
    const plate = String(row.BusNo || '').trim().toUpperCase();
    if (plate) into.add(plate);
  }
}

async function tick(db) {
  if (running) return;
  running = true;
  counters.runs += 1;
  try {
    const pinnedKeys = new Set(PINNED.map(([f, t]) => `${f}>${t}`));
    // One set for the whole cycle: trackMax is a total budget, and applying it per route let
    // two pinned directions spend it twice over.
    const running_ = new Set();
    const routes = topRoutes(db, config.routes);
    const known = new Set(routes.map(([f, t]) => `${f}>${t}`));
    // Composed here rather than inferred from a slice index: `routes` can be shorter than the
    // limit on a quiet day, and then the index would cut in the wrong place.
    const exploring = new Set();
    for (const [from, to] of explorePairs(db)) {
      const key = `${from}>${to}`;
      if (known.has(key)) continue;
      known.add(key);
      exploring.add(key);
      routes.push([from, to]);
    }
    for (const [from, to] of routes) {
      const key = `${from}>${to}`;
      try {
        await harvestRoute(db, from, to, {
          pinned: pinnedKeys.has(key),
          running_,
          // One trip already names every stop on the line, which is all an explore route is for.
          maxTrips: exploring.has(key) ? config.exploreTrips : config.perRun,
          // Explore routes exist to learn where stops are, and only a running trip will say.
          wantRunning: exploring.has(key),
        });
      } catch {
        counters.errors += 1;
      }
      await sleep(config.spacingMs);
    }
    if (running_.size) {
      tracker.watch([...running_]);
      counters.watched = running_.size;
    }
  } finally {
    running = false;
  }
}

export function start(db) {
  if (!config.enabled || timer) return;
  progressDb = db;
  // Well after boot, so a deploy is never a burst.
  setTimeout(() => tick(db).catch(() => {}), 90000).unref();
  timer = setInterval(() => tick(db).catch(() => {}), config.everyMs);
  timer.unref();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

let progressDb = null;
const exploreProgress = () => {
  try { return progressDb ? progressDb.stations.exploreProgress() : null; } catch { return null; }
};

export const stats = () => ({
  enabled: config.enabled,
  everyMin: Math.round(config.everyMs / 60000),
  routes: config.routes,
  ...counters,
  ...(exploreProgress() || {}),
});

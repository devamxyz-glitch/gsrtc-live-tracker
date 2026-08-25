/**
 * Fills in bus stand positions from Google's Geocoding API.
 *
 * **Licensing, stated plainly because it is not a detail.** Google Maps Platform terms require
 * that geocoding results be displayed on a Google map, and restrict caching the lat/lng values
 * at all. This app renders CARTO tiles and keeps a permanent shared gazetteer, so using this
 * breaches both clauses. The owner was told, twice, and chose to run it anyway; it is their key
 * and their account, and the realistic consequence is that Google revokes the key.
 *
 * Two things follow from that, and both are deliberate:
 *   - It is **off** unless `GOOGLE_GEOCODING_KEY` is set. Nothing here runs by accident.
 *   - Everything it writes is stamped `source = 'google'`, so `stations.forgetSource('google')`
 *     removes all of it in one statement if that day comes. Positions learned from the
 *     operator's own trip feed are untouched by that, because those are ours to keep.
 *
 * The operator's feed remains the better source where it reaches: it gives the exact stop the
 * buses actually use, not a geocoder's guess at a village centre. This only ever fills in the
 * stations that feed has not reached.
 */

const env = process.env;

export const config = {
  key: env.GOOGLE_GEOCODING_KEY || '',
  get enabled() { return Boolean(this.key); },
  // Google bills per request beyond its free allowance, so this is a budget, not a rate limit.
  perRun: Math.max(1, Number(env.GEOCODE_PER_RUN) || 40),
  everyMs: Math.max(60000, Number(env.GEOCODE_INTERVAL_MS) || 10 * 60000),
  spacingMs: Math.max(50, Number(env.GEOCODE_SPACING_MS) || 250),
  dailyCap: Math.max(0, Number(env.GEOCODE_DAILY_CAP) || 300),
};

/** Gujarat, generously drawn. A geocoder that lands outside it has matched the wrong place. */
const BOUNDS = { south: 20.0, north: 24.8, west: 68.1, east: 74.6 };
const DAY_KEY = 'geocode.day';
const COUNT_KEY = 'geocode.count';

let timer = null;
let running = false;
const counters = { runs: 0, asked: 0, placed: 0, missed: 0, errors: 0 };

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

/**
 * How many requests are left today.
 *
 * A cap that resets on a date, kept in the database rather than in memory, because the process
 * restarts on every deploy and an in-memory counter would hand out a fresh allowance each time.
 */
function budgetLeft(db) {
  const today = db.today();
  if (db.state.get(DAY_KEY) !== today) {
    db.state.set(DAY_KEY, today);
    db.state.set(COUNT_KEY, 0);
  }
  return config.dailyCap - (Number(db.state.get(COUNT_KEY, 0)) || 0);
}

function spend(db, n) {
  db.state.set(COUNT_KEY, (Number(db.state.get(COUNT_KEY, 0)) || 0) + n);
}

/**
 * One station name to a position.
 *
 * The name is qualified with the state and country and the search is bounded, because "Rai" or
 * "Un" on their own match places across the world. `components` is a hard filter rather than a
 * hint, so a result outside Gujarat is not returned at all.
 */
async function geocodeOne(name) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', `${name} bus station, Gujarat, India`);
  url.searchParams.set('components', 'administrative_area:Gujarat|country:IN');
  url.searchParams.set('bounds', `${BOUNDS.south},${BOUNDS.west}|${BOUNDS.north},${BOUNDS.east}`);
  url.searchParams.set('key', config.key);

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`geocode: unreadable reply (HTTP ${res.status})`);

  // OVER_QUERY_LIMIT and REQUEST_DENIED are worth stopping for; ZERO_RESULTS simply is not.
  if (body.status === 'ZERO_RESULTS') return null;
  if (body.status !== 'OK') throw new Error(`geocode: ${body.status} ${body.error_message || ''}`.trim());

  const loc = body.results?.[0]?.geometry?.location;
  if (!loc) return null;
  const { lat, lng } = loc;
  if (lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) return null;
  return { lat, lng };
}

async function tick(db) {
  if (running || !config.enabled) return;
  running = true;
  counters.runs += 1;
  try {
    const budget = Math.min(config.perRun, budgetLeft(db));
    if (budget <= 0) return;

    const todo = db.stations.unplaced(budget);
    for (const station of todo) {
      let at = null;
      try {
        at = await geocodeOne(station.name);
        counters.asked += 1;
        spend(db, 1);
      } catch (e) {
        counters.errors += 1;
        // A denied key or an exhausted quota will not fix itself inside this run; stopping is
        // the difference between one logged failure and forty.
        console.warn(JSON.stringify({
          at: new Date().toISOString(), level: 'warn', msg: 'geocode failed', error: e.message,
        }));
        break;
      }

      // Recorded whether or not it resolved. A name Google cannot place would otherwise come
      // back to the top of the queue on every run and be paid for again each time.
      db.stations.markGeocodeTried(station.id);
      if (at) {
        db.stations.learn([[station.id, station.name, '', at.lat, at.lng]], 'google');
        counters.placed += 1;
      } else {
        counters.missed += 1;
      }
      await sleep(config.spacingMs);
    }
  } finally {
    running = false;
  }
}

export function start(db) {
  if (!config.enabled || timer) return;
  console.log(JSON.stringify({
    at: new Date().toISOString(), level: 'info', msg: 'google geocoding enabled',
    dailyCap: config.dailyCap, perRun: config.perRun,
  }));
  setTimeout(() => tick(db).catch(() => {}), 120000).unref();
  timer = setInterval(() => tick(db).catch(() => {}), config.everyMs);
  timer.unref();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export const stats = () => ({ enabled: config.enabled, dailyCap: config.dailyCap, ...counters });

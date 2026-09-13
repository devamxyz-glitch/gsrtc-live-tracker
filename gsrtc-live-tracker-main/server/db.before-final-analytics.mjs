/**
 * The app's first piece of real state.
 *
 * Everything until now lived in the browser or in memory, which was the right call while the
 * app only ever answered "where is this bus". Push notifications, on-time history and crowd
 * reports all need something that outlives a request and a restart — and all three need the
 * same thing, so they share one small SQLite file.
 *
 * `node:sqlite` ships with Node, so this stays dependency-free. It is marked experimental on
 * Node 22 (the deploy target); the API used here is only the boring part of it — prepare,
 * run, get, all — and the file format is plain SQLite, so nothing is trapped if it changes.
 *
 * Privacy: no accounts, no names, no device identifiers. A push subscription is an opaque
 * endpoint URL the browser gave us, and a crowd report stores a *hash* of the reporter's IP
 * (salted, truncated) purely to rate-limit abuse — never the address itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.DB_FILE || path.join(PROJECT_ROOT, '.data', 'st-tracker.db');

// A per-install secret so IP hashes cannot be reversed with a rainbow table, and cannot be
// correlated with hashes from any other deployment.
const IP_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString('hex');

let db = null;

export function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  db = new DatabaseSync(FILE);

  // WAL keeps readers from blocking on the writer, which matters because the tracker writes
  // arrivals on its own loop while requests are being served.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  // Off by default in SQLite, which makes every ON DELETE CASCADE in the schema decorative:
  // removing a push subscription left its alerts behind as rows pointing at nothing.
  db.exec('PRAGMA foreign_keys = ON');
  migrate();
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id          INTEGER PRIMARY KEY,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_ok_at  INTEGER,
      failures    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id            INTEGER PRIMARY KEY,
      sub_id        INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      plate         TEXT NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      lat           REAL NOT NULL,
      lng           REAL NOT NULL,
      radius_km     REAL NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      fired_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS alerts_pending ON alerts (plate) WHERE fired_at IS NULL;

    /*
     * One row per stop a bus was actually observed reaching, as clock minutes past midnight.
     *
     * Not a delay: the operator rewrites a stop's ETA to the actual time once the bus passes
     * it, so its feed contains no fixed schedule to measure against. What it does contain is
     * the truth about when the bus really got there. Enough of those and the *typical* arrival
     * at a stop emerges from the data itself — which is a better answer than the timetable
     * anyway, and one the operator cannot give you.
     */
    CREATE TABLE IF NOT EXISTS arrivals (
      id            INTEGER PRIMARY KEY,
      plate         TEXT NOT NULL,
      route         TEXT NOT NULL DEFAULT '',
      stop_name     TEXT NOT NULL,
      service_day   TEXT NOT NULL,
      arrived_min   INTEGER NOT NULL,
      sched_min     INTEGER NOT NULL DEFAULT -1,
      observed_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS arrivals_lookup ON arrivals (route, stop_name);
    CREATE UNIQUE INDEX IF NOT EXISTS arrivals_once
      ON arrivals (plate, service_day, stop_name);

    CREATE TABLE IF NOT EXISTS reports (
      id            INTEGER PRIMARY KEY,
      plate         TEXT NOT NULL,
      kind          TEXT NOT NULL,
      route         TEXT NOT NULL DEFAULT '',
      service_day   TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      reporter      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_recent ON reports (plate, created_at);
  `);

  // `reports` shipped before occupancy and replacements existed, so live databases have the
  // table without these columns. ALTER is additive and safe to re-run behind the pragma check;
  // recreating the table would throw away every report already collected.
  db.exec(`
    /* Per-device analytics.
       The device column holds a random identifier the app generates and stores locally. It is
       not derived from anything about the person or the hardware, is resettable from Settings,
       and is the only thread linking one visit to another. There is deliberately no location
       column: a feature trail keyed to a device is pseudonymous, but a movement trail is not --
       home and work re-identify someone with no name attached anywhere. */
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      device      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      last_at     INTEGER NOT NULL,
      day         TEXT NOT NULL,
      platform    TEXT NOT NULL DEFAULT '',
      standalone  INTEGER NOT NULL DEFAULT 0,
      lang        TEXT NOT NULL DEFAULT '',
      entry       TEXT NOT NULL DEFAULT '',
      events      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sessions_day ON sessions (day);
    CREATE INDEX IF NOT EXISTS sessions_device ON sessions (device, day);

    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY,
      session  TEXT NOT NULL,
      device   TEXT NOT NULL,
      name     TEXT NOT NULL,
      detail   TEXT NOT NULL DEFAULT '',
      at       INTEGER NOT NULL,
      day      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_session ON events (session, at);
    CREATE INDEX IF NOT EXISTS events_day ON events (day, name);

    /* A local gazetteer of station id to name, learned from responses that happen to carry
       both. Station ids are what requests are made with, so without this the dashboard can
       only report that "470>462" was popular, which tells the owner nothing. */
    CREATE TABLE IF NOT EXISTS stations (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      name_gu  TEXT NOT NULL DEFAULT '',
      seen_at  INTEGER NOT NULL
    );

    -- Small durable notes the server keeps for itself: how far a long sweep got, and the like.
    -- Not analytics and not about anyone; nothing here is keyed on a person or a device.
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      day   TEXT NOT NULL,
      kind  TEXT NOT NULL,
      key   TEXT NOT NULL,
      n     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, kind, key)
    );
  `);

  // `arrivals` shipped with `delay_min NOT NULL`, before it was understood that the operator
  // rewrites ETA to the actual arrival time — which makes a delay against that schedule
  // meaningless, and the observed clock time the only thing worth storing. The column was
  // renamed in code, but CREATE TABLE IF NOT EXISTS never alters an existing table, so every
  // live database kept the old shape and every insert failed on the missing column.
  //
  // Nothing surfaced because `record()` returns false instead of throwing: on-time history had
  // been collecting *nothing at all* since the day it shipped, while reporting no error.
  //
  // Rebuilt rather than ALTERed: the old NOT NULL column would reject new inserts too, and a
  // delay cannot be converted back into an arrival time, so there is nothing to carry across.
  if (!hasColumn('arrivals', 'arrived_min')) {
    const lost = db.prepare('SELECT COUNT(*) AS n FROM arrivals').get().n;
    db.exec('DROP TABLE arrivals');
    db.exec(`
      CREATE TABLE arrivals (
        id            INTEGER PRIMARY KEY,
        plate         TEXT NOT NULL,
        route         TEXT NOT NULL DEFAULT '',
        stop_name     TEXT NOT NULL,
        service_day   TEXT NOT NULL,
        arrived_min   INTEGER NOT NULL,
        observed_at   INTEGER NOT NULL
      );
      CREATE INDEX arrivals_lookup ON arrivals (route, stop_name);
      CREATE UNIQUE INDEX arrivals_once ON arrivals (plate, service_day, stop_name);
    `);
    if (lost) console.warn(`arrivals: rebuilt schema, discarded ${lost} unusable delay rows`);
  }

  // Which *service* an observation belongs to, as minutes since midnight of its scheduled
  // departure. Without it every service on a route was pooled into one median, and the median of
  // eight buses leaving between 07:15 and 21:42 is 10:11 — a time no bus ever arrives. Rows
  // recorded before this keep -1 and are simply never matched; they age out of the 60-day window.
  // Where each bus stand actually is. Every trip response names its stops *and* gives their
  // coordinates; only the names were being kept, so the app knew 19,000 stand names and could
  // not put one on a map. Learned from traffic already happening — no extra upstream request.
  addColumn('stations', 'lat', 'REAL');
  addColumn('stations', 'lng', 'REAL');
  // Marks a geocoded station the route explorer has already used as an anchor. An OFFSET cursor
  // cannot do this job: `learn()` refreshes `seen_at` every time a station is re-seen, so the
  // list it was counting into reshuffled under it, revisiting some and skipping others.
  addColumn('stations', 'explored_at', 'INTEGER');
  // Where a coordinate came from. Kept because the sources have different licences: the
  // operator's own trip feed is ours to keep, Google's is not, and if that data ever has to go
  // it must be one delete rather than a forensic exercise.
  addColumn('stations', 'source', "TEXT NOT NULL DEFAULT 'operator'");
  // When the geocoder last tried this station, whether or not it found anything. Without it a
  // name the geocoder cannot resolve is asked about again on every run, for ever — which for a
  // billed API is not a bug that stays small.
  addColumn('stations', 'geocode_tried_at', 'INTEGER');

  addColumn('arrivals', 'sched_min', 'INTEGER NOT NULL DEFAULT -1');
  // After the column exists, never in the CREATE block: on a database that predates it, an index
  // naming sched_min fails outright and takes the whole migration — and therefore boot — with it.
  db.exec(`CREATE INDEX IF NOT EXISTS arrivals_service
           ON arrivals (route, sched_min, stop_name);`);

  addColumn('reports', 'level', 'INTEGER');
  addColumn('reports', 'headcount', 'INTEGER');
  addColumn('reports', 'detail', "TEXT NOT NULL DEFAULT ''");

  // Reports collected under the old four-kind scheme. Without this they keep level = NULL and
  // are read as *status* reports, so a bus someone called full would quietly count as neither
  // full nor anything else. 'full' and 'seats' map onto the new scale; 'no_show' is the same
  // claim 'cancelled' now makes; 'departed' kept its name and needs nothing.
  db.exec(`UPDATE reports SET level = ${OCCUPANCY.full}  WHERE kind = 'full'  AND level IS NULL`);
  db.exec(`UPDATE reports SET level = ${OCCUPANCY.seats} WHERE kind = 'seats' AND level IS NULL`);
  db.exec("UPDATE reports SET kind = 'cancelled' WHERE kind = 'no_show'");
}

function hasColumn(table, name) {
  return db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?')
    .get(table, name).n > 0;
}

function addColumn(table, name, decl) {
  const present = db.prepare(
    'SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?',
  ).get(table, name).n;
  if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
}

const stmt = (sql) => open().prepare(sql);

/**
 * A coordinate, or null.
 *
 * The operator sends "0", "" and "N/A" for stops it has no position for, and a literal 0,0 would
 * put a bus stand in the Atlantic. Bounds are Gujarat's, generously drawn — a stop outside them
 * is bad data rather than a stand this app will ever show.
 */
function validCoord(value, max, min) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n >= min && n <= max ? n : null;
}

/** Salted, truncated hash — enough to rate-limit one reporter, useless for identifying them. */
export function reporterHash(ip) {
  return crypto.createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ subscriptions */
export const subscriptions = {
  upsert({ endpoint, p256dh, auth }) {
    stmt(`INSERT INTO subscriptions (endpoint, p256dh, auth, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
                                              failures = 0`)
      .run(endpoint, p256dh, auth, Date.now());
    return stmt('SELECT id FROM subscriptions WHERE endpoint = ?').get(endpoint).id;
  },
  remove(endpoint) {
    stmt('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
  },
  markFailure(id) {
    stmt('UPDATE subscriptions SET failures = failures + 1 WHERE id = ?').run(id);
    // A browser that has told us it is gone, or repeatedly refused us, is never coming back.
    stmt('DELETE FROM subscriptions WHERE id = ? AND failures >= 5').run(id);
  },
  markOk(id) {
    stmt('UPDATE subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?').run(Date.now(), id);
  },
  count: () => stmt('SELECT COUNT(*) AS n FROM subscriptions').get().n,
};

/* ------------------------------------------------------------------ alerts */
const ALERT_TTL_MS = 6 * 60 * 60 * 1000;   // nobody waits for a bus longer than this

export const alerts = {
  add({ subId, plate, label, lat, lng, radiusKm }) {
    // One live alert per bus per subscriber; asking again replaces the old one.
    stmt('DELETE FROM alerts WHERE sub_id = ? AND plate = ? AND fired_at IS NULL').run(subId, plate);
    stmt(`INSERT INTO alerts (sub_id, plate, label, lat, lng, radius_km, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(subId, plate, label || '', lat, lng, radiusKm || 1, Date.now(), Date.now() + ALERT_TTL_MS);
  },
  removeFor(subId, plate) {
    stmt('DELETE FROM alerts WHERE sub_id = ? AND plate = ?').run(subId, plate);
  },
  /** Every plate with at least one alert waiting — this is what the tracker must watch. */
  pendingPlates() {
    return stmt(`SELECT DISTINCT plate FROM alerts
                 WHERE fired_at IS NULL AND expires_at > ?`).all(Date.now()).map((r) => r.plate);
  },
  pendingFor(plate) {
    return stmt(`SELECT a.*, s.endpoint, s.p256dh, s.auth
                 FROM alerts a JOIN subscriptions s ON s.id = a.sub_id
                 WHERE a.plate = ? AND a.fired_at IS NULL AND a.expires_at > ?`)
      .all(plate, Date.now());
  },
  markFired(id) {
    stmt('UPDATE alerts SET fired_at = ? WHERE id = ?').run(Date.now(), id);
  },
  sweep() {
    stmt('DELETE FROM alerts WHERE expires_at < ? OR fired_at < ?')
      .run(Date.now(), Date.now() - 24 * 3600 * 1000);
  },
  pendingCount: () => stmt('SELECT COUNT(*) AS n FROM alerts WHERE fired_at IS NULL').get().n,
};

/* ------------------------------------------------------------------ on-time history */
export const arrivals = {
  /** Ignores a repeat for the same bus, day and stop — a trip is fetched many times a day. */
  record({ plate, route, stopName, serviceDay, arrivedMin, schedMin = -1 }) {
    if (!Number.isFinite(arrivedMin)) return false;
    try {
      stmt(`INSERT INTO arrivals
              (plate, route, stop_name, service_day, arrived_min, sched_min, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(plate, route || '', stopName, serviceDay, Math.round(arrivedMin),
          Number.isFinite(schedMin) ? Math.round(schedMin) : -1, Date.now());
      return true;
    } catch (e) {
      // A duplicate is the expected case — a trip is fetched many times a day and the unique
      // index is what makes that idempotent. Anything else is a real fault, and swallowing it
      // silently is precisely how a broken schema went unnoticed for a whole day of traffic.
      if (!/UNIQUE|constraint/i.test(e.message || '')) {
        console.error(JSON.stringify({
          at: new Date().toISOString(), level: 'error',
          msg: 'arrivals insert failed', error: e.message,
        }));
      }
      return false;
    }
  },

  /**
   * When this service *typically* reaches this stop, from observation.
   *
   * Reports the median rather than the mean: one bus stuck behind an accident for two hours
   * should not move the number people plan around. Returns null below a sample size worth
   * quoting — "usually twelve minutes late" from a single sighting is a guess wearing a
   * fact's coat.
   */
  /**
   * Which of these buses already have observations recorded for a day.
   *
   * The harvester re-reads the same recently-departed services every couple of minutes, and the
   * unique index refuses the duplicate rows — but only *after* a trip has been fetched. Asking
   * first turns that into no request at all, which is the difference between re-reading fifteen
   * services forever and moving on to cover the rest of the day.
   */
  harvested(plates, serviceDay) {
    const wanted = [...new Set((plates || []).map(String).filter(Boolean))];
    if (!wanted.length) return new Set();
    const rows = stmt(`SELECT DISTINCT plate FROM arrivals
                       WHERE service_day = ?
                         AND plate IN (SELECT value FROM json_each(?))`)
      .all(serviceDay, JSON.stringify(wanted));
    return new Set(rows.map((r) => r.plate));
  },

  /**
   * When one particular service usually reaches one stop.
   *
   * Keyed on the scheduled departure as well as the route, because a route is not a bus. The
   * 06:40 and the 21:10 are different services that reach the same stop fifteen hours apart, and
   * pooling them produced a "typical arrival" in the middle of the day that matched neither.
   */
  reputation(route, stopName, schedMin, { minSamples = 5, days = 60 } = {}) {
    if (!Number.isFinite(schedMin) || schedMin < 0) return null;
    const rows = stmt(`SELECT arrived_min FROM arrivals
                       WHERE route = ? AND stop_name = ? AND sched_min = ? AND observed_at > ?
                       ORDER BY arrived_min`)
      .all(route, stopName, Math.round(schedMin), Date.now() - days * 86400000);
    if (rows.length < minSamples) return null;

    const values = rows.map((r) => r.arrived_min);
    const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
    const median = at(0.5);
    return {
      samples: values.length,
      typicalArrivalMin: median,
      earliestMin: values[0],
      latestMin: values[values.length - 1],
      // How tightly the service clusters. A wide spread means the timetable is a suggestion.
      spreadMin: at(0.9) - at(0.1),
    };
  },
  /** Every stop on a route we have enough observations for, in one query. */
  reputationForRoute(route, schedMin, { minSamples = 5, days = 60 } = {}) {
    if (!Number.isFinite(schedMin) || schedMin < 0) return {};
    const rows = stmt(`SELECT stop_name, arrived_min FROM arrivals
                       WHERE route = ? AND sched_min = ? AND observed_at > ?
                       ORDER BY stop_name, arrived_min`)
      .all(route, Math.round(schedMin), Date.now() - days * 86400000);

    const byStop = new Map();
    for (const row of rows) {
      if (!byStop.has(row.stop_name)) byStop.set(row.stop_name, []);
      byStop.get(row.stop_name).push(row.arrived_min);
    }

    const out = {};
    for (const [stop, values] of byStop) {
      if (values.length < minSamples) continue;
      const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
      out[stop] = {
        samples: values.length,
        typicalArrivalMin: at(0.5),
        spreadMin: at(0.9) - at(0.1),
      };
    }
    return out;
  },
  count: () => stmt('SELECT COUNT(*) AS n FROM arrivals').get().n,
};

/* ------------------------------------------------------------------ crowd reports */
/**
 * How full the bus is, as one ordered axis.
 *
 * Riders cannot count seats from the door, so the scale is what someone can actually judge in
 * the two seconds before boarding — and each rung names the thing they would have counted
 * anyway ("a few standing", "ten or more standing"). Being ordered is what makes the reports
 * combinable: five people tapping different rungs produce a median, where five unrelated
 * labels would only produce an argument.
 */
export const OCCUPANCY = {
  empty: 1,        // plenty of seats
  seats: 2,        // a few seats left
  standing: 3,     // no seats, a few standing
  crowded: 4,      // ten or more standing
  full: 5,         // cannot board
};

/**
 * What happened to the service itself, which is a different question from how full it is —
 * a cancelled bus has no occupancy, and a replaced one moves the answer to another plate.
 * Kept on its own axis so neither can drown out the other in a single count.
 */
export const STATUS_KINDS = [
  'wrong_location',   // the dot is not where the bus is — GPS on these vehicles is unreliable
  'cancelled', 'replaced', 'departed', 'restored',
];

/** How long a rider may take a report back. The client counts down against the same number. */
export const UNDO_MS = 30000;

/**
 * Today's service day, in IST. Reports are scoped to it rather than to wall-clock hours so a
 * claim about today's trip cannot leak into tomorrow's, and a server in another timezone
 * cannot roll the day over in the middle of a Gujarat evening.
 */
const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});
export const today = () => IST_DAY.format(new Date());

export const REPORT_KINDS = [...Object.keys(OCCUPANCY), ...STATUS_KINDS];

/**
 * One signed number for how full a bus is: negative means seats going spare, positive means
 * people standing, zero means every seat taken and nobody up yet.
 *
 * A single axis rather than two fields because it *is* one quantity — a bus does not have empty
 * seats and standing passengers at the same time — and because one slider can be dragged
 * through the whole range without the rider first deciding which question they are answering.
 */
export const SEATS_FREE_MAX = 40;
export const STANDING_MAX = 30;

/**
 * Buckets a headcount onto the coarse scale everything else already speaks.
 *
 * The scale is kept because the exact number is not always what you want: a median of raw
 * counts is the honest readout for one bus right now, while the five rungs are what colour,
 * summaries and two years of stored reports are expressed in.
 */
export function levelForHeadcount(count) {
  if (count <= -10) return OCCUPANCY.empty;
  if (count < 0) return OCCUPANCY.seats;
  if (count === 0) return OCCUPANCY.standing;
  if (count < 15) return OCCUPANCY.crowded;
  return OCCUPANCY.full;
}

/** Reverses OCCUPANCY so a stored level can be named again. */
export const occupancyName = (level) =>
  Object.keys(OCCUPANCY).find((k) => OCCUPANCY[k] === level) || null;

export const reports = {
  add({ plate, kind, level = null, headcount = null, detail = '', route, serviceDay, reporter }) {
    stmt(`INSERT INTO reports
            (plate, kind, level, headcount, detail, route, service_day, created_at, reporter)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(plate, kind, level, headcount, detail || '', route || '', serviceDay, Date.now(), reporter);
  },

  /**
   * One report per axis per bus per hour, per reporter.
   *
   * Per *axis*, not per bus: someone who says the bus is packed and then watches it get
   * replaced has two true things to tell us, and the old single limit silently swallowed the
   * second. Within an axis the limit still holds, which is what stops a stuck thumb.
   */
  recentlyReported(plate, reporter, { occupancy = false, withinMs = 3600000 } = {}) {
    return stmt(`SELECT COUNT(*) AS n FROM reports
                 WHERE plate = ? AND reporter = ? AND created_at > ?
                   AND level IS ${occupancy ? 'NOT NULL' : 'NULL'}`)
      .get(plate, reporter, Date.now() - withinMs).n > 0;
  },

  /**
   * What people are saying about this bus right now, on both axes.
   *
   * Occupancy is a median, for the same reason arrival times are: one person who boards at the
   * one packed moment should not permanently mark an empty bus as full. Status kinds are
   * counted, because "four people say it never came" is the whole signal.
   */
  /**
   * What people are saying about this bus, on both axes.
   *
   * The two axes are read over different spans on purpose. **Occupancy** is a rolling window:
   * how full a bus was ninety minutes ago says nothing about how full it is now. **Status** is
   * scoped to the service day, because "a different bus ran this trip" is a fact about today's
   * trip and stays true until the day ends — on a rolling window it evaporated mid-journey,
   * while the replacement was still driving the route.
   *
   * Occupancy is a median, as with arrival times: one person boarding at the single packed
   * moment should not permanently mark an empty bus as full.
   */
  /**
   * What riders have said about many buses at once.
   *
   * A timetable page lists eighty services, and `recentFor` costs four queries a bus — so the
   * only way crowd reports reach the list people actually choose from is to ask once. Returns
   * only what a list row can show: how full, and whether it is running at all.
   *
   * Absent plates are absent rather than empty, so the caller can tell "nobody has said
   * anything" from "somebody said it is empty" — those mean opposite things to a rider.
   */
  summaryFor(plates, { withinMs = 90 * 60 * 1000, serviceDay = today() } = {}) {
    const wanted = [...new Set((plates || []).map(String).filter(Boolean))];
    if (!wanted.length) return {};
    const since = Date.now() - withinMs;
    const list = JSON.stringify(wanted);

    const out = {};
    const bucket = (plate) => (out[plate] ||= {});

    const levels = new Map();
    for (const r of stmt(`SELECT plate, level FROM reports
                          WHERE plate IN (SELECT value FROM json_each(?))
                            AND created_at > ? AND level IS NOT NULL
                          ORDER BY plate, level`).all(list, since)) {
      if (!levels.has(r.plate)) levels.set(r.plate, []);
      levels.get(r.plate).push(r.level);
    }
    for (const [plate, values] of levels) {
      // The median, for the same reason a single bus's report is a median: one person counting
      // the worst moment of a journey must not become the number everyone else plans around.
      bucket(plate).level = values[Math.floor(values.length / 2)];
      bucket(plate).reports = values.length;
    }

    for (const r of stmt(`SELECT plate, kind, COUNT(*) AS n FROM reports
                          WHERE plate IN (SELECT value FROM json_each(?))
                            AND service_day = ? AND level IS NULL
                          GROUP BY plate, kind`).all(list, serviceDay)) {
      const b = bucket(r.plate);
      b.status = { ...(b.status || {}), [r.kind]: r.n };
    }

    // A replacement claim only stands while more riders assert it than deny it.
    for (const [plate, b] of Object.entries(out)) {
      const k = b.status || {};
      if ((k.replaced || 0) <= (k.restored || 0)) delete k.replaced;
      if (!Object.keys(k).length) delete b.status;
      if (!Object.keys(b).length) delete out[plate];
    }
    return out;
  },

  recentFor(plate, { withinMs = 90 * 60 * 1000, serviceDay = today() } = {}) {
    const since = Date.now() - withinMs;

    const levels = stmt(`SELECT level FROM reports
                         WHERE plate = ? AND created_at > ? AND level IS NOT NULL
                         ORDER BY level`).all(plate, since).map((r) => r.level);

    // Reported as a median for the same reason the level is: one person counting the single
    // worst moment should not become the number everyone else plans around.
    const counts = stmt(`SELECT headcount FROM reports
                         WHERE plate = ? AND created_at > ? AND headcount IS NOT NULL
                         ORDER BY headcount`).all(plate, since).map((r) => r.headcount);

    const status = stmt(`SELECT kind, COUNT(*) AS n, MAX(created_at) AS latest
                         FROM reports
                         WHERE plate = ? AND service_day = ? AND level IS NULL
                         GROUP BY kind ORDER BY n DESC`).all(plate, serviceDay);

    const byKind = Object.fromEntries(status.map((r) => [r.kind, r.n]));

    // Which bus people say took over — but only while the crowd still agrees it did.
    // `restored` is how a wrong report gets cleared: riders who see the original bus running
    // say so, and once they outnumber the replacement reports the claim stops being shown.
    // Without that the only correction was the reporter's own 30-second undo, which is no help
    // at all to the fifty people who read a mistake afterwards.
    let replacement = null;
    if ((byKind.replaced || 0) > (byKind.restored || 0)) {
      replacement = stmt(`SELECT detail AS plate, COUNT(*) AS n
                          FROM reports
                          WHERE plate = ? AND service_day = ?
                            AND kind = 'replaced' AND detail <> ''
                          GROUP BY detail ORDER BY n DESC LIMIT 1`).get(plate, serviceDay) || null;
    }

    const occupancy = levels.length
      ? {
        level: levels[Math.floor(levels.length / 2)],
        samples: levels.length,
        headcount: counts.length ? counts[Math.floor(counts.length / 2)] : null,
        counted: counts.length,
      }
      : null;

    return {
      total: levels.length + status.reduce((sum, r) => sum + r.n, 0),
      occupancy,
      status,
      replacement,
      disputed: Boolean(byKind.restored),
    };
  },

  /**
   * The reverse link: which bus, if any, this one is standing in for today.
   *
   * Someone handed the replacement's plate by a friend — or by this app — arrives knowing only
   * a number. Without this they see an ordinary bus on an unexpected route and have no way to
   * tell it is the one they were sent to. Netted against `restored` for the same reason as
   * above, so a withdrawn claim disappears from both ends rather than only the one.
   */
  replacementFor(plate, serviceDay = today()) {
    const row = stmt(`SELECT plate AS original, COUNT(*) AS n
                      FROM reports
                      WHERE detail = ? AND service_day = ? AND kind = 'replaced'
                      GROUP BY plate ORDER BY n DESC LIMIT 1`).get(plate, serviceDay);
    if (!row) return null;

    const restored = stmt(`SELECT COUNT(*) AS n FROM reports
                           WHERE plate = ? AND service_day = ? AND kind = 'restored'`)
      .get(row.original, serviceDay).n;
    return row.n > restored ? row : null;
  },

  /**
   * Takes back the caller's most recent report for a bus, briefly.
   *
   * A five-rung scale invites a mis-tap, and being unable to correct one is worse than the
   * mistake: the rider either leaves a wrong answer standing for everyone or spams a second
   * report to drown it out. The window is short on purpose — once other riders have seen the
   * answer and acted on it, quietly withdrawing it is its own kind of wrong.
   *
   * Deleting the row also clears the per-hour limit, which is what makes a correction possible
   * rather than merely a deletion.
   */
  undo(plate, reporter, withinMs = UNDO_MS) {
    const row = stmt(`SELECT id FROM reports
                      WHERE plate = ? AND reporter = ? AND created_at > ?
                      ORDER BY created_at DESC LIMIT 1`)
      .get(plate, reporter, Date.now() - withinMs);
    if (!row) return false;
    stmt('DELETE FROM reports WHERE id = ?').run(row.id);
    return true;
  },
  sweep() {
    stmt('DELETE FROM reports WHERE created_at < ?').run(Date.now() - 30 * 86400000);
  },
  count: () => stmt('SELECT COUNT(*) AS n FROM reports').get().n,
};

/**
 * Aggregate usage counters.
 *
 * Deliberately shaped so it *cannot* become per-user tracking: the key is the thing asked for
 * (a plate, a route, an endpoint), never who asked. There is no identifier to join on, so the
 * worst this can answer is "how popular was this bus today" — which is the whole question, and
 * the only one the app has ever promised its users it would ask.
 */
export const metrics = {
  bump(kind, key, day = today()) {
    if (!key) return;
    stmt(`INSERT INTO metrics (day, kind, key, n) VALUES (?, ?, ?, 1)
          ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1`)
      .run(day, kind, String(key).slice(0, 120));
  },
  top(kind, { day = today(), limit = 12 } = {}) {
    return stmt('SELECT key, n FROM metrics WHERE day = ? AND kind = ? ORDER BY n DESC LIMIT ?')
      .all(day, kind, limit);
  },
  totalFor(kind, day = today()) {
    return stmt('SELECT COALESCE(SUM(n), 0) AS n FROM metrics WHERE day = ? AND kind = ?')
      .get(day, kind).n;
  },
  /** Daily totals for a kind, oldest first — enough to draw a trend without storing sessions. */
  daily(kind, days = 14) {
    return stmt(`SELECT day, SUM(n) AS n FROM metrics WHERE kind = ?
                 GROUP BY day ORDER BY day DESC LIMIT ?`).all(kind, days).reverse();
  },
  sweep(keepDays = 60) {
    const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
    stmt('DELETE FROM metrics WHERE day < ?').run(cutoff);
  },
};

/**
 * How full this route usually is around this hour, from what riders have reported.
 *
 * Keyed on route and hour rather than on a bus: a commuter choosing between the 08:00 and the
 * 08:40 wants to know about the *service at that time*, and any given plate runs a different
 * turn each day. Reported as a median for the same reason arrival times are — one person
 * boarding at the single worst moment should not define the hour.
 *
 * Stays silent below `minSamples`. "Usually packed" from two sightings is a guess wearing a
 * fact's coat, and being wrong here sends someone to a bus they did not need to avoid.
 */
export function crowdingFor(route, hour, { minSamples = 4, days = 30 } = {}) {
  if (!route) return null;
  const counts = stmt(`SELECT headcount FROM reports
                       WHERE route = ? AND headcount IS NOT NULL
                         AND created_at > ?
                         AND CAST(strftime('%H', datetime(created_at/1000, 'unixepoch',
                             '+5 hours', '+30 minutes')) AS INTEGER) = ?
                       ORDER BY headcount`)
    .all(route, Date.now() - days * 86400000, Number(hour)).map((r) => r.headcount);
  if (counts.length < minSamples) return null;
  return {
    samples: counts.length,
    headcount: counts[Math.floor(counts.length / 2)],
    hour: Number(hour),
  };
}

/** Occupancy reported across the whole fleet today, as a distribution rather than per bus. */
export function occupancyToday(day = today()) {
  return stmt(`SELECT level, COUNT(*) AS n FROM reports
               WHERE service_day = ? AND level IS NOT NULL
               GROUP BY level ORDER BY level`).all(day);
}

/**
 * Durable scratch space for work that outlives a single boot.
 *
 * The stand-coordinate sweep is nearly an hour long, and every deploy restarts the process.
 * Without somewhere to write "I got this far" it began again from the first cell each time and
 * never reached the end — which is exactly what happened.
 */
export const state = {
  get(key, fallback = null) {
    const row = stmt('SELECT value FROM state WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },
  set(key, value) {
    stmt(`INSERT INTO state (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  },
};

/** Every replacement claimed today, for the admin view. Plates only — no reporters. */
export function replacementsToday(day = today()) {
  return stmt(`SELECT plate, detail AS replacement, COUNT(*) AS n
               FROM reports
               WHERE service_day = ? AND kind = 'replaced' AND detail <> ''
               GROUP BY plate, detail ORDER BY n DESC LIMIT 40`).all(day);
}

/**
 * Per-device analytics: sessions, the events inside them, and what that adds up to.
 *
 * Everything here hangs off a random device id the app generates and can reset. There are no
 * accounts to attach it to, so it is pseudonymous rather than anonymous — which is a real
 * difference, and the reason the privacy policy says so in those words rather than calling it
 * anonymous and hoping nobody checks.
 */
/**
 * Station names, learned rather than fetched.
 *
 * Every autocomplete result and every timetable row already carries an id alongside its name,
 * so the mapping arrives for free on traffic that was happening anyway — no extra upstream
 * request, which matters on an API this app reuses without an agreement.
 */
export const stations = {
  learn(pairs, source = 'operator') {
    if (!pairs?.length) return 0;
    const write = stmt(`INSERT INTO stations (id, name, name_gu, lat, lng, seen_at, source)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                          name = excluded.name,
                          name_gu = CASE WHEN excluded.name_gu <> '' THEN excluded.name_gu
                                         ELSE stations.name_gu END,
                          -- A source that carries no coordinates must not erase one we have.
                          lat = COALESCE(excluded.lat, stations.lat),
                          lng = COALESCE(excluded.lng, stations.lng),
                          -- Only claim a new source when this call actually supplied a position.
                          source = CASE WHEN excluded.lat IS NOT NULL THEN excluded.source
                                        ELSE stations.source END,
                          seen_at = excluded.seen_at`);
    let n = 0;
    for (const [id, name, nameGu, lat, lng] of pairs) {
      const key = String(id ?? '').trim();
      const label = String(name ?? '').trim();
      if (!key || !label || label === 'N/A') continue;
      write.run(key, label.slice(0, 80), String(nameGu ?? '').trim().slice(0, 80),
        validCoord(lat, 24.8, 20.0), validCoord(lng, 74.6, 68.1), Date.now(), source);
      n += 1;
    }
    return n;
  },

  /** id -> name for the ids given. Unknown ids are simply absent; callers fall back to the id. */
  names(ids = []) {
    const wanted = [...new Set(ids.map(String).filter(Boolean))];
    if (!wanted.length) return {};
    // json_each rather than a generated `?, ?, ?`: one statement whatever the list length, and
    // no bind parameter per id to run into SQLite's 32,766 ceiling.
    const rows = stmt(`SELECT id, name FROM stations
                       WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(wanted));
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  },

  /** Where these particular stations are, for the ones we have learned. Absent ids are absent,
   *  so a caller can tell "not known yet" from "at 0,0". */
  positions(ids = []) {
    const wanted = [...new Set(ids.map(String).filter(Boolean))].slice(0, 50);
    if (!wanted.length) return [];
    return stmt(`SELECT id, name, name_gu AS nameGu, lat, lng FROM stations
                 WHERE lat IS NOT NULL AND id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(wanted));
  },

  /** Bus stands inside a viewport, for drawing on a map. Capped so a zoomed-out map cannot ask
   *  for the whole state. */
  inBox({ south, west, north, east }, limit = 300) {
    return stmt(`SELECT id, name, name_gu AS nameGu, lat, lng FROM stations
                 WHERE lat IS NOT NULL AND lng IS NOT NULL
                   AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
                 ORDER BY seen_at DESC LIMIT ?`)
      .all(south, north, west, east, limit);
  },

  /**
   * The next few geocoded stations to explore routes from, in geographic order.
   *
   * Ordered by position rather than by discovery time, so neighbours in the list are neighbours
   * on the ground — which is what makes a timetable query between two of them likely to find a
   * service, whose trip then places every village in between.
   *
   * Claimed as they are handed out. Marking them is what makes the walk resumable and
   * exhaustive; counting into a list that is still growing is neither.
   */
  toExplore(limit) {
    // Positions included: the caller pairs each anchor against the *furthest* hub, and cannot
    // work out which that is without knowing where the anchor is.
    const rows = stmt(`SELECT id, name, lat, lng FROM stations
                       WHERE lat IS NOT NULL AND explored_at IS NULL
                       ORDER BY lat ASC, lng ASC LIMIT ?`).all(limit);
    if (rows.length) {
      const mark = stmt('UPDATE stations SET explored_at = ? WHERE id = ?');
      for (const r of rows) mark.run(Date.now(), r.id);
    }
    return rows;
  },

  /** How much of the geocoded set the explorer has worked through. */
  exploreProgress: () => stmt(`SELECT
      COUNT(*) AS located,
      SUM(CASE WHEN explored_at IS NOT NULL THEN 1 ELSE 0 END) AS explored
    FROM stations WHERE lat IS NOT NULL`).get(),

  /**
   * Stations still missing a position and not yet tried, for the geocoder to work through.
   *
   * Plain names first — the operator writes minor stops as "Kothariya (Wankaner)", so an
   * unbracketed name is usually the town itself, which is both likelier to resolve and likelier
   * to be the one a rider searched for.
   */
  unplaced(limit = 50, { retryAfterMs = 30 * 86400000 } = {}) {
    return stmt(`SELECT id, name FROM stations
                 WHERE lat IS NULL
                   AND (geocode_tried_at IS NULL OR geocode_tried_at < ?)
                 ORDER BY (name LIKE '%(%') ASC, LENGTH(name) ASC, id ASC LIMIT ?`)
      .all(Date.now() - retryAfterMs, limit);
  },

  /** Records an attempt, so a name that cannot be resolved is not paid for twice. */
  markGeocodeTried(id) {
    stmt('UPDATE stations SET geocode_tried_at = ? WHERE id = ?').run(Date.now(), id);
  },

  /** How many positions came from each source. */
  bySource: () => stmt(`SELECT source, COUNT(*) AS n FROM stations
                        WHERE lat IS NOT NULL GROUP BY source`).all(),

  /** Removes every position from one source. The escape hatch for licensed data. */
  forgetSource(source) {
    return stmt(`UPDATE stations SET lat = NULL, lng = NULL, source = 'operator'
                 WHERE source = ?`).run(source).changes;
  },

  count: () => stmt('SELECT COUNT(*) AS n FROM stations').get().n,
  located: () => stmt('SELECT COUNT(*) AS n FROM stations WHERE lat IS NOT NULL').get().n,
};

export const analytics = {
  /**
   * Everything below accepts a day *range* rather than a single day.
   *
   * A dashboard that can only show today cannot answer the questions worth asking — whether
   * last week was better, whether a change helped, whether Tuesdays are different. The range
   * is inclusive at both ends and defaults to today, so existing callers are unaffected.
   */
  range(days = 1) {
    const to = today();
    const from = new Date(Date.now() - (days - 1) * 86400000)
      .toISOString().slice(0, 10);
    return { from, to };
  },

  overviewRange(from, to) {
    const s = stmt(`SELECT COUNT(*) AS sessions, COUNT(DISTINCT device) AS devices,
                           COALESCE(SUM(events), 0) AS events,
                           COALESCE(AVG(last_at - started_at), 0) AS avgMs
                    FROM sessions WHERE day BETWEEN ? AND ?`).get(from, to);
    const bounced = stmt(`SELECT COUNT(*) AS n FROM (
                            SELECT s.id, SUM(CASE
                              WHEN e.name LIKE 'app:%' OR e.name LIKE 'entry:%' OR e.name LIKE 'set:%'
                              THEN 0 ELSE 1 END) AS acted
                            FROM sessions s LEFT JOIN events e ON e.session = s.id
                            WHERE s.day BETWEEN ? AND ? GROUP BY s.id
                          ) WHERE acted = 0`).get(from, to).n;
    return {
      sessions: s.sessions,
      devices: s.devices,
      events: s.events,
      avgSessionSec: Math.round(s.avgMs / 1000),
      bouncedPct: s.sessions ? Math.round((bounced / s.sessions) * 100) : 0,
    };
  },

  eventsRange(from, to, limit = 200) {
    return stmt(`SELECT name AS key, COUNT(*) AS n, COUNT(DISTINCT device) AS devices
                 FROM events WHERE day BETWEEN ? AND ?
                 GROUP BY name ORDER BY n DESC LIMIT ?`).all(from, to, limit);
  },

  hoursRange(from, to) {
    return stmt(`SELECT CAST(strftime('%H', datetime(at/1000, 'unixepoch',
                          '+5 hours', '+30 minutes')) AS INTEGER) AS hour,
                        COUNT(*) AS n, COUNT(DISTINCT device) AS devices
                 FROM events WHERE day BETWEEN ? AND ?
                 GROUP BY hour ORDER BY hour`).all(from, to);
  },

  platformsRange(from, to) {
    return stmt(`SELECT platform AS key, COUNT(*) AS n, COUNT(DISTINCT device) AS devices
                 FROM sessions WHERE day BETWEEN ? AND ? AND platform <> ''
                 GROUP BY platform ORDER BY n DESC`).all(from, to);
  },

  entriesRange(from, to) {
    return stmt(`SELECT entry AS key, COUNT(*) AS n FROM sessions
                 WHERE day BETWEEN ? AND ? AND entry <> ''
                 GROUP BY entry ORDER BY n DESC`).all(from, to);
  },

  funnelRange(steps, from, to) {
    return steps.map(([label, name]) => ({
      label,
      devices: stmt(`SELECT COUNT(DISTINCT device) AS n FROM events
                     WHERE day BETWEEN ? AND ? AND name = ?`).get(from, to, name).n,
    }));
  },

  /** Retention by cohort day: of the devices first seen on day D, how many came back later. */
  cohorts(days = 14) {
    const first = stmt(`SELECT device, MIN(day) AS firstDay FROM sessions GROUP BY device`).all();
    const byDay = new Map();
    for (const r of first) {
      const bucket = byDay.get(r.firstDay) || { day: r.firstDay, devices: 0, returned: 0 };
      bucket.devices += 1;
      byDay.set(r.firstDay, bucket);
    }
    for (const [day, bucket] of byDay) {
      bucket.returned = stmt(`SELECT COUNT(DISTINCT s.device) AS n FROM sessions s
                              WHERE s.day > ? AND s.device IN (
                                SELECT device FROM sessions GROUP BY device HAVING MIN(day) = ?
                              )`).get(day, day).n;
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-days);
  },

  /** Opens or refreshes a session. Called on every batch, so a long visit stays one session. */
  touch({ session, device, platform = '', standalone = false, lang = '', entry = '' }) {
    const now = Date.now();
    stmt(`INSERT INTO sessions (id, device, started_at, last_at, day, platform, standalone, lang, entry)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET last_at = excluded.last_at`)
      .run(session, device, now, now, today(), platform, standalone ? 1 : 0, lang, entry);
  },

  record(session, device, name, detail = '') {
    const now = Date.now();
    stmt('INSERT INTO events (session, device, name, detail, at, day) VALUES (?, ?, ?, ?, ?, ?)')
      .run(session, device, name, String(detail).slice(0, 80), now, today());
    stmt('UPDATE sessions SET events = events + 1, last_at = ? WHERE id = ?').run(now, session);
  },

  /** Headline counts for a day: people, visits, and how long they stayed. */
  overview(day = today()) {
    const s = stmt(`SELECT COUNT(*) AS sessions, COUNT(DISTINCT device) AS devices,
                           COALESCE(SUM(events), 0) AS events,
                           COALESCE(AVG(last_at - started_at), 0) AS avgMs
                    FROM sessions WHERE day = ?`).get(day);
    // A bounce is a visit that did nothing, and "nothing" is not zero events: every session
    // opens with a burst of five or six describing the device and its settings. Counting raw
    // events made the floor five and the bounce rate a permanent, meaningless 0%. Only events
    // that represent a rider doing something count.
    const bounced = stmt(`SELECT COUNT(*) AS n FROM (
                            SELECT s.id, SUM(CASE
                              WHEN e.name LIKE 'app:%' OR e.name LIKE 'entry:%' OR e.name LIKE 'set:%'
                              THEN 0 ELSE 1 END) AS acted
                            FROM sessions s LEFT JOIN events e ON e.session = s.id
                            WHERE s.day = ? GROUP BY s.id
                          ) WHERE acted = 0`).get(day).n;
    return {
      sessions: s.sessions,
      devices: s.devices,
      events: s.events,
      avgSessionSec: Math.round(s.avgMs / 1000),
      bouncedPct: s.sessions ? Math.round((bounced / s.sessions) * 100) : 0,
    };
  },

  /**
   * Returning devices, which is the only measure that says whether the app is actually useful.
   * A device counts as returning when it was seen on an earlier day, not merely earlier today.
   */
  retention(day = today()) {
    // Done entirely in SQL. Reading today's devices out and binding them back one parameter each
    // put a hard ceiling on this — SQLite refuses past 32,766 bind parameters, so on a busy
    // enough day the dashboard's retention panel would simply start throwing.
    const total = stmt('SELECT COUNT(DISTINCT device) AS n FROM sessions WHERE day = ?').get(day).n;
    if (!total) return { total: 0, returning: 0, new: 0, returningPct: 0 };
    const returning = stmt(`SELECT COUNT(*) AS n FROM (
                              SELECT device FROM sessions WHERE day = ?
                              INTERSECT
                              SELECT device FROM sessions WHERE day < ?
                            )`).get(day, day).n;
    return {
      total,
      returning,
      new: total - returning,
      returningPct: Math.round((returning / total) * 100),
    };
  },

  /** Distinct devices per day, oldest first — the growth curve. */
  daily(days = 21) {
    return stmt(`SELECT day, COUNT(DISTINCT device) AS devices, COUNT(*) AS sessions
                 FROM sessions GROUP BY day ORDER BY day DESC LIMIT ?`).all(days).reverse();
  },

  eventCounts(day = today(), limit = 50) {
    return stmt(`SELECT name AS key, COUNT(*) AS n, COUNT(DISTINCT device) AS devices
                 FROM events WHERE day = ? GROUP BY name ORDER BY n DESC LIMIT ?`)
      .all(day, limit);
  },

  /**
   * How many devices reached each step of a funnel, in order.
   *
   * Counted per device rather than per event: the question a funnel answers is "how many people
   * got this far", and someone who taps install twice is still one person who did not install.
   */
  funnel(steps, day = today()) {
    return steps.map(([label, name]) => ({
      label,
      devices: stmt('SELECT COUNT(DISTINCT device) AS n FROM events WHERE day = ? AND name = ?')
        .get(day, name).n,
    }));
  },

  /** The most recent sessions, each with the path taken through the app. */
  recentSessions(limit = 12) {
    const rows = stmt(`SELECT id, device, started_at, last_at, platform, standalone, lang, entry, events
                       FROM sessions ORDER BY last_at DESC LIMIT ?`).all(limit);
    return rows.map((r) => ({
      ...r,
      // Truncated: enough to tell two visits apart in the list, too little to be a handle on
      // anyone. The full id stays in the database where the reset button can clear it.
      device: r.device.slice(0, 6),
      durationSec: Math.round((r.last_at - r.started_at) / 1000),
      // Also by id: within a batch the timestamps are identical, so ordering by them would
      // shuffle the path into whatever order SQLite happened to return.
      path: stmt('SELECT name, detail, at FROM events WHERE session = ? ORDER BY id LIMIT 40')
        .all(r.id),
    }));
  },

  /** Which screen people go to first, and which they leave from. */
  firstScreens(day = today()) {
    // Ordered by row id, not by timestamp. A batch arrives in one insert loop, so several
    // events routinely share a millisecond — and every one of them then ties for MIN(at),
    // making a single visit count as having started on three different screens.
    return stmt(`SELECT name AS key, COUNT(*) AS n FROM events e
                 WHERE day = ? AND name LIKE 'screen:%'
                   AND id = (SELECT MIN(id) FROM events
                             WHERE session = e.session AND name LIKE 'screen:%')
                 GROUP BY name ORDER BY n DESC`).all(day);
  },

  /** Which buses a device looks up, and how often — the per-device history. */
  busHistory(from, to, limit = 60) {
    return stmt(`SELECT detail AS plate, COUNT(*) AS lookups,
                        COUNT(DISTINCT device) AS devices, COUNT(DISTINCT session) AS sessions
                 FROM events
                 WHERE day BETWEEN ? AND ? AND name = 'act:track' AND detail <> ''
                 GROUP BY detail ORDER BY lookups DESC LIMIT ?`).all(from, to, limit);
  },

  /** Devices that keep returning to the same bus — the app's actual regulars. */
  regulars(from, to, limit = 40) {
    return stmt(`SELECT substr(device, 1, 6) AS device, detail AS plate, COUNT(*) AS n,
                        COUNT(DISTINCT day) AS days
                 FROM events
                 WHERE day BETWEEN ? AND ? AND name = 'act:track' AND detail <> ''
                 GROUP BY device, detail HAVING n >= 2
                 ORDER BY days DESC, n DESC LIMIT ?`).all(from, to, limit);
  },

  /** Every session, for the raw explorer — not just the most recent handful. */
  sessionList(from, to, limit = 300) {
    return stmt(`SELECT id, substr(device, 1, 6) AS device, started_at, last_at,
                        platform, standalone, lang, entry, events, day
                 FROM sessions WHERE day BETWEEN ? AND ?
                 ORDER BY last_at DESC LIMIT ?`).all(from, to, limit);
  },

  /** Everything a device ever sent. Powers the "forget this device" button. */
  forget(device) {
    const events = stmt('DELETE FROM events WHERE device = ?').run(device).changes;
    const sessions = stmt('DELETE FROM sessions WHERE device = ?').run(device).changes;
    return { events, sessions };
  },

  sweep(keepDays = 90) {
    const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
    stmt('DELETE FROM events WHERE day < ?').run(cutoff);
    stmt('DELETE FROM sessions WHERE day < ?').run(cutoff);
  },
};

export function stats() {
  try {
    return {
      subscriptions: subscriptions.count(),
      pendingAlerts: alerts.pendingCount(),
      arrivals: arrivals.count(),
      reports: reports.count(),
    };
  } catch {
    return { error: 'unavailable' };
  }
}

export function close() {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}

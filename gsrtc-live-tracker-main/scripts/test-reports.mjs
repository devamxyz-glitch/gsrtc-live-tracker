/**
 * Crowd reports: the occupancy scale, the status axis, and the migration between them.
 *
 * The migration is the part worth testing hardest. Reports are the one thing in this app that
 * cannot be re-fetched — the operator does not know the bus was full, so a rider's tap is the
 * only copy. A migration that drops or miscounts them destroys data that nobody can recover,
 * and it fails silently: the rows are still there, they just stop meaning anything.
 *
 *   node --test scripts/test-reports.mjs
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_FILE = path.join(os.tmpdir(), `st-reports-test-${Date.now()}.db`);
process.env.DB_FILE = DB_FILE;
process.env.IP_HASH_SALT = 'test-salt';

/**
 * A database as it exists on the live server today: the reports table as first shipped, with
 * neither `level` nor `detail`, holding rows under the old four-kind scheme.
 */
function seedLegacyDatabase() {
  const legacy = new DatabaseSync(DB_FILE);
  legacy.exec(`
    CREATE TABLE reports (
      id            INTEGER PRIMARY KEY,
      plate         TEXT NOT NULL,
      kind          TEXT NOT NULL,
      route         TEXT NOT NULL DEFAULT '',
      service_day   TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      reporter      TEXT NOT NULL
    );
  `);
  const insert = legacy.prepare(
    'INSERT INTO reports (plate, kind, route, service_day, created_at, reporter) VALUES (?,?,?,?,?,?)',
  );
  const now = Date.now();
  // Today's service day in IST — status reports are scoped to it, so seeding any other date
  // would be testing that yesterday's reports stay hidden rather than that they migrate.
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  insert.run('GJ-18-ZT-1028', 'full', 'Rajkot to Morbi', day, now, 'r1');
  insert.run('GJ-18-ZT-1028', 'seats', 'Rajkot to Morbi', day, now, 'r2');
  insert.run('GJ-18-ZT-1028', 'no_show', 'Rajkot to Morbi', day, now, 'r3');
  insert.run('GJ-18-ZT-1028', 'departed', 'Rajkot to Morbi', day, now, 'r4');
  legacy.close();
}

seedLegacyDatabase();
const db = await import('../server/db.mjs');

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch { /* already gone */ }
  }
});

test('the old four-kind reports survive the move to two axes', () => {
  db.open();   // runs the migration against the legacy table above

  const summary = db.reports.recentFor('GJ-18-ZT-1028');

  assert.equal(summary.total, 4, 'no report is lost in the migration');

  // 'full' and 'seats' were occupancy claims all along and must land on the scale, not in the
  // status list where nothing would ever read them again.
  assert.ok(summary.occupancy, 'the old occupancy reports still count as occupancy');
  assert.equal(summary.occupancy.samples, 2);
  assert.equal(summary.occupancy.level, db.OCCUPANCY.full,
    'the median of {seats, full} takes the upper of two, which is the cautious read');

  const kinds = Object.fromEntries(summary.status.map((r) => [r.kind, r.n]));
  assert.equal(kinds.cancelled, 1, "'no_show' is the same claim 'cancelled' now makes");
  assert.equal(kinds.no_show, undefined, 'and the retired name is gone');
  assert.equal(kinds.departed, 1, "'departed' kept its name and needed no change");
});

test('migrating twice changes nothing', () => {
  const before = JSON.stringify(db.reports.recentFor('GJ-18-ZT-1028'));
  db.close();
  db.open();
  assert.equal(JSON.stringify(db.reports.recentFor('GJ-18-ZT-1028')), before,
    'a redeploy re-runs the migration, so it has to be safe to repeat');
});

test('occupancy is a median, so one crowded boarding does not brand the bus', () => {
  db.open();
  const plate = 'GJ-18-Z-5555';
  const day = db.today();
  // Four riders find seats; one boards at the single packed moment.
  for (const [i, kind] of ['seats', 'seats', 'seats', 'empty', 'full'].entries()) {
    db.reports.add({
      plate, kind, level: db.OCCUPANCY[kind], route: 'r', serviceDay: day, reporter: `p${i}`,
    });
  }
  const { occupancy } = db.reports.recentFor(plate);
  assert.equal(occupancy.samples, 5);
  assert.equal(db.occupancyName(occupancy.level), 'seats',
    'the outlier does not move the answer the way a mean would');
});

test('a replacement names the bus that actually ran, and the crowd picks one', () => {
  db.open();
  const plate = 'GJ-18-Z-6666';
  const day = db.today();
  const add = (reporter, detail) => db.reports.add({
    plate, kind: 'replaced', detail, route: 'r', serviceDay: day, reporter,
  });
  add('a', 'GJ-18-Z-7777');
  add('b', 'GJ-18-Z-7777');
  add('c', 'GJ-18-Z-8888');   // one person disagrees

  const { replacement, status } = db.reports.recentFor(plate);
  assert.equal(replacement.plate, 'GJ-18-Z-7777', 'the most-named bus wins');
  assert.equal(replacement.n, 2);
  assert.equal(status.find((r) => r.kind === 'replaced').n, 3,
    'while the count still reflects everyone who reported a replacement');
});

test('one report per axis per hour — but the two axes are independent', () => {
  db.open();
  const plate = 'GJ-18-Z-9999';
  const day = db.today();
  const reporter = 'same-person';

  db.reports.add({ plate, kind: 'full', level: db.OCCUPANCY.full, route: '', serviceDay: day, reporter });

  assert.equal(db.reports.recentlyReported(plate, reporter, { occupancy: true }), true,
    'a second occupancy report from the same thumb is refused');
  assert.equal(db.reports.recentlyReported(plate, reporter, { occupancy: false }), false,
    'but watching that same bus get replaced is a different fact, and must still be tellable');
});

test('two riders on the same bus do not block or undo each other', () => {
  db.open();
  const plate = 'GJ-18-Z-8888';
  const day = db.today();

  // The bug this guards: `reporter` was a hash of the client IP, and behind the proxy every
  // rider arrives from the same address. On the live site that made all of them one person —
  // the first to report a bus silenced the rest for an hour, and an undo took whichever report
  // was most recent, whoever had made it.
  db.reports.add({ plate, kind: 'full', level: db.OCCUPANCY.full, route: '', serviceDay: day, reporter: 'rider-a' });

  assert.equal(db.reports.recentlyReported(plate, 'rider-a', { occupancy: true }), true);
  assert.equal(db.reports.recentlyReported(plate, 'rider-b', { occupancy: true }), false,
    'a different rider on the same bus must still be able to report it');

  db.reports.add({ plate, kind: 'seats', level: db.OCCUPANCY.seats, route: '', serviceDay: day, reporter: 'rider-b' });

  assert.equal(db.reports.undo(plate, 'rider-c'), false,
    'someone who reported nothing cannot withdraw a report');
  assert.equal(db.reports.undo(plate, 'rider-a'), true);
  assert.equal(db.reports.recentlyReported(plate, 'rider-b', { occupancy: true }), true,
    "and rider A's undo must leave rider B's report standing");
});

test('a replacement is cleared when riders say the original is running', () => {
  db.open();
  const plate = 'GJ-18-Z-1111';
  const day = db.today();
  const say = (kind, reporter, detail = '') =>
    db.reports.add({ plate, kind, detail, route: 'r', serviceDay: day, reporter });

  say('replaced', 'a', 'GJ-18-Z-2222');
  assert.equal(db.reports.recentFor(plate).replacement.plate, 'GJ-18-Z-2222');
  assert.equal(db.reports.replacementFor('GJ-18-Z-2222').original, plate,
    'and the stand-in bus knows whose trip it is covering');

  // One rider disagrees, and that is enough — the claim steps down on a tie rather than
  // holding out for a majority. The two errors do not cost the same: a replacement shown
  // wrongly sends people to a bus that is not theirs, while one withheld only leaves the
  // ordinary view. Under a genuine disagreement, the harmless failure is the right one.
  say('restored', 'b');
  assert.equal(db.reports.recentFor(plate).replacement, null,
    'a contested claim is not presented as fact');
  assert.equal(db.reports.replacementFor('GJ-18-Z-2222'), null,
    'and it disappears from the stand-in bus at the same moment, not only from the original');
  assert.equal(db.reports.recentFor(plate).disputed, true,
    'the disagreement is still recorded, so the UI can say why it vanished');

  // The original reporter is still counted; clearing the claim is not deleting the report.
  const kinds = Object.fromEntries(db.reports.recentFor(plate).status.map((r) => [r.kind, r.n]));
  assert.equal(kinds.replaced, 1);
  assert.equal(kinds.restored, 1);
});

test("yesterday's replacement does not follow the bus into today", () => {
  db.open();
  const plate = 'GJ-18-Z-3333';
  db.reports.add({
    plate, kind: 'replaced', detail: 'GJ-18-Z-4444',
    route: 'r', serviceDay: '2001-01-01', reporter: 'old',
  });
  assert.equal(db.reports.recentFor(plate).replacement, null,
    'a replacement is a fact about one day, and the next day it is simply not true');
  assert.equal(db.reports.replacementFor('GJ-18-Z-4444'), null);
});

test('a replacement outlives the occupancy window, because the trip does', () => {
  db.open();
  const plate = 'GJ-18-Z-5151';
  const day = db.today();
  db.reports.add({
    plate, kind: 'replaced', detail: 'GJ-18-Z-6161',
    route: 'r', serviceDay: day, reporter: 'z',
  });
  // Three hours on: long past the occupancy window, still the same running trip.
  const summary = db.reports.recentFor(plate, { withinMs: 1 });
  assert.equal(summary.occupancy, null, 'stale crowding is correctly forgotten');
  assert.equal(summary.replacement.plate, 'GJ-18-Z-6161',
    'while the replacement is still true and still needed');
});

test('a geocoded station is never paid for twice, and can be forgotten wholesale', () => {
  db.open();
  db.stations.learn([['G1', 'Rai', '', null, null]]);
  db.stations.learn([['G2', 'Un', '', null, null]]);
  db.stations.learn([['G3', 'Wankaner', '', 22.60415, 70.94342]]);

  const first = db.stations.unplaced(10).map((r) => r.id);
  assert.ok(first.includes('G1') && first.includes('G2'), 'unplaced stations are offered');
  assert.ok(!first.includes('G3'), 'a station we already have a position for is not');

  // Google finds nothing for G1. It must not come back to the top of the queue tomorrow.
  db.stations.markGeocodeTried('G1');
  assert.ok(!db.stations.unplaced(10).map((r) => r.id).includes('G1'),
    'a name that could not be resolved is not asked about again — that is a billed request');

  // G2 resolves, and is stamped with where it came from.
  db.stations.markGeocodeTried('G2');
  db.stations.learn([['G2', 'Un', '', 22.5, 71.0]], 'google');
  const bySource = Object.fromEntries(db.stations.bySource().map((r) => [r.source, r.n]));
  assert.equal(bySource.google, 1);
  assert.ok(bySource.operator >= 1, "the operator's own positions are counted separately");

  // The escape hatch: licensed data goes, ours stays.
  db.stations.forgetSource('google');
  const after = Object.fromEntries(db.stations.bySource().map((r) => [r.source, r.n]));
  assert.equal(after.google, undefined, 'every Google-derived position is gone');
  assert.ok(after.operator >= 1, 'and nothing learned from the operator went with it');
});

test('the harvester can tell which buses it has already read today', () => {
  db.open();
  const day = '2026-08-30';
  const other = '2026-08-29';

  db.arrivals.record({ plate: 'GJ-1-A', route: 'r', stopName: 's1', serviceDay: day, arrivedMin: 400, schedMin: 390 });
  db.arrivals.record({ plate: 'GJ-1-B', route: 'r', stopName: 's1', serviceDay: other, arrivedMin: 400, schedMin: 390 });

  const seen = db.arrivals.harvested(['GJ-1-A', 'GJ-1-B', 'GJ-1-C'], day);

  assert.ok(seen.has('GJ-1-A'), 'a bus read today is skipped');
  assert.ok(!seen.has('GJ-1-B'), "yesterday's read says nothing about today — it must be read again");
  assert.ok(!seen.has('GJ-1-C'), 'a bus never read is never skipped');

  // The failure that matters is the over-report: if this ever answered for buses it has not
  // seen, the harvester would skip everything and the timetable would stop being built, in
  // silence, exactly as it did when every insert was failing.
  assert.equal(seen.size, 1);
  assert.equal(db.arrivals.harvested([], day).size, 0, 'no plates asked, none answered');
});

test('one service\'s history is not pooled with every other bus on the route', () => {
  db.open();
  const route = 'Morbi to Rajkot';
  const stop = 'Morbi';
  const day = db.today();

  // Taken from the live data that exposed this: eight buses on one route reaching one stop
  // between 07:15 and 21:42. Pooled, the median was 10:11 — a time no bus ever arrives, which
  // the app would have shown a rider as "usually 10:11 AM".
  const morning = 7 * 60 + 15;
  const evening = 21 * 60 + 10;
  const add = (plate, serviceDay, arrivedMin, schedMin) =>
    db.arrivals.record({ plate, route, stopName: stop, serviceDay, arrivedMin, schedMin });

  for (let i = 0; i < 5; i += 1) {
    add(`GJ-18-M-${i}`, `2026-07-0${i + 1}`, morning + i, morning);
    add(`GJ-18-E-${i}`, `2026-07-0${i + 1}`, evening + i, evening);
  }

  const am = db.arrivals.reputation(route, stop, morning);
  const pm = db.arrivals.reputation(route, stop, evening);

  assert.equal(am.samples, 5, 'the morning service sees only its own observations');
  assert.equal(pm.samples, 5, 'and so does the evening one');
  assert.ok(Math.abs(am.typicalArrivalMin - morning) <= 5,
    `morning service should land near ${morning}, got ${am.typicalArrivalMin}`);
  assert.ok(Math.abs(pm.typicalArrivalMin - evening) <= 5,
    `evening service should land near ${evening}, got ${pm.typicalArrivalMin}`);
  assert.ok(pm.typicalArrivalMin - am.typicalArrivalMin > 800,
    'the two services must stay far apart — pooling them is the bug this guards');

  assert.equal(db.arrivals.reputation(route, stop, -1), null,
    'an observation with no known service is never answered for');
  assert.deepEqual(db.arrivals.reputationForRoute(route, -1), {},
    'and neither is a whole route without one');
});

test('an arrivals table from the old schema is rebuilt, not left broken', () => {
  // The live database carried `delay_min NOT NULL` from before it was understood that the
  // operator rewrites ETA to the actual arrival time. CREATE TABLE IF NOT EXISTS left it alone,
  // so every insert failed on a missing column — and `record()` returns false rather than
  // throwing, so on-time history collected nothing for a day without reporting a thing.
  db.close();
  const legacy = new DatabaseSync(DB_FILE);
  legacy.exec('DROP TABLE IF EXISTS arrivals');
  legacy.exec(`CREATE TABLE arrivals (
    id INTEGER PRIMARY KEY, plate TEXT NOT NULL, route TEXT NOT NULL DEFAULT '',
    stop_name TEXT NOT NULL, service_day TEXT NOT NULL,
    delay_min INTEGER NOT NULL, observed_at INTEGER NOT NULL)`);
  legacy.close();

  db.open();
  assert.equal(
    db.arrivals.record({
      plate: 'GJ-18-ZT-3196', route: 'Mangrol to Narayan Sarovar',
      stopName: 'Keshod', serviceDay: db.today(), arrivedMin: 992,
    }),
    true,
    'a write must succeed against a database that predates the rename',
  );

  // The unique index has to survive the rebuild, or every refetch of a trip would pile up
  // duplicate observations and skew the median it exists to protect.
  assert.equal(
    db.arrivals.record({
      plate: 'GJ-18-ZT-3196', route: 'Mangrol to Narayan Sarovar',
      stopName: 'Keshod', serviceDay: db.today(), arrivedMin: 995,
    }),
    false,
    'the same bus at the same stop on the same day is recorded once',
  );
  assert.equal(db.stats().arrivals, 1);
});

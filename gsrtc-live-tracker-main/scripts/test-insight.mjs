/**
 * Tests for the derived-intelligence layer.
 *
 * These are the numbers the app puts in front of someone deciding whether to run for a bus,
 * so the cases that matter most are the ones where it should refuse to answer.
 *
 *   node --test scripts/test-insight.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  speedFrom, movementFrom, parseStopTime, normaliseStops,
  locateOnRoute, delayMinutes, etaToStop, nextStopIndex, freshness, pollInterval,
} from '../web/js/insight.js';

/* A straight west-bound line, roughly Ahmedabad -> Rajkot, one degree of longitude apart. */
const rows = [
  { LocationName: 'Ahmedabad', LocationLat: '23.03', LocationLong: '72.58', Distance: '0', ETA: '8:00 AM' },
  { LocationName: 'Limbdi', LocationLat: '22.57', LocationLong: '71.81', Distance: '100', ETA: '10:00 AM' },
  { LocationName: 'Rajkot', LocationLat: '22.30', LocationLong: '70.80', Distance: '200', ETA: '12:00 PM' },
];

const minutesToClock = (minutes) => {
  const h24 = Math.floor(minutes / 60) % 24;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
};

/** A stop list whose schedule is anchored to the clock right now, so "late" is meaningful. */
function stopsRelativeToNow(offsets) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return normaliseStops(rows.map((row, i) => ({
    ...row,
    ETA: minutesToClock(((nowMinutes + offsets[i]) % 1440 + 1440) % 1440),
  })));
}

test('parseStopTime reads both shapes the API returns', () => {
  assert.equal(parseStopTime('6:33PM'), 18 * 60 + 33);
  assert.equal(parseStopTime(' 6:33:41 PM'), 18 * 60 + 33);
  assert.equal(parseStopTime('12:05 AM'), 5);
  assert.equal(parseStopTime('rubbish'), null);
});

test('normaliseStops unwraps a schedule that crosses midnight', () => {
  const overnight = normaliseStops([
    { LocationName: 'A', Distance: '0', ETA: '10:00 PM' },
    { LocationName: 'B', Distance: '50', ETA: '11:30 PM' },
    { LocationName: 'C', Distance: '120', ETA: '1:15 AM' },
  ]);
  assert.ok(overnight[2].scheduled > overnight[1].scheduled,
    'times after midnight must keep increasing, not wrap back to the morning');
  assert.equal(overnight[2].scheduled, 25 * 60 + 15);
});

test('speedFrom ignores a single wild fix', () => {
  const base = Date.now();
  const fixes = [
    { lat: 23.03, lng: 72.580, at: base },
    { lat: 23.03, lng: 72.570, at: base + 60000 },     // ~1 km/min -> about 60 km/h
    { lat: 0, lng: 0, at: base + 120000 },             // nonsense fix
    { lat: 23.03, lng: 72.560, at: base + 180000 },
    { lat: 23.03, lng: 72.550, at: base + 240000 },
  ];
  const { kmh } = speedFrom(fixes);
  assert.ok(kmh !== null && kmh < 110, `median speed should stay plausible, got ${kmh}`);
});

test('speedFrom has no opinion without two fixes', () => {
  assert.equal(speedFrom([]).kmh, null);
  assert.equal(speedFrom([{ lat: 1, lng: 1, at: Date.now() }]).confidence, 'none');
});

test('movementFrom calls a parked bus stopped, with how long', () => {
  const base = Date.now() - 10 * 60000;
  const fixes = Array.from({ length: 5 }, (_, i) => ({ lat: 23.03, lng: 72.58, at: base + i * 120000 }));
  const move = movementFrom(fixes);
  assert.equal(move.state, 'stopped');
  assert.ok(move.stillForMs > 60000);
});

test('locateOnRoute trusts the operator name over its own geometry', () => {
  const stops = normaliseStops(rows);
  // A position nowhere near the line, but the operator says the next stop is Rajkot.
  const located = locateOnRoute(stops, { lat: 21.0, lng: 70.0 }, 'Rajkot');
  assert.equal(located.nextIndex, 2);
  assert.ok(located.km >= 100 && located.km <= 200, `km should sit in the last leg, got ${located.km}`);
  assert.equal(located.confidence, 'fair', 'a position that disagrees with the anchor is not "good"');
});

test('locateOnRoute agrees with a position that is on the line', () => {
  const stops = normaliseStops(rows);
  const located = locateOnRoute(stops, { lat: 22.44, lng: 71.30 }, 'Rajkot');
  assert.equal(located.confidence, 'good');
  assert.ok(located.km > 100 && located.km < 200);
});

test('locateOnRoute reports low confidence when far off route with no anchor', () => {
  const stops = normaliseStops(rows);
  const located = locateOnRoute(stops, { lat: 26.0, lng: 75.0 }, '');
  assert.equal(located.confidence, 'low');
});

test('delayMinutes stays silent on a low-confidence position', () => {
  const stops = stopsRelativeToNow([-120, 0, 120]);
  assert.equal(delayMinutes(stops, 100, 'low'), null);
  assert.equal(delayMinutes(stops, 100, 'none'), null);
});

test('delayMinutes refuses an absurd figure rather than printing it', () => {
  // Schedule says this point was due ten hours ago: far more likely our reading is wrong.
  const stops = stopsRelativeToNow([-600, -580, -560]);
  assert.equal(delayMinutes(stops, 100, 'good'), null);
});

test('delayMinutes measures a believable delay', () => {
  const stops = stopsRelativeToNow([-30, 30, 90]);   // due at the midpoint in 30 min
  const delay = delayMinutes(stops, 100, 'good');
  assert.ok(delay !== null, 'a half-hour gap is well within the believable range');
  assert.ok(Math.abs(delay + 30) <= 2, `expected about 30 minutes early, got ${delay}`);
});

test('etaToStop prefers the schedule shifted by the measured delay', () => {
  const stops = stopsRelativeToNow([-60, 30, 120]);
  const eta = etaToStop(stops, 1, { busKm: 50, delay: 0, speedKmh: 40 });
  assert.equal(eta.basis, 'schedule');
  assert.ok(Math.abs(eta.minutes - 30) <= 2, `expected about 30 minutes, got ${eta.minutes}`);
});

test('etaToStop will not invent an ETA from an untrusted schedule', () => {
  const stops = normaliseStops(rows);
  // delay null means "the schedule could not be trusted"; with no measured speed there is
  // nothing honest left to say.
  assert.equal(etaToStop(stops, 2, { busKm: 100, delay: null, speedKmh: null }), null);
  assert.equal(etaToStop(stops, 2, { busKm: 100, delay: null, speedKmh: 2 }), null,
    'a crawling speed is jitter, not a basis for an estimate');
});

test('etaToStop falls back to measured speed when there is no schedule', () => {
  const stops = normaliseStops(rows.map(({ ETA, ...rest }) => rest));
  const eta = etaToStop(stops, 2, { busKm: 150, delay: null, speedKmh: 50 });
  assert.equal(eta.basis, 'speed');
  assert.equal(eta.confidence, 'fair');
  assert.ok(Math.abs(eta.minutes - 60) <= 1, `50 km at 50 km/h is an hour, got ${eta.minutes}`);
});

test('etaToStop reports a stop already passed', () => {
  const stops = normaliseStops(rows);
  const eta = etaToStop(stops, 0, { busKm: 120, delay: 0, speedKmh: 40 });
  assert.equal(eta.passed, true);
  assert.equal(eta.minutes, 0);
});

test('nextStopIndex finds the first stop ahead', () => {
  const stops = normaliseStops(rows);
  assert.equal(nextStopIndex(stops, 50), 1);
  assert.equal(nextStopIndex(stops, 150), 2);
  assert.equal(nextStopIndex(stops, 250), -1);
  assert.equal(nextStopIndex(stops, null), -1);
});

test('freshness grades the age of a fix', () => {
  assert.equal(freshness(null), 'none');
  assert.equal(freshness(Date.now()), 'live');
  assert.equal(freshness(Date.now() - 5 * 60000), 'stale');
  assert.equal(freshness(Date.now() - 30 * 60000), 'dead');
});

test('pollInterval speeds up near your stop and eases off a parked bus', () => {
  assert.equal(pollInterval(20, { movement: 'moving' }), 20);
  assert.equal(pollInterval(20, { movement: 'stopped' }), 40);
  assert.equal(pollInterval(20, { movement: 'moving', etaMinutes: 4 }), 10);
  assert.ok(pollInterval(20, { freshness: 'dead' }) >= 60);
  assert.ok(pollInterval(600, {}) <= 180, 'never drifts past the ceiling');
  assert.ok(pollInterval(1, {}) >= 8, 'never hammers the operator');
});

/* ------------------------------------------------------------------ upstream time */
/**
 * The upstream validates its auth token against a minute-precision IST clock, so these must
 * produce the same answer regardless of the host's timezone. A deploy to a UTC server failed
 * with a bare HTTP 401 for exactly this reason.
 */
test('upstream timestamps are IST regardless of host timezone', async () => {
  const { ymd, _internals } = await import('../server/upstream.mjs');
  // 2026-08-22T20:30:00Z is 2026-08-23 02:00 IST — a different calendar day.
  const crossesMidnight = new Date('2026-08-22T20:30:00Z');
  assert.equal(ymd(crossesMidnight), '2026-08-23',
    'a UTC host must still ask the operator for the Indian date');
  assert.equal(_internals.stamp(crossesMidnight), '082026230200',
    'MMyyyyddHHmm on the India clock');
});

test('a departure board ranks catchable buses above departed ones', () => {
  // Mirrors departureRank() in routes.js: signed minutes for anything still catchable,
  // pushed past the upcoming block for anything already gone.
  const rank = (m) => (m >= -10 ? m : 100000 - m);
  const order = [-590, -125, -50, -5, 7, 26, 855].sort((a, b) => rank(a) - rank(b));
  assert.deepEqual(order, [-5, 7, 26, 855, -50, -125, -590],
    'catchable first in time order, then most-recently-departed');
});

/* ------------------------------------------------------------------ house rules */
/**
 * No emoji in the UI. Icons come from web/js/icons.js as inline SVG, which theme, scale with
 * the type size and render identically on every device — none of which an emoji does. This is
 * a guard, not a preference: one crept into the helpline as a distance marker and shipped.
 */
test('no emoji in any user-facing code', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const web = fileURLToPath(new URL('../web/', import.meta.url));
  const files = [
    ...readdirSync(join(web, 'js')).filter((f) => f.endsWith('.js')).map((f) => join('js', f)),
    ...readdirSync(web).filter((f) => /\.(html|css|js)$/.test(f)),
  ];

  const offenders = [];
  for (const file of files) {
    const text = readFileSync(join(web, file), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (emoji.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 70)}`);
    });
  }
  assert.deepEqual(offenders, [], `use icon() from icons.js instead:\n${offenders.join('\n')}`);
});

/* ------------------------------------------------------------------ road geometry */
import { buildRoadIndex, snapToRoad, placeStopsOnRoad, haversineKm } from '../web/js/insight.js';

/** A road that detours north between two stops, as real roads do. */
const detourRoad = [
  [23.03, 72.58], [23.20, 72.30], [23.25, 72.00], [23.20, 71.60],
  [22.90, 71.90], [22.57, 71.81], [22.40, 71.30], [22.30, 70.80],
];

test('buildRoadIndex accumulates distance along the line', () => {
  const index = buildRoadIndex(detourRoad);
  assert.ok(index.totalKm > 0);
  assert.equal(index.cumKm[0], 0);
  for (let i = 1; i < index.cumKm.length; i += 1) {
    assert.ok(index.cumKm[i] >= index.cumKm[i - 1], 'cumulative distance never goes backwards');
  }
  assert.equal(buildRoadIndex([[1, 1]]), null, 'a single point is not a road');
  assert.equal(buildRoadIndex(null), null);
});

test('snapToRoad finds the nearest point and how far off it we are', () => {
  const index = buildRoadIndex(detourRoad);
  const onIt = snapToRoad(index, { lat: 23.25, lng: 72.00 });
  assert.ok(onIt.offRouteKm < 1, `a point on the road is on the road, got ${onIt.offRouteKm}`);

  const wayOff = snapToRoad(index, { lat: 26.0, lng: 75.0 });
  assert.ok(wayOff.offRouteKm > 100, 'a point in another state is not on this road');
});

test('the detour is why straight lines needed such a wide tolerance', () => {
  const index = buildRoadIndex(detourRoad);
  // A bus at the top of the northern detour, genuinely on the road.
  const bus = { lat: 23.25, lng: 72.0 };
  const onRoad = snapToRoad(index, bus);

  // The same bus measured against the chord between the two stops either side of the detour.
  const a = { lat: 23.03, lng: 72.58 }, b = { lat: 22.57, lng: 71.81 };
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  const f = Math.min(1, Math.max(0, ((bus.lng - a.lng) * dx + (bus.lat - a.lat) * dy) / (dx * dx + dy * dy)));
  const foot = { lat: a.lat + f * dy, lng: a.lng + f * dx };
  const chordOff = haversineKm(bus, foot);

  assert.ok(onRoad.offRouteKm < 1, 'on the road, it reads as on the road');
  assert.ok(chordOff > 20, `against a straight line the same bus looks ${chordOff.toFixed(0)} km off course`);
});

test('placeStopsOnRoad rejects geometry that belongs to another route', () => {
  const index = buildRoadIndex(detourRoad);
  const good = placeStopsOnRoad(index, [
    { name: 'A', km: 0, lat: 23.03, lng: 72.58 },
    { name: 'B', km: 100, lat: 22.57, lng: 71.81 },
    { name: 'C', km: 200, lat: 22.30, lng: 70.80 },
  ]);
  assert.ok(good, 'stops that sit on the road are placed');
  for (let i = 1; i < good.length; i += 1) {
    assert.ok(good[i].roadKm >= good[i - 1].roadKm, 'road distance increases along the route');
  }

  const elsewhere = placeStopsOnRoad(index, [
    { name: 'A', km: 0, lat: 23.03, lng: 72.58 },
    { name: 'X', km: 100, lat: 19.07, lng: 72.87 },   // Mumbai: not on this road
  ]);
  assert.equal(elsewhere, null, 'a stop far off the line invalidates the whole index');
});

test('locateOnRoute trusts a road fit more than a straight-line one', () => {
  const stops = normaliseStops([
    { LocationName: 'A', LocationLat: '23.03', LocationLong: '72.58', Distance: '0', ETA: '8:00 AM' },
    { LocationName: 'B', LocationLat: '22.57', LocationLong: '71.81', Distance: '100', ETA: '10:00 AM' },
    { LocationName: 'C', LocationLat: '22.30', LocationLong: '70.80', Distance: '200', ETA: '12:00 PM' },
  ]);
  const index = buildRoadIndex(detourRoad);
  const bus = { lat: 23.25, lng: 72.0 };   // on the detour, no operator anchor

  const withoutRoad = locateOnRoute(stops, bus, '');
  const withRoad = locateOnRoute(stops, bus, '', index);

  assert.equal(withRoad.viaRoad, true);
  assert.equal(withRoad.confidence, 'good', 'a tight fit on the real road is trustworthy');
  assert.ok(withoutRoad.confidence !== 'good', 'the same fix against chords cannot be');
});

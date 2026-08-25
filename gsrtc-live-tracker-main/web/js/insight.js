/* Derived intelligence.
 *
 * The operator gives us a position, a stop list with cumulative distances, and a schedule.
 * It does not tell you the thing you actually want to know: when will this bus reach *my* stop,
 * and is it late. Everything in here is computed from those three inputs, client-side.
 *
 * Pure functions, no DOM — so the numbers can be reasoned about (and corrected) in one place.
 * Every result carries a `confidence`, because an estimate presented as a fact is a lie.
 */

/** Great-circle distance in km. Lives here, not in ui.js, so this module stays DOM-free
    and the server can share exactly the same speed and movement maths. */
export function haversineKm(a, b, c, d) {
  let lat1, lng1, lat2, lng2;
  if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number' && typeof d === 'number') {
    lat1 = a; lng1 = b; lat2 = c; lng2 = d;
  } else {
    lat1 = a?.lat ?? a?.latitude ?? 0;
    lng1 = a?.lng ?? a?.lon ?? a?.longitude ?? 0;
    lat2 = b?.lat ?? b?.latitude ?? 0;
    lng2 = b?.lng ?? b?.lon ?? b?.longitude ?? 0;
  }
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const la1 = lat1 * rad, la2 = lat2 * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const MIN_USABLE_KMH = 8;      // below this, the "speed" is GPS jitter or a tea stop
const MAX_PLAUSIBLE_KMH = 110; // an ST bus doing more than this is a bad fix, not a fast bus
// Against straight lines between sparse stops, a bus on a perfectly normal road can sit this
// far from the chord joining two of them. Wide, but it has to be.
const MAX_OFF_ROUTE_KM = 8;
// Against the real road, it does not: a bus is on the road or it is not. Anything past this
// is a bad fix or the wrong route entirely.
const MAX_OFF_ROAD_KM = 1.5;
// A stop should sit essentially on the road; further than this and the geometry is not for
// this route, so the whole road index is rejected rather than trusted selectively.
const MAX_STOP_OFF_ROAD_KM = 2.5;

/* ------------------------------------------------------------------ speed */

/**
 * Smoothed speed from the fixes we have collected this session.
 * Rejects the outliers a noisy consumer GPS feed produces, and reports how sure it is.
 */
export function speedFrom(fixes) {
  if (!fixes || fixes.length < 2) return { kmh: null, confidence: 'none' };

  const legs = [];
  for (let i = 1; i < fixes.length; i += 1) {
    const hours = (fixes[i].at - fixes[i - 1].at) / 3600000;
    if (hours <= 0) continue;
    const kmh = haversineKm(fixes[i - 1], fixes[i]) / hours;
    if (kmh <= MAX_PLAUSIBLE_KMH) legs.push(kmh);
  }
  if (!legs.length) return { kmh: null, confidence: 'none' };

  // Median over the recent window: one bad fix cannot drag the answer.
  const recent = legs.slice(-6).sort((a, b) => a - b);
  const mid = Math.floor(recent.length / 2);
  const kmh = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;

  return {
    kmh,
    confidence: recent.length >= 4 ? 'good' : recent.length >= 2 ? 'fair' : 'low',
  };
}

/** Moving / stopped, and for how long — the question people actually ask a tracker. */
export function movementFrom(fixes, thresholdKm = 0.03) {
  if (!fixes || fixes.length < 2) return { state: 'unknown' };

  const last = fixes[fixes.length - 1];
  let stillSince = last.at;
  for (let i = fixes.length - 1; i > 0; i -= 1) {
    if (haversineKm(fixes[i - 1], last) > thresholdKm) break;
    stillSince = fixes[i - 1].at;
  }
  const stillForMs = Date.now() - stillSince;

  // Two fixes in the same spot is not yet "stopped" — wait for a real gap.
  if (haversineKm(fixes[0], last) <= thresholdKm && stillForMs > 90000) {
    return { state: 'stopped', stillForMs };
  }
  const { kmh, confidence } = speedFrom(fixes);
  if (kmh != null && kmh >= MIN_USABLE_KMH) return { state: 'moving', kmh, confidence };
  if (stillForMs > 90000) return { state: 'stopped', stillForMs };
  return { state: 'unknown' };
}

/* ------------------------------------------------------------------ the route */

/** "6:33PM" / " 6:33:41 PM" -> minutes since midnight, or null. */
export function parseStopTime(value) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])M/i.exec(String(value || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[4])) h += 12;
  return h * 60 + Number(m[2]);
}

/**
 * Normalises the stop list into something arithmetic can be done on: cumulative km,
 * coordinates, and a *monotonic* schedule in minutes (an overnight run passes midnight,
 * so raw clock times go backwards and must be unwrapped before they can be compared).
 */
export function normaliseStops(rows) {
  const stops = [];
  let previous = null;
  let dayOffset = 0;

  rows.forEach((row, index) => {
    const km = parseFloat(row.Distance);
    const lat = parseFloat(row.LocationLat);
    const lng = parseFloat(row.LocationLong);
    let minutes = parseStopTime(row.ETA) ?? parseStopTime(row.ArrivedTime);

    if (minutes != null) {
      if (previous != null && minutes + dayOffset < previous) dayOffset += 1440;
      minutes += dayOffset;
      previous = minutes;
    }
    stops.push({
      index,
      name: row.LocationName,
      nameGu: row.LocationNameGuj,
      km: isFinite(km) ? km : null,
      lat: isFinite(lat) && lat !== 0 ? lat : null,
      lng: isFinite(lng) && lng !== 0 ? lng : null,
      scheduled: minutes,
    });
  });
  return stops;
}

/* ------------------------------------------------------------------ road geometry */

/**
 * Prepares a road polyline for repeated queries: cumulative distance at every vertex.
 *
 * Built once per route, then reused for every stop and every position fix. Without it each
 * lookup would re-walk six thousand points.
 */
export function buildRoadIndex(line) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const points = line.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (points.length < 2) return null;

  const cumKm = new Array(points.length);
  cumKm[0] = 0;
  for (let i = 1; i < points.length; i += 1) {
    cumKm[i] = cumKm[i - 1] + haversineKm(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] },
    );
  }
  return { points, cumKm, totalKm: cumKm[cumKm.length - 1] };
}

/**
 * Where a point sits on the road: distance along it, and how far off it the point is.
 *
 * This is what makes the estimates honest. Projecting onto straight lines between sparse
 * stops meant a bus following a perfectly normal road could look eight kilometres off course,
 * so the tolerance had to be set that wide — wide enough to accept genuinely wrong positions
 * too. Against the real road, "off route" means off route.
 */
export function snapToRoad(index, point) {
  if (!index || !point) return null;
  const { points, cumKm } = index;

  let best = { km: 0, offRouteKm: Infinity, vertex: 0 };
  for (let i = 1; i < points.length; i += 1) {
    const a = { lat: points[i - 1][0], lng: points[i - 1][1] };
    const b = { lat: points[i][0], lng: points[i][1] };
    const { fraction, offRouteKm } = projectOntoSegment(point, a, b);
    if (offRouteKm < best.offRouteKm) {
      const segmentKm = cumKm[i] - cumKm[i - 1];
      best = { km: cumKm[i - 1] + fraction * segmentKm, offRouteKm, vertex: i };
    }
  }
  return best;
}

/**
 * Positions the route's stops along the road, so distances between them are road distances
 * rather than straight lines. Returns null if the stops do not follow the road in order —
 * which means the geometry belongs to a different route and must not be trusted.
 */
export function placeStopsOnRoad(index, stops) {
  if (!index) return null;
  const placed = [];
  let previousKm = -1;
  for (const stop of stops) {
    if (stop.lat == null || stop.lng == null) return null;
    const snapped = snapToRoad(index, { lat: stop.lat, lng: stop.lng });
    if (!snapped || snapped.offRouteKm > MAX_STOP_OFF_ROAD_KM) return null;
    if (snapped.km < previousKm - 1) return null;   // stops out of order along the line
    previousKm = snapped.km;
    placed.push({ ...stop, roadKm: snapped.km });
  }
  return placed;
}

/** Where a point falls on the segment a→b: how far along (0–1) and how far off it (km). */
function projectOntoSegment(point, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared > 0
    ? Math.min(1, Math.max(0, ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lengthSquared))
    : 0;
  const foot = { lat: a.lat + fraction * dy, lng: a.lng + fraction * dx };
  return { fraction, offRouteKm: haversineKm(point, foot) };
}

/**
 * Where the bus is on its line.
 *
 * Two sources, in order of trust:
 *   1. the operator's own "next stop", which beats anything we can infer;
 *   2. a geometric fit of the position against every segment of the stop chain.
 *
 * They are cross-checked against each other. When they disagree, or when the position sits
 * far off the line the stops describe (the stop list is sparse, so a real road can be many
 * kilometres from the straight line between two stops), the result says so — and everything
 * downstream declines to show a number rather than inventing one.
 */
export function locateOnRoute(stops, busPos, nextLocationName, roadIndex = null) {
  const usable = stops.filter((s) => s.km != null);
  if (!usable.length) return { km: null, nextIndex: -1, confidence: 'none' };

  const named = (nextLocationName || '').trim().toLowerCase();
  const anchorIndex = named
    ? stops.findIndex((s) => (s.name || '').trim().toLowerCase() === named)
    : -1;

  // With the real road, the fit is against the road itself and the tolerance can be tight.
  const onRoad = roadIndex ? snapToRoad(roadIndex, busPos) : null;
  let fit = null;
  if (onRoad) {
    const placed = placeStopsOnRoad(roadIndex, stops);
    if (placed) {
      // Translate road distance back onto the operator's own km scale, so every number
      // downstream — schedule interpolation, remaining distance — stays in one unit.
      let segment = 0;
      while (segment < placed.length - 2 && placed[segment + 1].roadKm <= onRoad.km) segment += 1;
      const a = placed[segment], b = placed[segment + 1];
      const span = b.roadKm - a.roadKm;
      const fraction = span > 0 ? Math.min(1, Math.max(0, (onRoad.km - a.roadKm) / span)) : 0;
      fit = {
        km: a.km + fraction * (b.km - a.km),
        offRouteKm: onRoad.offRouteKm,
        segment,
        viaRoad: true,
      };
    }
  }

  if (!fit && busPos) {
    for (let i = 0; i < stops.length - 1; i += 1) {
      const a = stops[i], b = stops[i + 1];
      if (a.lat == null || b.lat == null || a.km == null || b.km == null) continue;
      const { fraction, offRouteKm } = projectOntoSegment(busPos, a, b);
      if (!fit || offRouteKm < fit.offRouteKm) {
        fit = { km: a.km + fraction * (b.km - a.km), offRouteKm, segment: i };
      }
    }
  }

  // The tolerance depends on what we measured against.
  const tolerance = fit?.viaRoad ? MAX_OFF_ROAD_KM : MAX_OFF_ROUTE_KM;

  // The operator named the next stop: the bus is somewhere in the leg before it.
  if (anchorIndex > 0) {
    const from = stops[anchorIndex - 1].km;
    const to = stops[anchorIndex].km;
    // Agreement needs both: the fit lands in the right leg *and* the position is actually
    // near the line. A point a hundred kilometres away still projects somewhere.
    const agrees = fit && fit.offRouteKm <= tolerance && fit.km >= from - 5 && fit.km <= to + 5;
    return {
      km: agrees ? Math.min(Math.max(fit.km, from), to) : from,
      nextIndex: anchorIndex,
      confidence: agrees ? 'good' : 'fair',
    };
  }
  if (anchorIndex === 0) return { km: stops[0].km, nextIndex: 0, confidence: 'fair' };

  if (!fit) return { km: null, nextIndex: -1, confidence: 'none' };
  // No corroboration, and a fit that sits far from the line is not a position.
  return {
    km: fit.km,
    nextIndex: Math.min(fit.segment + 1, stops.length - 1),
    // A tight fit against the real road is worth more than a loose one against a chord.
    confidence: fit.offRouteKm > tolerance ? 'low' : (fit.viaRoad ? 'good' : 'fair'),
    viaRoad: Boolean(fit.viaRoad),
  };
}

/** The schedule, interpolated at an arbitrary point along the route. */
function scheduledMinutesAt(stops, km) {
  const timed = stops.filter((s) => s.km != null && s.scheduled != null);
  if (timed.length < 2 || km == null) return null;
  if (km <= timed[0].km) return timed[0].scheduled;

  for (let i = 1; i < timed.length; i += 1) {
    if (km <= timed[i].km) {
      const span = timed[i].km - timed[i - 1].km;
      const fraction = span > 0 ? (km - timed[i - 1].km) / span : 0;
      return timed[i - 1].scheduled + fraction * (timed[i].scheduled - timed[i - 1].scheduled);
    }
  }
  return timed[timed.length - 1].scheduled;
}

/** Minutes since midnight, on the same unwrapped scale the stop schedule uses. */
function nowMinutes(stops) {
  const now = new Date();
  const raw = now.getHours() * 60 + now.getMinutes();
  const first = stops.find((s) => s.scheduled != null);
  // An overnight trip's schedule runs past 1440; drag "now" onto the same day if needed.
  if (first && first.scheduled > raw + 720) return raw + 1440;
  return raw;
}

/**
 * How late the bus is running, in minutes. Negative means early.
 * Compares the clock against where the schedule says it should be *at this point on the route*,
 * which is more honest than comparing against the last stop it happened to pass.
 */
export function delayMinutes(stops, busKm, confidence = 'good') {
  if (confidence === 'low' || confidence === 'none') return null;
  const expected = scheduledMinutesAt(stops, busKm);
  if (expected == null) return null;
  const delay = Math.round(nowMinutes(stops) - expected);
  // Beyond a couple of hours this is far more likely to be a schedule we misread than a
  // bus that is genuinely that late, so say nothing rather than something absurd.
  return Math.abs(delay) > 120 ? null : delay;
}

/**
 * When the bus reaches a given stop.
 *
 * Prefers the schedule shifted by the delay we just measured — that quietly accounts for the
 * dwell time and traffic the timetable was built around. Falls back to distance ÷ speed when
 * there is no usable schedule.
 */
export function etaToStop(stops, targetIndex, { busKm, delay, speedKmh } = {}) {
  const target = stops[targetIndex];
  if (!target || busKm == null || target.km == null) return null;

  const remainingKm = target.km - busKm;
  if (remainingKm <= 0) return { minutes: 0, remainingKm: 0, passed: true, confidence: 'good' };

  if (target.scheduled != null && delay != null) {
    const minutes = Math.round(target.scheduled + delay - nowMinutes(stops));
    if (minutes >= 0) {
      return { minutes, remainingKm, passed: false, basis: 'schedule', confidence: 'good' };
    }
  }

  // No usable schedule. Distance over speed can still answer it — but only with a speed we
  // have actually measured. Falling back to the timetable's average speed here would mean
  // deriving an ETA from the very schedule we just decided not to trust.
  if (!speedKmh || speedKmh < MIN_USABLE_KMH) return null;
  return {
    minutes: Math.round((remainingKm / speedKmh) * 60),
    remainingKm,
    passed: false,
    basis: 'speed',
    confidence: 'fair',
  };
}

/** The next stop the bus has not yet reached, when nothing better is known. */
export function nextStopIndex(stops, busKm) {
  if (busKm == null) return -1;
  return stops.findIndex((s) => s.km != null && s.km > busKm);
}

/* ------------------------------------------------------------------ freshness */

/**
 * How much to trust the position on screen. A tracker that shows a confident dot over a
 * twenty-minute-old fix is worse than one that admits it does not know.
 */
export function freshness(lastFixAt, { staleMs = 3 * 60 * 1000, deadMs = 15 * 60 * 1000 } = {}) {
  if (!lastFixAt) return 'none';
  const age = Date.now() - lastFixAt;
  if (age > deadMs) return 'dead';
  if (age > staleMs) return 'stale';
  return 'live';
}

/**
 * How often to ask for a new position. A parked bus does not need a poll every ten seconds,
 * and one closing on your stop deserves better than every minute.
 */
export function pollInterval(base, { movement, etaMinutes, freshness: fresh } = {}) {
  let seconds = base;
  if (movement === 'stopped') seconds = base * 2;
  if (fresh === 'dead') seconds = Math.max(base * 3, 60);
  if (etaMinutes != null && etaMinutes <= 10) seconds = Math.min(seconds, 10);
  return Math.min(Math.max(Math.round(seconds), 8), 180);
}

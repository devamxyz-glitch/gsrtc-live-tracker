/**
 * ST Tracker server â€” serves the PWA and proxies the GSRTC tracking API.
 *
 * The upstream credentials stay here so the browser never holds them, and this is also where
 * the app gets the things a public deployment needs: caching, rate limiting, timeouts,
 * compression, security headers and a health check.
 *
 * Run:  node server/proxy.mjs
 * Env:  PORT, BIND, ALLOWED_ORIGINS, RATE_LIMIT_RPM, LOG_LEVEL, TRUST_PROXY
 *       (upstream credentials: see server/upstream.mjs)
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { gsrtc, ymd, UpstreamError, config as upstreamConfig } from './upstream.mjs';
import { pnrDetails, ticketHistory, tripVehicles, pnrPickupPoints, SoapError } from './gsrtc-soap.mjs';
import * as tracker from './tracker.mjs';
import * as push from './push.mjs';
import * as db from './db.mjs';
import * as geometry from './geometry.mjs';
import * as admin from './admin.mjs';
import * as uptime from './uptime.mjs';
import * as probe from './probe.mjs';
import * as harvest from './harvest.mjs';
import * as geocode from './geocode.mjs';
import { adminLogin, adminPage } from './admin-page.mjs';

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'web');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const PORT = Number(process.env.PORT || 8787);
const BIND = process.env.BIND || '0.0.0.0';
/**
 * Per-IP request ceiling. Set high on purpose: this exists to stop a runaway script, not to
 * ration real people. Indian mobile networks put large numbers of subscribers behind carrier
 * grade NAT, so one public IP can be a whole neighbourhood â€” a limit tuned for a single user
 * would lock out a rush-hour crowd sharing a Jio or Airtel exit. Cached responses cost this
 * server about 4ms and never reach the operator (see scripts/loadtest.mjs), so serving them
 * generously is cheap; the upstream is protected by the cache and the tracker's own budget,
 * not by this number.
 */
const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM || 600);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const STARTED = Date.now();

/* ------------------------------------------------------------------ logging */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
function log(level, message, extra = {}) {
  if (LEVELS[level] > LEVELS[LOG_LEVEL]) return;
  const line = { t: new Date().toISOString(), level, msg: message, ...extra };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

/* ------------------------------------------------------------------ cache */
class TtlCache {
  constructor(max = 400) { this.max = max; this.map = new Map(); }
  /** Returns { value, fresh } â€” a caller may still want an expired entry. */
  peek(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key); this.map.set(key, hit);       // refresh LRU order
    return { value: hit.value, fresh: Date.now() <= hit.expires, expires: hit.expires };
  }
  get(key) {
    const hit = this.peek(key);
    if (!hit) return undefined;
    if (!hit.fresh) { this.map.delete(key); return undefined; }
    return hit.value;
  }
  set(key, value, ttlMs) {
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
const cache = new TtlCache();
const pending = new Map();

/**
 * Runs `fn` at most once per key while in flight, and caches the result for `ttlMs`.
 *
 * `staleMs` opts into stale-while-revalidate: past the TTL but within the stale window the
 * cached copy is returned straight away and a refresh runs in the background. That is the
 * right trade for a timetable â€” a rider gets a ninety-second-old departure list instantly
 * instead of waiting three seconds for the operator to answer, and the list barely changes
 * within a day anyway. Never use it for live positions, where stale is the whole problem.
 */
async function cached(key, ttlMs, fn, { staleMs = 0 } = {}) {
  const entry = cache.peek(key);

  if (entry?.fresh) return { data: entry.value, hit: true };

  if (entry && staleMs && Date.now() - entry.expires < staleMs) {
    if (!pending.has(key)) {
      const refresh = fn()
        .then((data) => { cache.set(key, data, ttlMs); return data; })
        .catch(() => entry.value)          // keep serving the old copy if the refresh fails
        .finally(() => pending.delete(key));
      pending.set(key, refresh);
    }
    return { data: entry.value, hit: true, stale: true };
  }

  if (pending.has(key)) return { data: await pending.get(key), hit: true };
  const promise = fn().then((data) => { cache.set(key, data, ttlMs); return data; })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return { data: await promise, hit: false };
}

/* ------------------------------------------------------------------ rate limit */
const buckets = new Map();
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60000).unref();

function rateLimited(ip) {
  if (!RATE_LIMIT_RPM) return false;
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: RATE_LIMIT_RPM, at: now };
  const refill = ((now - b.at) / 60000) * RATE_LIMIT_RPM;
  b.tokens = Math.min(RATE_LIMIT_RPM, b.tokens + refill);
  b.at = now;
  if (b.tokens < 1) { buckets.set(ip, b); return true; }
  b.tokens -= 1;
  buckets.set(ip, b);
  return false;
}

/**
 * The rider's own address, for rate limiting.
 *
 * `X-Real-IP` first, because that is the one nginx *sets* â€” a single value it overwrites on every
 * request, so a client cannot choose it. `X-Forwarded-For` is a list anyone may prepend to, and
 * taking its first entry is how a header under the caller's control becomes their rate-limit
 * identity; it stays as a fallback only for a deployment that sets it and nothing else.
 *
 * Behind Cloudflare this is only meaningful once nginx runs the realip module â€” see
 * `scripts/nginx-realip.sh`. Without it every rider arrives as the same proxy address and shares
 * one token bucket, which at enough traffic is an outage for everybody at once.
 */
const clientIp = (req) => {
  if (!TRUST_PROXY) return req.socket.remoteAddress || 'unknown';
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
};

/**
 * Who made a crowd report, for the per-hour limit and the 30-second undo.
 *
 * The app sends a random id it generated and keeps locally. That is the only thing here that
 * actually distinguishes one rider from another: the IP does not, because behind the proxy every
 * request arrives from the same address â€” which meant the first person to report a bus blocked
 * everyone else for an hour, and an undo could withdraw a stranger's report.
 *
 * It is forgeable, and that is acceptable: the per-hour rule is a guard against double-reporting,
 * not a security boundary, and the token bucket on the IP is what bounds abuse. The id is hashed
 * with the same salt as before, so nothing identifying is stored either way. Requests without one
 * (an older client still on the previous version) fall back to the IP.
 */
const reporterFor = (req, body) => db.reporterHash(
  idish(body?.reporter) ? `r:${idish(body.reporter)}` : clientIp(req),
);

/* ------------------------------------------------------------------ request body */
const MAX_BODY_BYTES = 8 * 1024;   // a push subscription is ~500 bytes; nothing here is big

/** Reads and parses a JSON body, refusing anything oversized rather than buffering it. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json')) return reject(new BadRequest('expected application/json'));

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new BadRequest('invalid JSON'));
      }
    });
    req.on('error', () => reject(new BadRequest('read failed')));
  });
}

/* ------------------------------------------------------------------ validation */
class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const PLATE_RE = /^[A-Z0-9][A-Z0-9-]{3,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function plateParam(value) {
  const plate = decodeURIComponent(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!PLATE_RE.test(plate)) throw new BadRequest('invalid vehicle number');
  return plate;
}
function dateParam(value, fallback = ymd()) {
  if (!value) return fallback;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequest('invalid date');
  return value;
}
function intParam(value, { min, max, fallback }) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest('invalid number');
  return n;
}
function idParam(value, name) {
  const v = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(v)) throw new BadRequest(`invalid ${name}`);
  return v;
}
function coordParam(value, name, limit) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw new BadRequest(`invalid ${name}`);
  return n;
}
/** A push endpoint is a URL the browser chose; accept only https and a sane length. */
function endpointParam(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1024) throw new BadRequest('invalid endpoint');
  let url;
  try { url = new URL(raw); } catch { throw new BadRequest('invalid endpoint'); }
  if (url.protocol !== 'https:') throw new BadRequest('endpoint must be https');
  return raw;
}

function keyParam(value, name) {
  const raw = String(value || '').trim();
  if (!/^[A-Za-z0-9_\-]{8,256}$/.test(raw)) throw new BadRequest(`invalid ${name}`);
  return raw;
}

function textParam(value, name, max = 60) {
  const v = decodeURIComponent(value ?? '').trim();
  if (!v || v.length > max) throw new BadRequest(`invalid ${name}`);
  return v;
}
function pnrParam(value) {
  const pnr = decodeURIComponent(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{5,20}$/.test(pnr)) throw new BadRequest('invalid PNR number');
  return pnr;
}
function mobileParam(value) {
  const m = decodeURIComponent(value || '').trim().replace(/\s+/g, '');
  if (!/^\d{10}$/.test(m)) throw new BadRequest('invalid mobile number');
  return m;
}

/* ------------------------------------------------------------------ fleet cache */
const FLEET_TTL = 6 * 3600 * 1000;
const normPlate = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function fleet(date) {
  const { data } = await cached(`fleet:${date}`, FLEET_TTL, async () => {
    const rows = await gsrtc.vehicleMaster(date);
    return Array.isArray(rows) ? rows : [];
  });
  return data;
}

/* ------------------------------------------------------------------ API routes */
const TTL = {
  vehicle: 8000,        // live position â€” short, but enough to absorb a burst of clients
  trip: 15000,
  timetable: 90000,
  stations: 12 * 3600 * 1000,
  nearby: 5 * 60 * 1000,
  serviceTypes: 12 * 3600 * 1000,
  pnr: 30000,
  ticket: 60000,
};

// How long past the TTL a cached copy may still be served while it refreshes behind the
// scenes. Only for data whose staleness a rider would never notice.
const STALE = {
  // A bus position a minute old, served instantly, beats a fresh one after a thirty-second
  // wait â€” especially since the client polls again shortly and the map already animates
  // between fixes. Without this every caller queued behind a slow upstream call.
  vehicle: 60 * 1000,
  trip: 2 * 60 * 1000,
  timetable: 10 * 60 * 1000,
  nearby: 30 * 60 * 1000,
  stations: 24 * 3600 * 1000,
  serviceTypes: 24 * 3600 * 1000,
};

/** endpoint -> last test push, so the test button cannot be used as a relay. */
const testCooldown = new Map();

/**
 * What both health endpoints report.
 *
 * `/health` and `/api/health` served two hand-kept copies of this object, and a copy drifts the
 * moment one of them is edited â€” adding the harvester counters reached only one of the two.
 */
const healthBody = () => ({
  status: 'ok',
  version: PKG.version,
  uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
  upstream: new URL(upstreamConfig.host).host,
  cacheEntries: cache.map.size,
  tracker: tracker.stats(),
  push: push.stats(),
  data: db.stats(),
  geometry: geometry.stats(),
  // Whether the observed timetable is still being built is an operational question, and it has
  // already stopped silently twice.
  harvest: harvest.stats(),
  geocode: geocode.stats(),
});

const routes = {
  'GET /health': async () => ({ body: healthBody(), ttl: 0 }),

  'GET /api/health': async () => ({ body: healthBody(), ttl: 0 }),

  /**
   * Live status for one plate, plus everything the tracker has already observed about it.
   * `track` is what lets a client show speed and movement on the very first render instead
   * of waiting out two of its own polls.
   */
  'GET /api/vehicle': async (segments, query) => {
    const plate = plateParam(segments[0]);
    const date = dateParam(query.get('date'));
    const focused = query.get('focus') === '1';
    const today = date === ymd();

    // Only today's buses are worth tracking continuously; a past date never changes.
    if (today) tracker.watch(plate, { focused });

    const tracked = today ? tracker.get(plate) : null;
    if (tracked?.row && Date.now() - tracked.updatedAt < TTL.vehicle) {
      return { body: { vehicle: tracked.row, track: trackPayload(tracked) }, ttl: 5 };
    }

    const { data } = await cached(`veh:${plate}:${date}`, TTL.vehicle,
      () => gsrtc.vehicleStatus(plate, date), { staleMs: STALE.vehicle });
    const row = Array.isArray(data) ? data[0] || null : null;
    return { body: { vehicle: row, track: tracked ? trackPayload(tracked) : null }, ttl: 5 };
  },

  /**
   * Every bus running between two stations, positioned â€” the data behind the route map.
   * Registers each one with the tracker, so the second call is served from memory and the
   * map animates properly instead of jumping.
   */
  /** The VAPID public key, so the browser can subscribe. Public by design. */
  'GET /api/push/key': async () => ({
    body: { key: push.publicKey(), enabled: push.enabled },
    ttl: 3600,
  }),

  /** What people are saying about this bus, and how it usually runs. */
  /**
   * Whether the operator's system is answering, for the dot on the home screen.
   *
   * Public on purpose: when the backend is down the app looks broken, and riders blame the app
   * rather than the system it depends on. Being able to say "GSRTC is not responding" is the
   * difference between a bug report and an explanation. Short TTL â€” a status page that is a
   * minute stale is worse than none, because it is confidently wrong.
   */
  'GET /api/status': async () => {
    // Kick a fresh cycle, but answer from what is already known. Someone opening
    // this panel is the one moment the answer must be current â€” and also the worst moment to
    // make them wait on a backend that may be the very thing not responding.
    probe.refreshNow();
    return { body: uptime.snapshot(), ttl: 15 };
  },

  'GET /api/reports': async (segments, query) => {
    const plate = plateParam(segments[0]);
    // `standingInFor` is the reverse link: this bus covering someone else's trip. It travels
    // with the same payload so the client never has to ask a second question to know it.
    // `usually` answers a different question from the live reports: not "how full is this bus
    // now" but "how full is this service at this hour, normally" â€” which is what someone
    // choosing between the 08:00 and the 08:40 actually needs.
    const route = String(query.get('route') || '').trim().slice(0, 120);
    return {
      body: {
        ...db.reports.recentFor(plate),
        standingInFor: db.reports.replacementFor(plate),
        usually: route ? db.crowdingFor(route, istHour()) : null,
      },
      ttl: 20,
    };
  },

  /**
   * The road line through a trip's stops, so the map can draw the route the bus actually
   * takes. Answers `{ line: null }` rather than failing when geometry is unavailable â€” the
   * client falls back to straight lines.
   */
  'GET /api/geometry': async (_segments, query) => {
    const tripId = idParam(query.get('tripId'), 'tripId');
    const status = String(intParam(query.get('status'), { min: 0, max: 9, fallback: 1 }));
    const start = String(query.get('start') || '').slice(0, 40);

    const { data } = await cached(`trip:${tripId}:${status}:${start}`, TTL.trip,
      () => gsrtc.tripDetails({ tripId, status, start }));

    const points = (Array.isArray(data) ? data : [])
      .map((row) => [parseFloat(row.LocationLat), parseFloat(row.LocationLong)]);
    const line = await geometry.forStops(points);
    // Road shape does not change; let the browser keep it for a day.
    return { body: { line }, ttl: line ? 86400 : 60 };
  },

  /** When this service typically reaches a stop, from what we have actually observed. */
  'GET /api/reputation': async (_segments, query) => {
    const route = textParam(query.get('route'), 'route', 120);
    // Without a stop, answer for the whole route in one call â€” a trip has twenty stops and
    // twenty round trips to render a timeline would be absurd.
    // Which service, as its scheduled departure. A route pools every bus on it, and the median
    // of services fifteen hours apart is a time none of them keeps.
    const schedMin = clockToMinutes(query.get('start') || '');
    if (!query.get('stop')) {
      return { body: { route, stops: db.arrivals.reputationForRoute(route, schedMin) }, ttl: 600 };
    }
    const stop = textParam(query.get('stop'), 'stop', 80);
    return { body: db.arrivals.reputation(route, stop, schedMin) || { samples: 0 }, ttl: 600 };
  },

  /**
   * What riders have said about a page full of buses.
   *
   * Crowd reports were only ever visible once you had already chosen a bus and opened it. The
   * choosing is where they matter: a rider scanning departures wants to know that the 08:10 is
   * packed and the 08:25 has seats *before* picking one.
   */
  /**
   * Bus stands inside the map's viewport.
   *
   * Answered entirely from our own gazetteer, which fills itself from trip responses the app is
   * already making â€” so drawing every stand on every map costs the operator nothing at all.
   */
  'GET /api/stops': async (_segments, query) => {
    // By id, for "where is this station" â€” the autocomplete knows names and ids but carries no
    // coordinates, and there is no upstream call that resolves one by id.
    const ids = String(query.get('ids') || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (ids.length) return { body: db.stations.positions(ids), ttl: 3600 };

    const num = (k, min, max) => {
      const v = parseFloat(query.get(k));
      return Number.isFinite(v) && v >= min && v <= max ? v : null;
    };
    const south = num('south', -90, 90); const north = num('north', -90, 90);
    const west = num('west', -180, 180); const east = num('east', -180, 180);
    if (south === null || north === null || west === null || east === null || north < south) {
      throw new BadRequest('south, west, north and east are required');
    }
    // An hour: a bus stand does not move, and the only thing that changes is us learning a new
    // one. The client re-asks whenever the map is panned anyway.
    return { body: db.stations.inBox({ south, west, north, east }), ttl: 3600 };
  },

  'GET /api/crowd': async (_segments, query) => {
    const plates = String(query.get('plates') || '')
      .split(',').map((p) => p.trim().toUpperCase()).filter(Boolean)
      .filter((p) => PLATE_RE.test(p))
      .slice(0, 120);
    if (!plates.length) return { body: {}, ttl: 30 };
    // Short TTL on purpose: this is the one endpoint whose whole value is being current, and it
    // is answered from our own database, so it costs the operator nothing.
    return { body: db.reports.summaryFor(plates), ttl: 30 };
  },

  'GET /api/live': async (_segments, query) => {
    const from = idParam(query.get('from'), 'from');
    const to = idParam(query.get('to'), 'to');
    const date = dateParam(query.get('date'));
    const limit = intParam(query.get('limit'), { min: 1, max: 40, fallback: 25 });

    const { data } = await cached(`tt:${from}:${to}:${date}:0:1:80`, TTL.timetable,
      () => gsrtc.timetable({ from, to, date, type: '0', page: 1, pageSize: 80 }),
      { staleMs: STALE.timetable });

    const services = (Array.isArray(data) ? data : [])
      .filter((row) => /run|progress|depart|track/i.test(String(row.BusRunningStatus || '')))
      .filter((row) => row.BusNo)
      .slice(0, limit);

    tracker.watch(services.map((row) => row.BusNo));

    // Anything the tracker has not reached yet is fetched once, within a small budget, so a
    // cold map still shows buses rather than an empty rectangle.
    const missing = services.filter((row) => !tracker.get(row.BusNo)).slice(0, 6);
    await Promise.allSettled(missing.map(async (row) => {
      const key = `veh:${String(row.BusNo).toUpperCase()}:${date}`;
      await cached(key, TTL.vehicle, () => gsrtc.vehicleStatus(row.BusNo, date));
    }));

    const buses = services.map((row) => {
      const tracked = tracker.get(row.BusNo);
      const fallback = !tracked ? (cache.get(`veh:${String(row.BusNo).toUpperCase()}:${date}`) || [])[0] : null;
      const lat = parseFloat(tracked?.lat ?? fallback?.Latitude);
      const lng = parseFloat(tracked?.lng ?? fallback?.Longitude);
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
      return {
        plate: row.BusNo,
        tripId: row.TripId,
        route: row.RouteName,
        routeGu: row.RouteNameGuj,
        serviceType: row.ServiceType || row.BusServiceType,
        arrivalTime: row.ArrivalTime,
        startTime: row.ArrivalTimeAtBoarding,
        nextStop: (tracked?.row || fallback)?.NextLocation || '',
        lat,
        lng,
        speedKmh: tracked?.speedKmh ?? null,
        movement: tracked?.movement ?? 'unknown',
        updatedAt: tracked?.updatedAt ?? Date.now(),
      };
    }).filter(Boolean);

    return { body: { buses, running: services.length, tracker: tracker.stats() }, ttl: 5 };
  },

  'GET /api/stations': async (segments) => {
    const raw = segments[0] ? decodeURIComponent(segments[0]).trim() : '';
    if (!raw) return { body: [], ttl: 60 };
    const name = textParam(raw, 'station name');
    const { data } = await cached(`sta:${name.toLowerCase()}`, TTL.stations,
      () => gsrtc.stations(name), { staleMs: STALE.stations });
    // Autocomplete answers carry the id and the name together, so the gazetteer fills itself
    // from traffic that was already happening â€” no extra call to an API we reuse on sufferance.
    learnStations((data || []).map((r) =>
      [r.StationId, r.StationName, r.StationNameGuj, r.Center_Lat, r.Center_Lon]));
    return { body: data, ttl: 3600 };
  },

  'GET /api/plates': async (_segments, query) => {
    const q = normPlate(query.get('q'));
    if (q.length < 2) return { body: [], ttl: 60 };
    const rows = await fleet(ymd());
    const out = [];
    for (const row of rows) {
      if (normPlate(row.VehicleRegisteredNo).includes(q)) {
        out.push({ plate: row.VehicleRegisteredNo, depot: row.DepotName, division: row.DivisionName });
        if (out.length >= 12) break;
      }
    }
    return { body: out, ttl: 300 };
  },

  'GET /api/fleet': async (_segments, query) => {
    const date = dateParam(query.get('date'));
    return { body: await fleet(date), ttl: 3600 };
  },

  'GET /api/servicetypes': async () => {
    const { data } = await cached('svc', TTL.serviceTypes, () => gsrtc.serviceTypes(),
      { staleMs: STALE.serviceTypes });
    return { body: data, ttl: 3600 };
  },

  'GET /api/nearby': async (_segments, query) => {
    const lat = coordParam(query.get('lat'), 'lat', 90);
    const lng = coordParam(query.get('lng'), 'lng', 180);
    const key = `near:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    const { data } = await cached(key, TTL.nearby, () => gsrtc.nearbyStations(lat, lng),
      { staleMs: STALE.nearby });
    learnStations((data || []).map((r) =>
      [r.StationId, r.StationName, r.StationNameGuj, r.Center_Lat, r.Center_Lon]));
    return { body: data, ttl: 120 };
  },

  'GET /api/timetable': async (_segments, query) => {
    const from = idParam(query.get('from'), 'from');
    const to = idParam(query.get('to'), 'to');
    const date = dateParam(query.get('date'));
    const type = String(intParam(query.get('type'), { min: 0, max: 999, fallback: 0 }));
    const page = intParam(query.get('page'), { min: 1, max: 100, fallback: 1 });
    const pageSize = intParam(query.get('pageSize'), { min: 1, max: 300, fallback: 80 });
    const key = `tt:${from}:${to}:${date}:${type}:${page}:${pageSize}`;
    const { data } = await cached(key, TTL.timetable,
      () => gsrtc.timetable({ from, to, date, type, page, pageSize }),
      { staleMs: STALE.timetable });
    // No station names are learned here, however tempting the fields look. A row's
    // FromStationName is the *trip's* origin â€” "Bantva" on a Bantva-to-Narayan-Sarovar service
    // â€” while FromStID is the station that was *searched for*. Pairing them files the right id
    // under the wrong name, which is how 462 briefly became Bhuj instead of Morbi. Autocomplete
    // is the only response where the id and the name describe the same station.
    return { body: data, ttl: 60 };
  },

  'GET /api/trip': async (_segments, query) => {
    const tripId = idParam(query.get('tripId'), 'tripId');
    const status = String(intParam(query.get('status'), { min: 0, max: 9, fallback: 1 }));
    const start = String(query.get('start') || '').slice(0, 40);
    const plate = query.get('plate') ? plateParam(query.get('plate')) : '';
    // The trip rows name every stop but never the route they belong to, so the caller has to
    // supply it â€” without one, observations from unrelated services collapse together and the
    // history becomes meaningless.
    const route = String(query.get('route') || '').trim().slice(0, 120);
    const key = `trip:${tripId}:${status}:${start}`;
    const { data } = await cached(key, TTL.trip, () => gsrtc.tripDetails({ tripId, status, start }),
      { staleMs: STALE.trip });
    // Free history: this response already says when the bus reached each stop it has passed.
    // `start` is the scheduled departure, which is what makes these rows belong to one service
    // rather than to the route in general.
    if (plate && route) recordArrivals(plate, route, data, clockToMinutes(start));
    // And free station names. A trip names every stop on its route with the same ids the
    // station list uses â€” verified against Rajkot 470, Morbi 462 and Tankara 1702 â€” so this
    // fills the gazetteer far faster than autocomplete alone, which only ever learns the
    // stations somebody happened to type. Unlike the timetable rows, these ids and names do
    // describe the same place.
    // Coordinates too: these rows carry LocationLat/LocationLong and they used to be discarded,
    // which is why the app knew thousands of stand names and could not draw one on a map.
    learnStations((data || []).map((r) =>
      [r.LocationId, r.LocationName, r.LocationNameGuj, r.LocationLat, r.LocationLong]));
    return { body: data, ttl: 10 };
  },

  'GET /api/pnr': async (segments) => {
    const pnr = pnrParam(segments[0]);
    const { data } = await cached(`pnr:${pnr}`, TTL.pnr, () => pnrDetails(pnr));
    return { body: data, ttl: 30 };
  },

  'GET /api/ticket': async (_segments, query) => {
    const pnr = pnrParam(query.get('pnr'));
    const mobile = mobileParam(query.get('mobile'));
    const { data } = await cached(`tkt:${pnr}:${mobile}`, TTL.ticket, () => ticketHistory(pnr, mobile));
    return { body: data, ttl: 60 };
  },

  'GET /api/tripcode': async (segments) => {
    const code = textParam(segments[0], 'tripCode', 30);
    const { data } = await cached(`tripcode:${code}`, TTL.trip, () => tripVehicles(code));
    return { body: data, ttl: 30 };
  },

  'GET /api/pickup-points': async (_segments, query) => {
    const rawPnr = (query.get('pnr') || '').trim();
    const pnrNo = rawPnr && rawPnr !== '0' ? pnrParam(rawPnr) : '0';
    const status = String(query.get('status') || '0').slice(0, 10);
    const tripCode = String(query.get('trip') || '0').slice(0, 30);
    const vehicleNo = query.get('vehicle') ? plateParam(query.get('vehicle')) : '0';
    if (pnrNo === '0' && tripCode === '0' && vehicleNo === '0') {
      return { body: [], ttl: 300 };
    }
    const key = `pickup:${pnrNo}:${status}:${tripCode}:${vehicleNo}`;
    const { data } = await cached(key, TTL.trip, () => pnrPickupPoints({ pnrNo, status, tripCode, vehicleNo }));
    return { body: data, ttl: 60 };
  },
};

/* ------------------------------------------------------------------ POST routes */
/**
 * Writes. Everything here is anonymous: a push subscription is an opaque endpoint the browser
 * minted, and a crowd report stores only a salted hash of the reporter's address for rate
 * limiting. No accounts, no identifiers, nothing that says who anybody is.
 */
const postRoutes = {
  'POST /api/push/subscribe': async (_segments, _query, body) => {
    if (!push.enabled) throw new BadRequest('push is not configured on this server');
    const endpoint = endpointParam(body?.subscription?.endpoint);
    const p256dh = keyParam(body?.subscription?.keys?.p256dh, 'p256dh');
    const auth = keyParam(body?.subscription?.keys?.auth, 'auth');
    const subId = db.subscriptions.upsert({ endpoint, p256dh, auth });

    // A subscription on its own does nothing; it is only useful attached to an alert.
    if (body?.alert) {
      const plate = plateParam(body.alert.plate);
      db.alerts.add({
        subId,
        plate,
        label: String(body.alert.label || '').slice(0, 80),
        lat: coordParam(body.alert.lat, 'lat', 90),
        lng: coordParam(body.alert.lng, 'lng', 180),
        radiusKm: Math.min(20, Math.max(0.2, Number(body.alert.radiusKm) || 1)),
      });
      tracker.watch(plate);   // start following it now, not on the next sweep
    }
    return { body: { ok: true, pendingAlerts: db.alerts.pendingCount() } };
  },

  'POST /api/push/cancel': async (_segments, _query, body) => {
    const endpoint = endpointParam(body?.endpoint);
    const subId = db.subscriptions.upsert({
      endpoint,
      p256dh: keyParam(body?.keys?.p256dh, 'p256dh'),
      auth: keyParam(body?.keys?.auth, 'auth'),
    });
    if (body?.plate) db.alerts.removeFor(subId, plateParam(body.plate));
    else db.subscriptions.remove(endpoint);
    return { body: { ok: true } };
  },

  /**
   * Anonymous feature counters from the app.
   *
   * A strict allowlist, not free-form strings: the client can only ever increment a counter
   * that already exists here, so a future bug â€” or a hostile caller â€” cannot turn this into a
   * place to store arbitrary text about somebody. Nothing about the caller is recorded, not
   * even the salted hash the report limiter uses; there is only a name and a tally.
   */
  'POST /api/stat': async (_segments, _query, body, req) => {
    // Ids are opaque to the server: it stores what the app generated and never derives one from
    // the request, so a device that clears its id is genuinely a new device rather than one the
    // server can re-link by address or fingerprint.
    const session = idish(body?.session);
    const device = idish(body?.device);
    if (!session || !device) throw new BadRequest('session and device are required');

    db.analytics.touch({
      session,
      device,
      platform: platformOf(req.headers['user-agent']),
      standalone: body?.standalone === true,
      lang: String(body?.lang || '').slice(0, 5),
      entry: STAT_EVENTS.has(String(body?.entry)) ? String(body.entry) : '',
    });

    const events = Array.isArray(body?.events) ? body.events.slice(0, 60) : [];
    let counted = 0;
    for (const raw of events) {
      const name = String(raw?.name ?? raw ?? '');
      if (!STAT_EVENTS.has(name)) continue;
      db.metrics.bump('event', name);
      // Detail is constrained to a plate. The column is free text, and the one thing that must
      // never end up in it is anything a rider typed â€” a validated plate cannot be a message.
      const detail = /^[A-Z]{2}-?[0-9]{1,2}-?[A-Z]{0,3}-?[0-9]{1,4}$/i.test(String(raw?.detail || ''))
        ? String(raw.detail).toUpperCase() : '';
      db.analytics.record(session, device, name, detail);
      counted += 1;
    }
    return { body: { ok: true, counted } };
  },

  /**
   * Erases everything ever recorded for a device.
   *
   * The app cannot prove which device it is â€” the id is the only claim â€” but that is the same
   * id that produced the data in the first place, so anyone able to ask is the device whose
   * data it is. Deletes rather than flags: a policy that promises erasure has to erase.
   */
  'POST /api/stat/forget': async (_segments, _query, body) => {
    const device = idish(body?.device);
    if (!device) throw new BadRequest('device is required');
    return { body: { ok: true, ...db.analytics.forget(device) } };
  },

  'POST /api/report/undo': async (_segments, _query, body, req) => {
    const plate = plateParam(body?.plate);
    const reporter = reporterFor(req, body);
    // Nothing to authenticate beyond the reporter hash: it is the same identity the per-hour
    // limit already uses, so a rider can only ever withdraw their own report.
    const undone = db.reports.undo(plate, reporter);
    return {
      body: {
        ok: true, undone,
        ...db.reports.recentFor(plate),
        standingInFor: db.reports.replacementFor(plate),
      },
    };
  },

  'POST /api/push/test': async (_segments, _query, body) => {
    if (!push.enabled) throw new BadRequest('push is not configured on this server');
    const endpoint = endpointParam(body?.subscription?.endpoint);
    const p256dh = keyParam(body?.subscription?.keys?.p256dh, 'p256dh');
    const auth = keyParam(body?.subscription?.keys?.auth, 'auth');

    // One test per endpoint per minute. The keys already stop anyone testing someone else's
    // device; this stops our VAPID identity being used as a free relay to hammer one.
    const now = Date.now();
    const last = testCooldown.get(endpoint) || 0;
    if (now - last < 60000) {
      return { body: { ok: false, reason: 'wait', retryInSec: Math.ceil((60000 - (now - last)) / 1000) } };
    }
    testCooldown.set(endpoint, now);
    if (testCooldown.size > 5000) testCooldown.clear();   // bounded; losing it only forgives waits

    const subId = db.subscriptions.upsert({ endpoint, p256dh, auth });
    const result = await push.sendTest({ endpoint, p256dh, auth, sub_id: subId });
    return { body: result };
  },

  'POST /api/report': async (_segments, _query, body, req) => {
    const plate = plateParam(body?.plate);
    const kind = String(body?.kind || '');
    if (!db.REPORT_KINDS.includes(kind)) throw new BadRequest('unknown report kind');

    // An occupancy report may arrive as an exact headcount (the slider) or as a bare rung.
    // The count is authoritative when present: the rung is derived from it, so the two can
    // never disagree in storage.
    let level = db.OCCUPANCY[kind] ?? null;
    let headcount = null;
    if (body?.headcount !== undefined && body?.headcount !== null) {
      const n = Number(body.headcount);
      if (!Number.isInteger(n) || n < -db.SEATS_FREE_MAX || n > db.STANDING_MAX) {
        throw new BadRequest('headcount out of range');
      }
      headcount = n;
      level = db.levelForHeadcount(n);
    }

    // A replacement is only useful if it names the bus that actually turned up, and plateParam
    // rejects anything that is not a plate â€” so a mistyped one is refused rather than stored
    // and shown to the next rider as fact.
    let detail = '';
    if (kind === 'replaced') {
      detail = plateParam(body?.replacement);
      if (detail === plate) throw new BadRequest('a bus cannot replace itself');
    }

    const reporter = reporterFor(req, body);
    if (db.reports.recentlyReported(plate, reporter, { occupancy: level !== null })) {
      // Not an error â€” the report simply does not count twice.
      return {
        body: {
          ok: true, counted: false,
          ...db.reports.recentFor(plate),
          standingInFor: db.reports.replacementFor(plate),
        },
      };
    }
    db.reports.add({
      plate, kind, level, headcount, detail, route: String(body?.route || '').slice(0, 120),
      serviceDay: ymd(), reporter,
    });
    return {
      body: {
        ok: true, counted: true, undoMs: db.UNDO_MS,
        ...db.reports.recentFor(plate),
        standingInFor: db.reports.replacementFor(plate),
      },
    };
  },
};

/** "4:59PM" / " 4:59:14 PM" -> minutes past midnight, or null. */
function clockToMinutes(value) {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])M/i.exec(String(value || '').trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (/p/i.test(m[3])) hour += 12;
  return hour * 60 + Number(m[2]);
}

/**
 * Banks the arrival times a trip response already contains.
 *
 * A stop the bus has passed carries a real `ArrivedTime`; one it has not is blank. Over enough
 * days this builds the picture the operator does not publish â€” when a service *typically*
 * reaches a stop, as opposed to when the timetable claims it will. Costs nothing: this data
 * arrived because a rider opened the route view.
 */
function recordArrivals(plate, route, rows, schedMin = -1) {
  if (!Array.isArray(rows) || !rows.length) return;
  const day = ymd();
  for (const row of rows) {
    const arrivedMin = clockToMinutes(row.ArrivedTime);
    const stopName = String(row.LocationName || '').trim();
    if (arrivedMin === null || !stopName) continue;
    try {
      db.arrivals.record({ plate, route, stopName, serviceDay: day, arrivedMin, schedMin });
    } catch { /* history is a bonus; never fail the request for it */ }
  }
}

/** Trims a tracker snapshot down to what a client needs to seed its own history. */
function trackPayload(snap) {
  return {
    fixes: snap.fixes,
    speedKmh: snap.speedKmh,
    speedConfidence: snap.speedConfidence,
    movement: snap.movement,
    stillForMs: snap.stillForMs,
    updatedAt: snap.updatedAt,
    samples: snap.samples,
  };
}

/* ------------------------------------------------------------------ static */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;
// Filenames are not content-hashed, so JS/CSS/HTML must revalidate on every load â€”
// otherwise a deploy can leave a browser running last hour's script against this hour's markup.
// The ETag makes that revalidation a cheap 304. Images and fonts are immutable enough to cache.
const REVALIDATE = /\.(html|js|mjs|css|webmanifest|json|map)$/;
const KNOWN_SPA_ROUTES = new Set(['', '/', '/home', '/track', '/routes', '/nearby', '/settings']);

/**
 * Paths a browser asks for on its own, wherever they happen to point.
 *
 * `/favicon.ico` is requested at the root regardless of the `<link rel="icon">` tags â€” on any
 * response that is not the app shell, and by anything that never parses the markup. It was
 * answering 404 several dozen times a day, which is noise in a log that should be quiet enough
 * for a real fault to stand out.
 */
const STATIC_ALIASES = new Map([['/favicon.ico', '/icons/favicon.png']]);

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : (STATIC_ALIASES.get(pathname) || pathname);
  const file = path.normalize(path.join(WEB_DIR, decodeURIComponent(rel)));
  if (rel === '/js/map.js') {
    try {
      const key = process.env.CARTO_BASEMAP_KEY || '';
      const raw = await fsp.readFile(file, 'utf8');

      const injected = raw.replace(
        /(\{r\}\.png)(?!\?key=)/g,
        '$1' + (key ? `?key=${encodeURIComponent(key)}` : ''),
      );

      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(injected);
    } catch {
      return send(req, res, 500, { error: 'map asset failed' });
    }
  }
  if (!file.startsWith(WEB_DIR + path.sep) && file !== path.join(WEB_DIR, 'index.html')) {
    return send(req, res, 403, { error: 'forbidden' });
  }

  let stat;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    // Known client SPA routes get the shell so bookmarking/deep-linking works
    if (KNOWN_SPA_ROUTES.has(pathname)) return serveStatic(req, res, '/index.html');
    return send(req, res, 404, { error: 'not found' });
  }

  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const cacheControl = REVALIDATE.test(file) || rel === '/' ? 'no-cache' : 'public, max-age=604800';

  const body = await fsp.readFile(file);
  return sendBuffer(req, res, 200, body, { 'content-type': type, etag, 'cache-control': cacheControl });
}

/* ------------------------------------------------------------------ responses */
function baseHeaders(req) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // Tile hosts, and nothing else. Named explicitly rather than widened to https: so that a
      // future style cannot quietly start fetching images from anywhere.
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://tile.openstreetmap.org",
      "connect-src 'self'",
      "font-src 'self'",
      "manifest-src 'self'",
    ].join('; '),
  };
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin, Accept-Encoding';
  } else {
    headers.vary = 'Accept-Encoding';
  }
  return headers;
}

async function sendBuffer(req, res, status, buffer, headers) {
  const merged = { ...baseHeaders(req), ...headers };
  const type = merged['content-type'] || '';
  const accept = String(req.headers['accept-encoding'] || '');

  if (buffer.length > 1024 && COMPRESSIBLE.test(type)) {
    try {
      if (/\bbr\b/.test(accept)) {
        buffer = await brotli(buffer); merged['content-encoding'] = 'br';
      } else if (/\bgzip\b/.test(accept)) {
        buffer = await gzip(buffer); merged['content-encoding'] = 'gzip';
      }
    } catch { /* fall through uncompressed */ }
  }

  merged['content-length'] = buffer.length;
  res.writeHead(status, merged);
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

/**
 * Every event the app is allowed to count. Adding one is a deliberate edit here, which is the
 * point: the set of things measured stays small, readable, and obviously free of anything that
 * describes a person rather than a feature.
 */
const STAT_EVENTS = new Set([
  // which screens get used
  'screen:home', 'screen:track', 'screen:routes', 'screen:nearby', 'screen:settings',
  // what people actually do
  'act:alert-on', 'act:alert-off', 'act:save', 'act:share', 'act:route-view',
  'act:report-occupancy', 'act:report-status', 'act:report-undo', 'act:report-open',
  'act:pnr', 'act:helpline', 'act:locate', 'act:set-stop', 'act:commute-add',
  // onboarding, which is where people are lost or kept
  'onboard:tour-start', 'onboard:tour-done', 'onboard:tour-skip',
  'onboard:primer-shown', 'onboard:install-shown', 'onboard:install-accepted',
  // how it is being run and configured
  'app:standalone', 'app:browser', 'app:offline',
  'set:lang-en', 'set:lang-gu', 'set:theme-dark', 'set:theme-light', 'set:theme-system',
  'set:text-large', 'set:map-standard', 'set:map-detailed', 'set:map-roads', 'set:map-satellite',
  // where riders arrive from, which says whether shared links and the install are working
  'entry:direct', 'entry:deep-link-plate', 'entry:deep-link-route', 'entry:notification',
  // features whose usage decides whether they earn their maintenance
  'act:track', 'act:track-from-home', 'act:show-departed',
  'act:pnr-found', 'act:pnr-missing', 'act:map-fullscreen', 'act:routes-map',
  'act:filter-service', 'act:sort-change', 'act:swap-stations', 'act:recent-tap',
  'act:support-tap', 'act:test-notification',
  // things going wrong where only the client can see them
  'err:api', 'err:offline-view', 'err:no-data', 'err:location-denied', 'err:push-denied',
  'err:timeout', 'err:track-failed', 'err:routes-empty',

  // How the app performs on real phones and real networks. Measured on the device because a
  // server timing of 14ms says nothing about a rider on 3G in Morbi.
  'perf:boot-fast', 'perf:boot-ok', 'perf:boot-slow',
  'net:4g', 'net:3g', 'net:2g', 'net:slow',
  'screen:small', 'screen:large',

  // Where the app fails to answer a question someone asked, which is where features come from.
  'miss:station', 'miss:no-buses', 'miss:no-trip',

  // How long a screen actually held attention. Bucketed, never a timestamp trail.
  'dwell:track-long', 'dwell:routes-long', 'dwell:home-long',
]);

/* ------------------------------------------------------------------ metrics helpers */

const IST_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
});
const istHour = () => IST_HOUR.format(new Date()).padStart(2, '0');

/** A client-generated id: opaque, bounded, and never interpreted. */
/** Never let learning a name break the request that supplied it. */
function learnStations(pairs) {
  try { db.stations.learn(pairs); } catch { /* the gazetteer is a convenience, not a dependency */ }
}

const idish = (v) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v || '')) ? String(v) : '');

/**
 * Which kind of device asked, in three buckets.
 *
 * Deliberately coarse. A full user-agent string is close to a fingerprint â€” enough entropy to
 * single someone out â€” while "android / ios / desktop" answers the only question worth asking
 * (where should effort go) and identifies nobody.
 */
function platformOf(ua = '') {
  const s = String(ua);
  if (/android/i.test(s)) return 'android';
  if (/iphone|ipad|ipod/i.test(s)) return 'ios';
  if (/mobile/i.test(s)) return 'other-mobile';
  return 'desktop';
}

/* ------------------------------------------------------------------ admin */

const sendHtml = (req, res, status, html, nonce) => sendBuffer(req, res, status, Buffer.from(html), {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  // The dashboard is the one page that must never be indexed or embedded anywhere.
  'x-robots-tag': 'noindex, nofollow',
  // The app's policy is `script-src 'self'`, which blocks inline scripts â€” and the dashboard is
  // a single self-contained page with its own. A per-response nonce lets exactly that one
  // script run, rather than allowing inline scripts across the whole origin, which would undo
  // the protection everywhere for the sake of one page nobody but the owner ever loads.
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    // A nonce covers <style> blocks but not inline style attributes, and the bars size
    // themselves with one. Scoped to attributes only, so a <style> block still needs the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://tile.openstreetmap.org",
    "connect-src 'self'",
  ].join('; '),
});

async function handleAdmin(req, res, url) {
  // Unset password means the surface does not exist. A deployment that forgets to configure it
  // is closed rather than open, and 404 rather than 403 so its absence is not advertised.
  if (!admin.enabled) return send(req, res, 404, { error: 'not found' });

  const ip = clientIp(req);
  const nonce = crypto.randomBytes(16).toString('base64');
  const authed = admin.validSession(admin.readCookie(req.headers.cookie));
  // Secure unless we are plainly on a local dev host. Deriving this from `x-forwarded-proto`
  // alone silently produced a cookie without `Secure` in production, because nginx here does
  // not set that header â€” and a session cookie that will ride along a plaintext request is
  // exactly the thing the flag exists to prevent. Failing *closed* means the worst case is a
  // dev box that cannot log in over http, which is loud and harmless.
  const host = String(req.headers.host || '').split(':')[0];
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const secure = !local || (req.headers['x-forwarded-proto'] || '').includes('https');

  if (req.method === 'POST' && url.pathname === '/admin/login') {
    const blockedFor = admin.loginBlocked(ip);
    if (blockedFor) {
      return sendHtml(req, res, 429, adminLogin(nonce, `Too many attempts. Try again in ${blockedFor}s.`), nonce);
    }
    const body = await readJson(req).catch(() => null);
    if (!admin.checkPassword(body?.password)) {
      admin.noteFailure(ip);
      log('warn', 'admin login failed', { ip });
      return sendHtml(req, res, 401, adminLogin(nonce, 'That is not the password.'), nonce);
    }
    admin.noteSuccess(ip);
    log('info', 'admin login', { ip });
    return sendBuffer(req, res, 204, Buffer.alloc(0), {
      'set-cookie': admin.sessionCookie(admin.issueSession(), { secure }),
    });
  }

  if (req.method === 'POST' && url.pathname === '/admin/logout') {
    return sendBuffer(req, res, 204, Buffer.alloc(0), { 'set-cookie': admin.clearCookie() });
  }

  if (url.pathname === '/admin/stats') {
    if (!authed) return send(req, res, 401, { error: 'not signed in' });
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 1));
    return send(req, res, 200, adminStats(days), { 'cache-control': 'no-store' });
  }

  if (url.pathname !== '/admin') return send(req, res, 404, { error: 'not found' });
  return sendHtml(req, res, 200, authed ? adminPage(nonce) : adminLogin(nonce), nonce);
}

/**
 * Everything the dashboard shows.
 *
 * Every figure is an aggregate keyed on a bus, a route or an endpoint â€” never on a person.
 * There is no identifier in the database to group by, which is what keeps the app's own
 * "no tracking" promise true by construction rather than by good intentions.
 */
/**
 * Turns "470>462" into "Rajkot to Morbi".
 *
 * Falls back to the bare id for anything not yet learned, rather than hiding the row: a route
 * nobody has autocompleted is still a route somebody searched, and dropping it would quietly
 * understate the numbers.
 */
function namedRoutes(rows) {
  const ids = rows.flatMap((r) => String(r.key).split('>'));
  const names = db.stations.names(ids);
  return rows.map((r) => {
    const [from, to] = String(r.key).split('>');
    return { ...r, key: `${names[from] || from} to ${names[to] || to}` };
  });
}

function adminStats(days = 1) {
  const day = db.today();
  const { from, to } = db.analytics.range(days);
  return {
    day,
    range: { from, to, days },
    server: {
      version: PKG.version,
      uptimeSec: Math.round((Date.now() - STARTED) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      cacheEntries: cache.map.size,
    },
    traffic: {
      requests: db.metrics.totalFor('endpoint', day),
      byEndpoint: db.metrics.top('endpoint', { day, limit: 14 }),
      dailyRequests: db.metrics.daily('endpoint', 14),
    },
    buses: {
      lookupsToday: db.metrics.totalFor('plate', day),
      topPlates: db.metrics.top('plate', { day, limit: 12 }),
      watchedNow: tracker.stats().watching,
    },
    routes: {
      searchesToday: db.metrics.totalFor('route', day),
      topRoutes: namedRoutes(db.metrics.top('route', { day, limit: 12 })),
    },
    people: {
      ...db.analytics.overviewRange(from, to),
      retention: db.analytics.retention(day),
      cohorts: db.analytics.cohorts(14),
      daily: db.analytics.daily(30),
      hours: db.analytics.hoursRange(from, to),
      platforms: db.analytics.platformsRange(from, to),
      entries: db.analytics.entriesRange(from, to),
      firstScreens: db.analytics.firstScreens(day),
      recent: db.analytics.recentSessions(25),
      busHistory: db.analytics.busHistory(from, to, 60),
      regulars: db.analytics.regulars(from, to, 40),
      sessionList: db.analytics.sessionList(from, to, 300),
      eventCounts: db.analytics.eventsRange(from, to, 200),
      funnels: {
        // The two walkthrough steps are gone with the walkthrough itself: `onboard:tour-start`
        // and `onboard:tour-done` are only emitted by tour.js, which is switched off, so they
        // sat at zero for ever and made the whole funnel read as broken.
        onboarding: db.analytics.funnelRange([
          ['Opened the app', 'app:browser'],
          ['Saw the permission ask', 'onboard:primer-shown'],
          ['Installed', 'onboard:install-accepted'],
        ], from, to),
        alerts: db.analytics.funnelRange([
          ['Opened Track', 'screen:track'],
          ['Viewed a route', 'act:route-view'],
          ['Chose a stop', 'act:set-stop'],
          ['Set an alert', 'act:alert-on'],
        ], from, to),
      },
    },
    usage: {
      // Sorted by hour rather than by count: the shape of a commuter day only reads in order.
      byHour: db.metrics.top('hour', { day, limit: 24 }).sort((a, b) => a.key.localeCompare(b.key)),
      platforms: db.metrics.top('platform', { day, limit: 6 }),
      events: db.metrics.top('event', { day, limit: 40 }),
      dailyEvents: db.metrics.daily('event', 14),
    },
    community: {
      occupancy: db.occupancyToday(day),
      replacements: db.replacementsToday(day),
      ...db.stats(),
    },
    push: push.stats(),
    tracker: tracker.stats(),
    geometry: geometry.stats(),
    uptime: uptime.all(),
    probe: probe.stats(),
    harvest: harvest.stats(),
  };
}

function send(req, res, status, body, extra = {}) {
  return sendBuffer(req, res, status, Buffer.from(JSON.stringify(body)),
    { 'content-type': 'application/json; charset=utf-8', ...extra });
}

/* ------------------------------------------------------------------ server */
const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const requestId = crypto.randomUUID().slice(0, 8);
  res.setHeader('x-request-id', requestId);

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(req, res, 400, { error: 'bad request' });
  }

  const finish = (status) => log(status >= 500 ? 'error' : 'info', 'request', {
    id: requestId, method: req.method, path: url.pathname, status,
    ms: Number(process.hrtime.bigint() - started) / 1e6,
  });
  res.on('finish', () => finish(res.statusCode));

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...baseHeaders(req),
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': 'accept, content-type',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return send(req, res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD, POST, OPTIONS' });
  }
  // Writes are API-only; there is nothing to POST to a static file. The admin login is the one
  // exception, and it only exists when a password has been configured.
  if (req.method === 'POST' && !url.pathname.startsWith('/api/')
      && !(admin.enabled && url.pathname.startsWith('/admin'))) {
    return send(req, res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD, OPTIONS' });
  }

  if (url.pathname === '/health') {
    const handler = routes['GET /health'];
    const { body, ttl } = await handler([], url.searchParams);
    return send(req, res, 200, body, {
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
    });
  }

  // Digital Asset Links: proves to Android that this site and the TWA app are the same
  // party, which is what removes the browser chrome. Served from env so the fingerprint is
  // never committed, and 404s honestly until a signing key exists.
  if (url.pathname === '/.well-known/assetlinks.json') {
    const fingerprint = (process.env.TWA_FINGERPRINT || '').trim();
    const pkg = process.env.TWA_PACKAGE || 'in.shivrajsinh.sttracker';
    if (!fingerprint) return send(req, res, 404, { error: 'no TWA app is linked to this site' });
    return send(req, res, 200, [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [fingerprint] },
    }], { 'cache-control': 'public, max-age=3600' });
  }

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    return handleAdmin(req, res, url);
  }

  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  if (rateLimited(clientIp(req))) {
    return send(req, res, 429, { error: 'too many requests' }, { 'retry-after': '30' });
  }

  const segments = url.pathname.split('/').filter(Boolean);      // ['api', kind, ...rest]

  // Aggregate counters for the dashboard. Keyed on the thing requested, never on the requester
  // â€” there is no identifier recorded here to group by, which is what keeps the app's own
  // "no tracking" promise true by construction rather than by remembering to be careful.
  try {
    db.metrics.bump('endpoint', segments[1] || 'root');
    // Only well-formed keys are counted. The bump happens before the route handler validates
    // anything, so without this a rejected request still left its junk in the table â€” the QA
    // suite's own XSS probe showed up in "most tracked buses" â€” and anyone could have padded
    // the table with arbitrary strings simply by asking for them.
    const plate = decodeURIComponent(segments[2] || '');
    if (segments[1] === 'vehicle' && /^[A-Z]{2}-?[0-9]{1,2}-?[A-Z]{0,3}-?[0-9]{1,4}$/i.test(plate)) {
      db.metrics.bump('plate', plate.toUpperCase());
    }
    if (segments[1] === 'timetable') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (/^\d{1,7}$/.test(from || '') && /^\d{1,7}$/.test(to || '')) {
        db.metrics.bump('route', `${from}>${to}`);
      }
    }
    // When the app is used, in IST â€” the shape of a commuter day, which is what tells you
    // whether the morning board or the evening one deserves the next piece of work.
    db.metrics.bump('hour', istHour());
    // Which platforms actually turn up. This is the number that decides whether the iOS work
    // or the Play Store wrapper is worth doing, and guessing it would be guessing badly.
    db.metrics.bump('platform', platformOf(req.headers['user-agent']));
  } catch { /* metrics are never worth failing a request over */ }

  try {
    if (req.method === 'POST') {
      // Nested paths like /api/push/subscribe need two segments to identify the route.
      const twoPart = `POST /api/${segments[1] || ''}/${segments[2] || ''}`;
      const onePart = `POST /api/${segments[1] || ''}`;
      const handler = postRoutes[twoPart] || postRoutes[onePart];
      if (!handler) return send(req, res, 404, { error: 'unknown endpoint' });

      const payload = await readJson(req);
      const rest = postRoutes[twoPart] ? segments.slice(3) : segments.slice(2);
      const { body } = await handler(rest, url.searchParams, payload, req);
      return send(req, res, 200, body, { 'cache-control': 'no-store' });
    }

    const handler = routes[`GET /api/${segments[1] || ''}`]
      || routes[`GET /api/${segments[1] || ''}/${segments[2] || ''}`];
    if (!handler) return send(req, res, 404, { error: 'unknown endpoint' });

    const nested = !routes[`GET /api/${segments[1] || ''}`];
    const { body, ttl } = await handler(segments.slice(nested ? 3 : 2), url.searchParams);
    return send(req, res, 200, body, {
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
    });
  } catch (e) {
    if (e instanceof BadRequest) return send(req, res, 400, { error: e.message });
    if (e instanceof UpstreamError || e instanceof SoapError) {
      log('warn', 'upstream failure', { id: requestId, path: url.pathname, detail: e.detail, message: e.message });
      return send(req, res, e.status, { error: e.message, detail: e.detail || undefined });
    }
    log('error', 'unhandled', { id: requestId, path: url.pathname, message: e?.message, stack: e?.stack });
    return send(req, res, 500, { error: 'internal error' });
  }
});

server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 65000;

try {
  db.open();
} catch (e) {
  log('error', 'database unavailable â€” push, history and reports are disabled', { message: e.message });
}

/**
 * Housekeeping.
 *
 * Nothing was calling the sweeps, so every table this app has ever written was growing without
 * limit â€” reports and fired alerts included, long before analytics existed. On a 1 GB instance
 * that is a slow leak with a hard floor. Runs shortly after boot so a fresh deploy tidies up,
 * then every six hours.
 *
 * Retention is deliberate rather than incidental: the privacy policy tells riders their
 * analytics are deleted after 90 days, and this is the code that has to make that true.
 */
function housekeeping() {
  try {
    db.reports.sweep();
    db.alerts.sweep();
    db.analytics.sweep(90);
    db.metrics.sweep(180);
    log('info', 'housekeeping done', db.stats());
  } catch (e) {
    log('warn', 'housekeeping failed', { message: e.message });
  }
}
setTimeout(housekeeping, 60000).unref();
setInterval(housekeeping, 6 * 3600 * 1000).unref();

probe.start();
harvest.start(db);
geocode.start(db);
// One-off, well after boot so a deploy is never a burst.
// Wrapped, not just `.catch()`: a missing export throws *synchronously* inside the timer
// callback, where there is no promise to catch it â€” which is how a refactor that dropped this
// function turned into an uncaught exception firing every 45 seconds in production.
setTimeout(() => {
  try { probe.warmStations(db)?.catch?.(() => {}); }
  catch (e) { log('warn', 'station warm failed to start', { message: e.message }); }
}, 45000).unref();

// Coordinates, after the names â€” the name sweep is 26 quick calls and this one is a few
// thousand slow ones, so letting it start first keeps the gazetteer usable sooner. Same
// synchronous-throw guard, for the same reason.
setTimeout(() => {
  try { probe.warmStandCoordinates(db)?.catch?.(() => {}); }
  catch (e) { log('warn', 'stand coordinate warm failed to start', { message: e.message }); }
}, 60000).unref();

const restored = tracker.restore();

server.listen(PORT, BIND, () => {
  log('info', 'listening', {
    trackerRestored: restored,
    url: `http://localhost:${PORT}/`,
    upstream: new URL(upstreamConfig.host).host,
    rateLimitRpm: RATE_LIMIT_RPM,
    version: PKG.version,
  });
});

/* ------------------------------------------------------------------ lifecycle */
process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', { message: String(e) }));
process.on('uncaughtException', (e) => log('error', 'uncaughtException', { message: e?.message, stack: e?.stack }));

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log('info', 'shutting down', { signal });
    server.close(async () => {
      await tracker.shutdown();   // flush the history so a deploy restarts warm
      db.close();
      process.exit(0);
    });
    setTimeout(async () => {
      await tracker.shutdown().catch(() => {});
      process.exit(0);
    }, 8000).unref();
  });
}



/* Client side of the API. Every call goes through the app's own proxy — the browser never
   holds upstream credentials. Adds timeouts, one retry on transient failure, and request
   de-duplication so a fast-typing user does not open twenty sockets. */

const SAME_ORIGIN = `${location.protocol}//${location.host}`;
// When the page is opened straight off the filesystem or a different dev port, fall back to the proxy.
const BASE = location.protocol === 'file:' ? 'http://localhost:8787'
  : (location.port && location.port !== '8787' && location.hostname === 'localhost')
    ? 'http://localhost:8787' : SAME_ORIGIN;

const DEFAULT_TIMEOUT = 12000;
const inflight = new Map();

export class ApiError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind;          // 'network' | 'upstream' | 'http' | 'abort'
    this.status = status;
  }
}

async function once(path, { timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const onOuterAbort = () => ctl.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetch(BASE + path, { signal: ctl.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const msg = body?.error || `HTTP ${res.status}`;
      throw new ApiError(res.status === 502 || res.status === 504 ? 'upstream' : 'http', msg, res.status);
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') {
      throw new ApiError(signal?.aborted ? 'abort' : 'network', 'timeout');
    }
    throw new ApiError('network', e.message || 'network error');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** GET with de-duplication and one retry for transient failures. */
export async function get(path, opts = {}) {
  // A caller that brought its own AbortController owns this request's lifecycle. Sharing a
  // promise with it means one caller's abort rejects everyone else's call — and, worse, a
  // poll that aborts its predecessor would immediately adopt that same dying promise.
  if (opts.signal) return withRetry(path, opts);
  if (inflight.has(path)) return inflight.get(path);
  const p = withRetry(path, opts).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function withRetry(path, opts) {
  try {
    return await once(path, opts);
  } catch (e) {
    if (e.kind === 'network' || e.kind === 'upstream') {
      await new Promise((r) => setTimeout(r, 600));
      return once(path, opts);
    }
    throw e;
  }
}

const q = encodeURIComponent;

/** The write half of the API. Small JSON bodies only; nothing here is big or streamed. */
async function post(path, payload, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError('http', body?.error || `HTTP ${res.status}`, res.status);
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e.name === 'AbortError' ? 'network' : 'network', e.message || 'network error');
  } finally {
    clearTimeout(timer);
  }
}
const arr = (v) => (Array.isArray(v) ? v : []);

export const api = {
  base: BASE,
  health: () => get('/api/health', { timeout: 4000 }),

  /**
   * Live status for a plate, plus whatever the server has already been tracking for it.
   * Pass `focus` when this is the bus the user is looking at — the server polls those more
   * often. Returns `{ vehicle, track }`; `track` is null when the server has nothing yet.
   */
  async vehicle(plate, { date, focus = false, ...opts } = {}) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (focus) params.set('focus', '1');
    const query = params.toString();
    const body = await get(`/api/vehicle/${q(plate)}${query ? `?${query}` : ''}`, opts);
    return { vehicle: body?.vehicle || null, track: body?.track || null };
  },

  /** Every bus currently running between two stations, positioned — powers the route map. */
  async live({ from, to, date, limit = 25 }, opts) {
    const body = await get(`/api/live?from=${q(from)}&to=${q(to)}&date=${q(date)}&limit=${limit}`,
      { timeout: 20000, ...opts });
    return { buses: arr(body?.buses), running: body?.running || 0 };
  },

  /* -------------------------------------------------------------- push + reports */
  status: () => get('/api/status', { timeout: 6000 }),
  pushKey: () => get('/api/push/key', { timeout: 8000 }),
  pushSubscribe: (payload) => post('/api/push/subscribe', payload),
  pushCancel: (payload) => post('/api/push/cancel', payload),
  pushTest: (payload) => post('/api/push/test', payload),
  reportUndo: (payload) => post('/api/report/undo', payload),
  stat: (payload) => post('/api/stat', payload),
  statForget: (payload) => post('/api/stat/forget', payload),

  /** Tell the server what this bus is actually like right now. */
  report: (payload) => post('/api/report', payload),
  reports: (plate, route) => get(
    `/api/reports/${q(plate)}${route ? `?route=${encodeURIComponent(route)}` : ''}`,
    { timeout: 8000 },
  ),

  /** How a service usually runs at a stop; `{ samples: 0 }` when there is not enough data. */
  reputation: (route, stop, start) =>
    get(`/api/reputation?route=${q(route)}&stop=${q(stop)}&start=${q(start || '')}`, { timeout: 8000 }),

  /** The road line through a trip's stops; `null` when unavailable — draw straight lines then. */
  geometry: async ({ tripId, status = 1, start }, opts) => {
    const body = await get(`/api/geometry?tripId=${q(tripId)}&status=${q(status)}`
      + `&start=${q(start || '')}`, { timeout: 25000, ...opts });
    return body?.line || null;
  },

  /** Typical arrival times for every stop on a route we have enough data for. */
  /** Where particular stations are. Absent from the reply means we have not learned it yet. */
  stopPositions: (ids) => get(`/api/stops?ids=${q((ids || []).join(','))}`, { timeout: 6000 }),

  /** Bus stands inside a map viewport. Answered from our own gazetteer, never the operator. */
  stops: ({ south, west, north, east }) =>
    get(`/api/stops?south=${south}&west=${west}&north=${north}&east=${east}`, { timeout: 6000 }),

  /** What riders have said about a whole page of buses, in one call. */
  crowd: (plates) => get(`/api/crowd?plates=${q((plates || []).join(','))}`, { timeout: 6000 }),

  routeReputation: (route, start) =>
    get(`/api/reputation?route=${q(route)}&start=${q(start || '')}`, { timeout: 8000 }),

  /** Plate autocomplete over the cached fleet master. */
  plates: async (query, opts) => arr(await get(`/api/plates?q=${q(query)}`, opts)),

  /** Station autocomplete (English + Gujarati names). */
  stations: async (query, opts) => arr(await get(`/api/stations/${q(query)}`, opts)),

  /** Stations near a coordinate, nearest first. */
  nearby: async (lat, lng, opts) => arr(await get(`/api/nearby?lat=${lat}&lng=${lng}`, opts)),

  /** Buses between two stations on a date. */
  timetable: async ({ from, to, date, type = 0, page = 1, pageSize = 80 }, opts) =>
    arr(await get(`/api/timetable?from=${q(from)}&to=${q(to)}&date=${q(date)}&type=${q(type)}`
      + `&page=${page}&pageSize=${pageSize}`, { timeout: 20000, ...opts })),

  serviceTypes: async (opts) => arr(await get('/api/servicetypes', opts)),

  /** Stop-by-stop route with the live position — running trips only. */
  /** Stop-by-stop route with the live position. `plate` lets the server bank arrival times. */
  trip: async ({ tripId, status = 1, start, plate, route }, opts) =>
    arr(await get(`/api/trip?tripId=${q(tripId)}&status=${q(status)}&start=${q(start || '')}`
      + (plate ? `&plate=${q(plate)}` : '') + (route ? `&route=${q(route)}` : ''),
    { timeout: 15000, ...opts })),

  /** PNR lookup -> returns array of details (VehicleNo, TripCode, etc.). */
  pnr: async (pnrNo, opts) => arr(await get(`/api/pnr/${q(pnrNo)}`, { timeout: 15000, ...opts })),

  /** Full ticket tracking history (seats, fare, pickup/drop). */
  ticket: async ({ pnr, mobile }, opts) =>
    arr(await get(`/api/ticket?pnr=${q(pnr)}&mobile=${q(mobile)}`, { timeout: 15000, ...opts })),

  /** Trip code lookup -> returns vehicle plate and details. */
  tripCode: async (code, opts) => arr(await get(`/api/tripcode/${q(code)}`, { timeout: 15000, ...opts })),

  /** Pickup point sequence for a PNR / trip. */
  pickupPoints: async ({ pnr, trip, vehicle, status } = {}, opts) =>
    arr(await get(`/api/pickup-points?pnr=${q(pnr || '')}&trip=${q(trip || '')}&vehicle=${q(vehicle || '')}&status=${q(status || '')}`,
      { timeout: 15000, ...opts })),
};

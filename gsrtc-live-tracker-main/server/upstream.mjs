/**
 * The one module that talks to the GSRTC tracking backend.
 *
 * ⚠️ The credentials this needs were reverse-engineered from the third-party "ST Bus Tracker"
 *    app. This is NOT an official or open API and it can stop working the moment the operator
 *    rotates keys. They are read from the environment and deliberately kept out of source, so
 *    nothing secret ends up in git history and a future official credential set is a config
 *    change rather than a code change. See docs/API_RESEARCH.md and the README.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as uptime from './uptime.mjs';

// Credentials live in .env (gitignored), never in source. See .env.example.
// Resolved from this file, not from cwd: pm2, systemd and cron all set the working directory
// to somewhere you did not expect, and a silently-missing .env is a miserable thing to debug.
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(PROJECT_ROOT, '.env')); }
catch { /* no .env file — rely on the real environment */ }

const env = process.env;

const required = ['GSRTC_HOST', 'GSRTC_API_USER', 'GSRTC_API_PASS', 'GSRTC_AES_KEY', 'GSRTC_AUTH_SECRET'];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  console.error(
    `\nMissing upstream configuration: ${missing.join(', ')}\n`
    + 'Copy .env.example to .env and fill it in, or set these in the environment.\n'
    + 'See docs/API_RESEARCH.md for what each value is.\n',
  );
  process.exit(1);
}

export const config = {
  host: env.GSRTC_HOST,
  username: env.GSRTC_API_USER,
  password: env.GSRTC_API_PASS,
  aesKey: env.GSRTC_AES_KEY,
  authSecret: env.GSRTC_AUTH_SECRET,
  deviceId: env.GSRTC_DEVICE_ID || '0123456789abcdef',
  // Presence is checked upstream but the value is not validated.
  amnexAuth: env.GSRTC_AMNEX_AUTH || 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.sig',
  // Nine seconds, not fifteen. A live bus position refreshes every twenty seconds anyway, so a
  // request still running after nine has already missed its own window — and the rider is left
  // staring at a spinner for something that will be asked again shortly regardless.
  timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 9000),
  retries: Number(env.UPSTREAM_RETRIES || 1),
};

/**
 * Everything time-related here is computed in **India time, explicitly** — never in the host's
 * local zone.
 *
 * The upstream validates the Authorization token against a minute-precision timestamp on its
 * own clock, and it runs on IST. A server in UTC therefore mints tokens five and a half hours
 * out and gets a flat HTTP 401, which is exactly what happened the first time this was deployed
 * (it worked on a laptop in India and failed on the box). `ScheduleDate` has the same problem
 * from the other direction: between midnight and 05:30 IST, a UTC host would ask for yesterday.
 */
const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function istParts(d) {
  return Object.fromEntries(IST.formatToParts(d).map((p) => [p.type, p.value]));
}

const stamp = (d) => {
  const p = istParts(d);
  return `${p.month}${p.year}${p.day}${p.hour}${p.minute}`;
};

export const ymd = (d = new Date()) => {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/** Per-minute AES-192-ECB token, exactly as the reference app builds it. */
export function authToken(now = new Date()) {
  const value = String(BigInt(stamp(now)) * 6n);
  const plain = `${config.deviceId}&${value}&${config.deviceId}${config.authSecret}`;
  const cipher = crypto.createCipheriv('aes-192-ecb', Buffer.from(config.aesKey, 'utf8'), null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

export class UpstreamError extends Error {
  /**
   * `answered` distinguishes "the operator replied, but not with data we can use" from "the
   * operator did not reply at all". A request for a plate that does not exist comes back HTTP
   * 200 with a plain-text message, which is a perfectly healthy server saying no — counting it
   * as downtime meant one rider mistyping a bus number turned the status banner red for
   * everybody.
   */
  constructor(message, status = 502, detail = '', answered = false) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.answered = answered;
  }
}

/**
 * The operator's ways of saying "nothing here".
 *
 * Observed live, in these exact words: NO DATA FOUND, NO BUS AVAILABLE, NO DATA AVAILABLE.
 * Anchored rather than merely contained, so a genuine error page that happens to mention data
 * is not silently swallowed as an empty result.
 */
const EMPTY_ANSWERS = /^(NO (BUS|DATA|RECORD|RESULT)S?\s*(AVAILABLE|FOUND|EXIST)?\.?)$/i;

/**
 * "INVALID AUTHENTICATION." — which does not mean what it says.
 *
 * The operator returns this when asked for a vehicle that is not running, not just one that
 * does not exist. Verified live: a running plate answered 200 with a position in the same
 * second that two idle plates got this string, on the same credentials. All 273 occurrences in
 * the logs were this one method; a genuinely rejected token would fail every method at once.
 *
 * So for a vehicle lookup it is "no such bus running", and riders were being shown "the bus
 * operator's service is not responding" for typing a plate that is parked.
 *
 * It is deliberately **not** swallowed for any other method. If the credentials really do
 * rotate, this is the string that will say so, and it must stay loud everywhere else — the
 * dashboard's `dataErrors` counter exists to catch exactly that.
 */
const NOT_RUNNING = /^INVALID AUTHENTICATION\.?$/i;
const VEHICLE_METHOD = 'GetVehicleCurrentStatus_V1';

/** Strips the ASMX <string>…</string> envelope and parses the JSON inside it. */
function unwrap(text, method) {
  const inner = text
    .replace(/^[\s\S]*?<string[^>]*>/, '')
    .replace(/<\/string>[\s\S]*$/, '')
    .trim();
  const payload = inner || text.trim();
  if (!payload) return [];
  try {
    return JSON.parse(payload);
  } catch {
    // The service answers HTML for a bad method or an ASP.NET runtime error.
    const snippet = payload.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    // ...but it also answers a plain sentence, in capitals, to mean "nothing to return". That
    // is an empty result, not a fault, and treating it as one told riders "the bus operator's
    // service is not responding" more than a thousand times for what was really "no buses on
    // this route". An empty list is the truthful answer and the screens already know how to
    // show it.
    if (EMPTY_ANSWERS.test(snippet)) return [];
    if (method === VEHICLE_METHOD && NOT_RUNNING.test(snippet)) {
      throw new UpstreamError(`${method}: that bus is not running`, 404, snippet, true);
    }
    // HTTP was fine; the body just was not JSON. The service is up.
    throw new UpstreamError(`${method}: unexpected response from the operator`, 502, snippet, true);
  }
}

/**
 * Methods that get a longer budget than the default.
 *
 * The 9s default is set by live positions: those refresh every 20s, so a request still running
 * after nine has already missed its own window and another is along shortly. A timetable has no
 * successor — the rider pressed "Find buses" and is waiting on that one answer — and a full page
 * of eighty services measures 8.3s against the operator on a busy corridor. Failing at nine does
 * not make the search faster, it makes it not happen: on the live site the app's own default
 * query was returning 504 to riders.
 */
const SLOW_METHODS = new Map([
  ['Page_GetSourceDestinationWiseBusList_V1', Number(env.UPSTREAM_TIMEOUT_SLOW_MS || 25000)],
]);

const timeoutFor = (method) => SLOW_METHODS.get(method) || config.timeoutMs;

async function attempt(service, method, params) {
  const body = new URLSearchParams({
    APIUserName: config.username,
    APIPassword: config.password,
    ...params,
  }).toString();

  const res = await fetch(`${config.host}/${service}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'cache-control': 'no-cache',
      accept: '*/*',
      Authorization: authToken(),
      AmnexAuth: config.amnexAuth,
    },
    body,
    signal: AbortSignal.timeout(timeoutFor(method)),
  });

  const text = await res.text();
  if (!res.ok) {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new UpstreamError(`${method}: operator returned HTTP ${res.status}`, 502, snippet);
  }
  return unwrap(text, method);
}

/** POST to the backend with one retry for transient network/5xx failures. */
export async function call(service, method, params = {}) {
  let lastError;
  const startedAt = Date.now();
  for (let i = 0; i <= config.retries; i += 1) {
    try {
      const result = await attempt(service, method, params);
      // Recorded here rather than at each call site: this is the one funnel every request to
      // the operator passes through, so nothing can be added later and quietly go unmeasured.
      uptime.record(method, true, Date.now() - startedAt);
      return result;
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      lastError = e instanceof UpstreamError ? e
        : new UpstreamError(timedOut
          ? `${method}: operator timed out` : `${method}: ${e.message}`, 504);

      // A timeout is never retried. Retrying one means waiting the whole budget twice — that is
      // how a 15s timeout became a 30s wait for the rider — and it adds load to a backend that
      // has just demonstrated it is struggling. A dropped connection is different: that is
      // worth one more go.
      if (timedOut) break;
      if (i < config.retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  // Only after the retries are spent: a call that succeeded on the second attempt did work,
  // and counting the first failure would show an outage riders never experienced. An answered
  // request is recorded as reachable — the operator is up — with the content problem noted
  // separately, because a run of those means the credentials have rotated rather than that
  // GSRTC is offline, and those need very different responses.
  uptime.record(method, Boolean(lastError?.answered), Date.now() - startedAt,
    lastError?.detail || lastError?.message, { dataError: Boolean(lastError?.answered) });
  throw lastError;
}

/* ------------------------------------------------------------------ methods */
const TRACKING = 'TrackingService.asmx';
const TRANSIST = 'TransistService.asmx';
// Several TransistService methods answer HTTP 500 unless these filler params are present.
const FILLER = { IMEINo: '0', column1: '', column2: '', column3: '' };

export const gsrtc = {
  vehicleStatus: (vehicleNo, date) =>
    call(TRACKING, 'GetVehicleCurrentStatus_V1', { VehicleNo: vehicleNo, ScheduleDate: date || ymd() }),

  vehicleMaster: (date) => call(TRACKING, 'VehicleMaster_V1', { Date: date || ymd() }),

  stations: (name) => call(TRANSIST, 'GetStationList_V1', { StationName: name }),

  serviceTypes: () => call(TRANSIST, 'GetBusServiceTypeList', { ...FILLER }),

  nearbyStations: (lat, lng) =>
    call(TRANSIST, 'GetNearByDepotList_V1', { Lattitude: String(lat), Longitude: String(lng), ...FILLER }),

  timetable: ({ from, to, date, type = '0', journeyTime = '00:00', page = '1', pageSize = '80' }) =>
    call(TRANSIST, 'Page_GetSourceDestinationWiseBusList_V1', {
      FromLocId: String(from), ToLocId: String(to), BusServiceTypeId: String(type),
      ScheduleDate: date || ymd(), JourneyTime: journeyTime,
      PageSize: String(pageSize), PageNumber: String(page),
    }),

  /**
   * Stop-by-stop route plus the live position. Lives on TransistService (not TrackingService),
   * and TripStartTime must be the timetable row's ArrivalTimeAtBoarding verbatim
   * ("M/d/yyyy h:mm:ss tt") or the service throws a DateTime parse error.
   * Only answers for a trip that is actually running.
   */
  tripDetails: ({ tripId, status = '1', start }) =>
    call(TRANSIST, 'GetBusTrackerDetails_V1', {
      TripId: String(tripId), TripStatus: String(status), TripStartTime: start || '',
    }),
};

/** Exposed for tests: the IST-anchored timestamp the Authorization token is built from. */
export const _internals = { stamp, istParts };

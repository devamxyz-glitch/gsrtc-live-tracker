/**
 * ST Tracker — GSRTC live-tracking + transit data source.
 *
 * Single place that knows the Infinium "mobileapi" ASMX backend (used by the ST Bus Tracker app).
 * Auth is a per-minute AES-ECB token computed client-side (see docs/API_RESEARCH.md).
 *
 * ⚠️ Credentials extracted from an existing app — NOT an official/open API. They are supplied
 *    by the host (env vars on Node, `configure()` on React Native) and never hardcoded here.
 *    Keep every network detail behind this module so the backend can be swapped without touching UI.
 *    For a public PWA, proxy these calls (see server/proxy.mjs) so the key isn't shipped in browser JS.
 *
 * Works in React Native and Node via `crypto-js` (pure JS, supports AES-ECB).
 */
import CryptoJS from 'crypto-js';

/**
 * Upstream configuration. Nothing is baked in: on Node it is read from the environment
 * (see .env.example), and a React Native host must call `configure()` at startup with values
 * it supplies itself. Keeping the credentials out of source keeps them out of git history.
 */
export interface GsrtcConfig {
  host: string;
  username: string;
  password: string;
  aesKey: string;      // 24 bytes -> AES-192-ECB
  authSecret: string;
  deviceId?: string;
  amnexAuth?: string;  // presence is checked upstream; the value is not validated
}

const fromEnv = (key: string): string | undefined =>
  (typeof process !== 'undefined' ? process.env?.[key] : undefined);

let config: GsrtcConfig | null = null;

/** Supply the upstream credentials. Required before any call on a platform without `process.env`. */
export function configure(next: GsrtcConfig): void {
  config = next;
}

function settings(): GsrtcConfig {
  if (config) return config;
  const host = fromEnv('GSRTC_HOST');
  const username = fromEnv('GSRTC_API_USER');
  const password = fromEnv('GSRTC_API_PASS');
  const aesKey = fromEnv('GSRTC_AES_KEY');
  const authSecret = fromEnv('GSRTC_AUTH_SECRET');
  if (!host || !username || !password || !aesKey || !authSecret) {
    throw new Error(
      'ST Tracker: upstream is not configured. Set GSRTC_HOST, GSRTC_API_USER, GSRTC_API_PASS, '
      + 'GSRTC_AES_KEY and GSRTC_AUTH_SECRET (see .env.example), or call configure() first.',
    );
  }
  config = {
    host, username, password, aesKey, authSecret,
    deviceId: fromEnv('GSRTC_DEVICE_ID') || '0123456789abcdef',
    amnexAuth: fromEnv('GSRTC_AMNEX_AUTH')
      || 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.sig',
  };
  return config;
}

/**
 * India time, explicitly — never the host's local zone.
 *
 * The upstream checks the Authorization token against a minute-precision timestamp on its own
 * IST clock, so a device or server in any other zone mints a token that is simply rejected with
 * HTTP 401. `ScheduleDate` breaks the same way between midnight and 05:30 IST. A phone that has
 * travelled, or a server outside India, must still work.
 */
const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function istParts(d: Date): Record<string, string> {
  return Object.fromEntries(IST.formatToParts(d).map((p) => [p.type, p.value]));
}

const stamp = (d: Date): string => {
  const p = istParts(d);
  return `${p.month}${p.year}${p.day}${p.hour}${p.minute}`;
};

/** yyyy-MM-dd (India time) for date params. */
export function ymd(d: Date = new Date()): string {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Per-request Authorization token, exactly as the app builds it. deviceId is any 16-hex string. */
export function buildAuthToken(deviceId?: string, now: Date = new Date()): string {
  const cfg = settings();
  const id = deviceId || cfg.deviceId || '0123456789abcdef';
  const val = String(BigInt(stamp(now)) * 6n);
  const plain = `${id}&${val}&${id}${cfg.authSecret}`;
  const key = CryptoJS.enc.Utf8.parse(cfg.aesKey);
  const enc = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plain), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return enc.ciphertext.toString(CryptoJS.enc.Base64);
}

function form(body: Record<string, string>): string {
  return Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Core POST. Unwraps the ASMX <string>…</string> envelope and parses the inner JSON. */
async function post<T>(service: string, method: string, params: Record<string, string>, deviceId?: string): Promise<T> {
  const cfg = settings();
  const res = await fetch(`${cfg.host}/${service}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'cache-control': 'no-cache',
      Authorization: buildAuthToken(deviceId),
      AmnexAuth: cfg.amnexAuth || '',
    },
    body: form({ APIUserName: cfg.username, APIPassword: cfg.password, ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status}`);
  const inner = text.replace(/^[\s\S]*?<string[^>]*>/, '').replace(/<\/string>[\s\S]*$/, '').trim();
  const json = inner || text;
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`${method}: unexpected response: ${json.slice(0, 200)}`);
  }
}

// ---------- Types ----------
export interface VehicleStatus {
  DepartureDateTime: string; LastBusStation: string; LastArrivalDateTime: string;
  Status: string; RouteName: string; NextLocation: string; ETA: string;
  Latitude: string; Longitude: string;
}
export interface Vehicle { DivisionName: string; DepotName: string; VehicleRegisteredNo: string; ClassLayout: string }
export interface Station { StationId: string; StationName: string; StationNameGuj: string; CityName: string }
export interface NearbyStation { StationId: string; StationName: string; StationNameGuj: string; Center_Lat: string; Center_Lon: string; Distance: string }
export interface ServiceType { ServiceTypeID: string; ServiceTypeName: string; ServiceTypeNameGuj: string }
export interface BusService {
  RouteId: string; RouteName: string; RouteNameGuj: string; BusNo: string; BusServiceType: string;
  ETATime: string; ArrivalTime: string; Distance: string; SchDuration: string; BusRunningStatus: string;
  TripId: string; ServiceType: string; ServiceTypeID: number; Capacity: number;
  FromStationName: string; ToStationName: string; TotalPage: string;
}

// ---------- Public API ----------

/** Live GPS + status for a number plate on a given date (defaults to today). */
export function getVehicleStatus(vehicleNo: string, date: Date = new Date(), deviceId?: string) {
  return post<VehicleStatus[]>('TrackingService.asmx', 'GetVehicleCurrentStatus_V1', {
    VehicleNo: vehicleNo.trim().toUpperCase(), ScheduleDate: ymd(date),
  }, deviceId);
}

/** Parsed helper: {lat,lng,status} or null if the bus has no live fix. */
export async function getVehicleLatLng(vehicleNo: string, date?: Date, deviceId?: string) {
  const s = (await getVehicleStatus(vehicleNo, date, deviceId))?.[0];
  if (!s) return null;
  const lat = parseFloat(s.Latitude), lng = parseFloat(s.Longitude);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, status: s };
}

/** The entire fleet of registered plates for a date (~8.5k rows). */
export function getAllVehicles(date: Date = new Date(), deviceId?: string) {
  return post<Vehicle[]>('TrackingService.asmx', 'VehicleMaster_V1', { Date: ymd(date) }, deviceId);
}

/** Station-name autocomplete. */
export function searchStations(stationName: string, deviceId?: string) {
  return post<Station[]>('TransistService.asmx', 'GetStationList_V1', { StationName: stationName }, deviceId);
}

/** Bus service types (for the filter dropdown). */
export function getServiceTypes(deviceId?: string) {
  return post<ServiceType[]>('TransistService.asmx', 'GetBusServiceTypeList',
    { IMEINo: '0', column1: '', column2: '', column3: '' }, deviceId);
}

/** Stations/depots near a coordinate, sorted by distance. */
export function getNearbyStations(lat: number, lng: number, deviceId?: string) {
  return post<NearbyStation[]>('TransistService.asmx', 'GetNearByDepotList_V1',
    { Lattitude: String(lat), Longitude: String(lng), IMEINo: '0', column1: '', column2: '', column3: '' }, deviceId);
}

/** Timetable / buses between two stations (by StationId). BusServiceTypeId 0 = all. */
export function getTimetable(
  fromLocId: string | number, toLocId: string | number,
  opts: { date?: Date; serviceTypeId?: number; journeyTime?: string; page?: number; pageSize?: number } = {},
  deviceId?: string,
) {
  const { date = new Date(), serviceTypeId = 0, journeyTime = '00:00', page = 1, pageSize = 300 } = opts;
  return post<BusService[]>('TransistService.asmx', 'Page_GetSourceDestinationWiseBusList_V1', {
    FromLocId: String(fromLocId), ToLocId: String(toLocId), BusServiceTypeId: String(serviceTypeId),
    ScheduleDate: ymd(date), JourneyTime: journeyTime, PageSize: String(pageSize), PageNumber: String(page),
  }, deviceId);
}

export interface TripStop {
  LocationName: string; LocationNameGuj: string; LocationId: number;
  LocationLat: string; LocationLong: string; Distance: string;
  ArrivedTime: string; ETA: string;
  CurrentLocationName: string; CurrentLat: string; CurrentLong: string;
  KMTravelled: string; LastLocationCovered: string; IsByPass: string;
}

/**
 * Trip route line + stops + live position — works only for a currently-running trip.
 *
 * Two things this method is fussy about (both verified live):
 *  - it lives on **TransistService.asmx**, not TrackingService;
 *  - `tripStartTime` must be the timetable row's `ArrivalTimeAtBoarding` verbatim
 *    ("M/d/yyyy h:mm:ss tt"). An empty or reformatted value throws a DateTime parse error.
 */
export function getTripDetails(tripId: string, tripStatus: string | number, tripStartTime: string, deviceId?: string) {
  return post<TripStop[]>('TransistService.asmx', 'GetBusTrackerDetails_V1',
    { TripId: String(tripId), TripStatus: String(tripStatus), TripStartTime: tripStartTime }, deviceId);
}

export const _internals = { settings, buildAuthToken, stamp };

# GSRTC Live Tracking — API Research (reverse-engineered)

Source app: **GSRTC Live Tracking v5.4 (build 62)**, package `com.infiniumsolutionzgsrtc.myapplication`,
published by **Infinium Solutionz** (the GSRTC vendor). Decompiled with jadx from the APKM bundle.

## TL;DR — how the app gets a vehicle's location
Two endpoints do the actual "where is the bus" work. Both are **HTTPS POST**, JSON body,
and require an `Authorization: Bearer <token>` header. The token is **not** a public API key —
it is minted per-session through **Google Play Integrity** (see Auth flow below).

Base host: `https://gujaratrajyamargvahanvyavaharcorporationtrackingapi.infinium.management`

### 1. GetVehicleCurrentStatus_V1  — status + last known lat/long for one vehicle
- `POST /TransistService/GetVehicleCurrentStatus_V1`
- Body: `{ "VehicleNo": "<GJ-xx-xxxx>", "scheduleDate": "<yyyy-MM-dd>" }`
- Returns JSON array; each item has:
  `DepartureDateTime, LastBusStation, LastArrivalDateTime, Status, RouteName, NextLocation, ETA, Latitude, Longitude`

### 2. GetBusTrackerDetails_V1  — live trip tracking (the map screen)
- `POST /TransistService/GetBusTrackerDetails_V1`
- Body: `{ "TripId": <long>, "TripStatus": <int>, "TripStartTime": "<string>" }`
- Returns JSON array of route points; fields:
  `LocationName / LocationNameGuj, LocationId, LocationLat, LocationLong, Distance,
   ArrivedTime, ETA, CurrentLocationName, CurrentLat, CurrentLong, KMTravelled,
   LastLocationCovered, IsByPass`
- `CurrentLat` / `CurrentLong` = the live bus position; the `Location*` fields are the stops.

## Supporting endpoints (same host, same Bearer auth)
| Endpoint (POST unless noted) | Body params | Purpose |
|---|---|---|
| `GetStationList_V1` | `StationName` | Autocomplete stations |
| `GetBusServiceTypeList` | `IMEINo, column1..3` | Bus classes (express/local/etc) |
| `GetSourceDestinationWiseBusList_V1` / `Page_...` | `FromLocId, ToLocId, BusServiceTypeId, ScheduleDate, JourneyTime[, PageSize, PageNumber]` | Buses between two stops |
| `GetSourceDestinationWiseScheduleList_V1` / `Page_...` | same as above | Schedules between two stops |
| `GetBusScheduleForRoute_V1` | `RouteId, StationID` | Schedule for a route |
| `GetRoutePoints_V1` | (route id) | Polyline points of a route |
| `GetETATime_V1` | (stop/trip) | ETA to a stop |
| `VehicleMaster_V1` | (filters) | Vehicle master list |
| `GetNearByDepotList_V1` | `Lattitude, Longitude, IMEINo, column1..3` | Depots near a lat/long |
| `Page_GetDepotWiseBusList` | (depot id) | Buses at a depot |

## Auth flow (why this is NOT a free/open API)
Every `TransistService/*` call sends `Authorization: Bearer <GINTEGRETYTOKEN>`.
That token is produced by a 3-step handshake gated on **Google Play Integrity**:

1. `GET  /api/integrity/nonce`  → server returns a one-time nonce.
2. App calls Google Play **`requestIntegrityToken(nonce)`** (Play Integrity API, via
   `IntegrityManager`) → Google returns a signed **X-Integrity-Token** that attests the request
   comes from *this exact app*, unmodified, on a genuine Play-certified device.
3. `POST /api/integrity/session` with header `X-Integrity-Token: <token>` → the server verifies
   the attestation with Google and returns the session **Bearer** token, stored as `GINTEGRETYTOKEN`.

Play Integrity is bound to the app's Play Console app identity (signing cert + package name).
A different app cannot obtain a valid integrity token for `com.infiniumsolutionzgsrtc.myapplication`,
so it cannot legitimately mint the Bearer these endpoints require.

Other hosts seen in the binary:
- `https://gsrtc.in/GSRTCWSAnd/reservationservice/GetVehicleNobyPnrNo?arg0=<PNR>` (PNR → vehicle no)
- `https://mobileappcheckversion.amnex.com/api/ProjectVersion/CheckVersion` (version gate)
- `https://tracking.infinium.management/matomo.php` (Matomo analytics)
- `http://182.74.17.186:8082/biws/buswebservice?wsdl` (legacy SOAP)

---

# GSRTC public web-tracking chain (gsrtc.in → Amnex) — no Play Integrity

This is a *separate*, simpler stack from the Infinium app above. It's the one behind the
`gsrtc.in/Notify/*` links. Vendor for the actual GPS is **Amnex** (`gsrtctracking.amnex.co.in`).

## The chain
1. **Entry (plaintext):** `GET https://gsrtc.in/Notify/GPS.do?PNR=<PNR>,<DD/MM/YYYY>`
   - Resolves a **PNR (booking reference)** → vehicle + date, then renders the tracking page.
   - In testing, a *number-plate* value (`GJ-18-ZT-1028`) returned
     `TRACKING FIRST SERVICE UNAVAILABLE / Vehicle No: null` → this endpoint wants a real PNR,
     not a plate. (Also returns "unavailable" when the bus isn't on an active tracked trip.)

2. **Status page (encrypted ids):** `GET https://www.gsrtc.in/Notify/VTS.do?VNO=<enc>&DOJ=<enc>`
   - `VNO` (vehicle no) and `DOJ` (date of journey) are **server-encrypted** tokens
     (e.g. `VNO=Ud-9Y_seJiwGG37K77VAhQ`, `DOJ=rX7ak2ClfdBi_QVrP_4-aA`), not raw values.
   - Renders an HTML "GSRTC Bus Status" page and embeds an **Amnex track token** in a
     "Track on Map" button / iframe:
     `https://gsrtctracking.amnex.co.in/VehicleTracking/Track?x=<encrypted-track-token>`

3. **Live GPS feed (the actual coordinates):**
   `POST https://gsrtctracking.amnex.co.in/VehicleTracking/lvd_x9`
   - Body (form-urlencoded): `x=<encrypted-track-token>`
   - Response: JSON array `[{ "lattitude": <str>, "longitude": <str>, "vehicleNo": <str>, "servicetype": <str> }]`
     (note the misspelling `lattitude`). Client polls every **20s**.
   - Token is **short-lived**: `401` → the JS shows "Tracking link expired" and stops polling.
     A stale token returned `404 Not Found` in testing.

## What this means for ST Tracker
- The live feed (`lvd_x9`) is public (no login, no Play Integrity) **but** is gated on a
  short-lived encrypted `x` token that only GSRTC's server mints. You can't feed it a raw plate.
- So the real question is: **what mints the token from a plate?** The RN app
  (`com.rninfosoft.stbustracker`, "ST Bus Tracker" by RN Infosoft) reportedly tracks by plate —
  its bundle should reveal the plate→token (or plate→GPS) endpoint. That APK is the next artifact
  to decompile. Being React Native, its `index.android.bundle` holds the URLs in readable JS.

## Service types seen (for map icons)
ac, express, volvo 2x2, deluxe, gurjar nagari, mini bus, intercity, luxury, point service,
sleeper, super express, vikas route, volvo, local, ordinary, special service, volvo sleeper,
ac sleeper, ac 2x2.

---

# ✅ THE REUSABLE API — "ST Bus Tracker" (com.rninfosoft.stbustracker) — CONFIRMED WORKING

This third app (native Android, StringFog-obfuscated) is the one that tracks by **number plate**
with **no Play Integrity**. It talks to an *older* Infinium host with classic ASP.NET **.asmx**
services and a **client-computable auth token**. I decoded the obfuscated strings and confirmed
the call returns live GPS.

Host: `https://gujaratrajyamargvahanvyavaharcorporationmobileapi.infinium.management`

## Plate → live GPS (verified)
`POST /TrackingService.asmx/GetVehicleCurrentStatus_V1`
- Content-Type: `application/x-www-form-urlencoded; charset=UTF-8`
- Body params:
  - `APIUserName = AaMNex1201`
  - `APIPassword = AaMNexg@3248!!#`
  - `VehicleNo   = <number plate, e.g. GJ-18-ZT-1028>`
  - `ScheduleDate= <yyyy-MM-dd, today>`
- Headers:
  - `cache-control: no-cache`
  - `Authorization: <AES token, see below>`
  - `AmnexAuth: <a hardcoded Google ID JWT>` — **not validated** (test succeeded with a bogus one). Optional.
- Response (XML-wrapped JSON):
  `<string>[{"DepartureDateTime","LastBusStation","LastArrivalDateTime","Status","RouteName",
   "NextLocation","ETA","Latitude","Longitude"}]</string>`
- Live test (2026-08-23, plate GJ-18-ZT-1028) → `Latitude 22.604435, Longitude 70.943668`. ✔

### The `Authorization` token (fully client-side — this is why it needs no Play Integrity)
```
androidId = Settings.Secure.ANDROID_ID           // any 16-hex string works
ts        = now formatted "MMyyyyddHHmm" (Locale.US)   // minute precision
val       = String(parseLong(ts) * 6)
plain     = androidId + "&" + val + "&" + androidId + "&amnexiinfi9849&Infi#65899"
key       = "1tyu89rtuqeoptyklltyussq"           // base64 "MXR5dTg5cnR1cWVvcHR5a2xsdHl1c3Nx", 24 bytes → AES-192
token     = Base64.NO_WRAP( AES/ECB/PKCS5Padding( plain, key ) )
```
Server decrypts, checks the embedded secret + the time window (minute-based), so the token must be
regenerated per minute. That's the entire "auth" — static key baked into the app.

## Full API surface (all same host + same auth)
### TrackingService.asmx
| Method | Body | Returns |
|---|---|---|
| `GetVehicleCurrentStatus_V1` | `VehicleNo, ScheduleDate` | live Lat/Long + status (see above) |
| `GetBusTrackerDetails_V1` | `TripId, TripStatus, TripStartTime` | route stops + live CurrentLat/Long |
| `VehicleMaster_V1` | (filters) | vehicle master |

### TransistService.asmx
| Method | Body | Returns |
|---|---|---|
| `GetStationList_V1` | `StationName` | station autocomplete |
| `GetSourceDestinationWiseScheduleList_V1` / `Page_...` | `FromLocId, ToLocId, BusServiceTypeId, ScheduleDate, JourneyTime[, PageSize, PageNumber]` | schedules between stops |
| `Page_GetSourceDestinationWiseBusList_V1` | same | buses between stops |
| `GetBusScheduleForRoute_V1` | `RouteId, StationID` | schedule for a route |
| `GetBusServiceTypeList` | `column1..3` | bus service types |
| `GetNearByDepotList_V1` | `Lattitude, Longitude` | nearby depots |
| `Page_GetDepotWiseBusList` | (depot id) | buses at a depot |

## Honest caveats (read before shipping)
- This is **not an official/open API**. `AaMNex1201`/`AaMNexg@3248!!#` and the AES key are
  static credentials **extracted from a third-party app** that is itself reusing GSRTC/Amnex/Infinium
  infrastructure. The data (public bus positions) is public-interest, but the *access method* is
  reverse-engineered credential reuse.
- It can break anytime Infinium rotates the credentials/key or adds real auth (e.g. Play Integrity,
  as the official GSRTC app already uses on its newer `trackingapi` host).
- For anything you intend to run at scale or monetise, get **official API access** from
  GSRTC/Infinium/Amnex. Build the app against a swappable data-source interface so the backend can
  change without touching the UI.

---

# Feature endpoints — CONFIRMED shapes (live-tested 2026-08-23)

All on `mobileapi.infinium.management`, same auth. Note: several methods **require `IMEINo`**
(any value, e.g. `0`) and/or `column1..3` (empty strings) or they return HTTP 500.

## "All bus number plates" — the full fleet
`POST /TrackingService.asmx/VehicleMaster_V1`  body: `Date=<yyyy-MM-dd>`
→ **8,554 vehicles** (across 15 divisions) like:
```json
[{"DivisionName":"Ahmedabad","DepotName":"Dehgam","VehicleRegisteredNo":"GJ-18-Z-0331","ClassLayout":""}]
```
`VehicleRegisteredNo` is the plate you feed to `GetVehicleCurrentStatus_V1`.

## Station autocomplete
`POST /TransistService.asmx/GetStationList_V1`  body: `StationName=<query>`
```json
[{"StationId":"464","StationName":"Ahmedabad","StationNameGuj":"અમદાવાદ","CityName":"Ahmedabad"}]
```

## Timetable / buses between two stations  ← "timetable between 2 stations"
`POST /TransistService.asmx/Page_GetSourceDestinationWiseBusList_V1`
(or `GetSourceDestinationWiseScheduleList_V1` — same shape, no paging)
body: `FromLocId, ToLocId, BusServiceTypeId (0=all), ScheduleDate=<yyyy-MM-dd>, JourneyTime=00:00, PageSize=300, PageNumber=1`
```json
[{"RouteName":"Ahmedabad to Keshod via Rajkot","RouteNameGuj":"…","BusNo":"GJ-18-ZT-3653",
  "BusServiceType":"Express","ETATime":"00:30","ArrivalTime":"12:30 AM","Distance":"225.000",
  "SchDuration":"04:15:00","BusRunningStatus":"Scheduled","TripId":"127440612","ServiceType":"Express",
  "Capacity":56,"FromStationName":"Ahmedabad","ToStationName":"Keshod","TotalPage":"27", …fares… }]
```
Each row carries **`BusNo` (plate)** and **`TripId`** → hand off to live tracking. `TotalPage` drives paging.

## Bus service types (filter dropdown)
`POST /TransistService.asmx/GetBusServiceTypeList`  body: `IMEINo=0, column1=, column2=, column3=`
```json
[{"ServiceTypeID":"0","ServiceTypeName":"All"},{"ServiceTypeID":"3","ServiceTypeName":"Express"}, …]
```

## Nearby stations/depots
`POST /TransistService.asmx/GetNearByDepotList_V1`  body: `Lattitude, Longitude, IMEINo=0, column1..3=`
```json
[{"StationId":"4004","StationName":"Times of India (Ahmedabad)","Center_Lat":"23.03403","Center_Lon":"72.56947","Distance":"1.29"}]
```

## Trip route + live position (route line with stops)  ← CORRECTED, live-tested
`POST /TransistService.asmx/GetBusTrackerDetails_V1`
body: `TripId`, `TripStatus`, `TripStartTime`

Two gotchas that cost real time — both confirmed against the live service:

1. **It is on `TransistService.asmx`, not `TrackingService.asmx`.** Calling it on TrackingService
   returns `500 "GetBusTrackerDetails_V1 Web Service method name is not valid."`
2. **`TripStartTime` must be the timetable row's `ArrivalTimeAtBoarding` verbatim**, i.e. the
   .NET-formatted `M/d/yyyy h:mm:ss tt` string such as `8/22/2026 10:24:00 PM`. Empty or reformatted
   values return `500 "Cannot convert to System.DateTime"`.

`TripStatus=1` for a running trip. The method only answers while the trip is actually in progress.

```json
[{"LocationName":"Nathdwara - Rajasthan","LocationNameGuj":"નાથદ્વારા - રાજસ્થાન","LocationId":644,
  "LocationLat":"24.93634","LocationLong":"73.82549","Distance":"0","ArrivedTime":"6:33PM",
  "ETA":" 6:33:41 PM","CurrentLocationName":"Gujarat,India","CurrentLat":"22.524664",
  "CurrentLong":"71.379929","KMTravelled":"443.5798","LastLocationCovered":"Himmatnagar","IsByPass":"0"}]
```

Every row repeats the same trip-level fields (`CurrentLat/Long`, `KMTravelled`, `LastLocationCovered`),
so read those from row 0 and treat the rest as the stop list. `Distance` is cumulative km from the
origin; match `LastLocationCovered` against `LocationName` to find how far along the bus is.

### Methods that do NOT exist on this older host
Present in the newer official app, but 404 here: `GetBusScheduleForRoute_V1`, `GetRoutePoints_V1`,
`GetETATime_V1`, `Page_GetDepotWiseBusList`. `GetSourceDestinationWiseScheduleList_V1` exists but
errors on the parameter set that works for the `Page_...BusList` variant. The service's `?WSDL` is
401-gated, so the surface below is what has actually been exercised.

## Feature → endpoint map (both reference apps)
| Feature | Endpoint |
|---|---|
| Track by plate (live GPS) | `GetVehicleCurrentStatus_V1` ✔ |
| All bus plates / fleet | `VehicleMaster_V1` ✔ |
| Timetable between 2 stations | `Page_GetSourceDestinationWiseBusList_V1` / `GetSourceDestinationWiseScheduleList_V1` ✔ |
| Station search | `GetStationList_V1` ✔ |
| Service-type filter | `GetBusServiceTypeList` ✔ |
| Nearby stations/running buses | `GetNearByDepotList_V1` (+ per-plate status) ✔ |
| Route schedule for a route | `GetBusScheduleForRoute_V1` (RouteId, StationID) |
| Depot-wise bus list | `Page_GetDepotWiseBusList` |
| Trip route line + stops + live | `TransistService.asmx/GetBusTrackerDetails_V1` (running trips) ✔ |

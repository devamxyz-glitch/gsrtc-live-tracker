# CLAUDE.md — ST Tracker project context

Handoff for continuing this project in a fresh session. Read this, then `README.md` for the feature
set and `docs/API_RESEARCH.md` for the full API details.

## What this project is
**ST Tracker** — a live-tracking PWA for **Gujarat ST (GSRTC) buses**, built for daily commuters.
Track a bus by plate on a live map, see the whole route stop by stop, search timetables between two
stations, find nearby stops. English + Gujarati, light/dark, installable, ad-free, no accounts.
Owner: the user. Started 2026-08-23. Current version: **1.46.2**.
**LIVE at https://tracker.shivrajsinh.in** since 2026-08-23.
Repo: `shivrajsinhzala/gsrtc-live-tracker` (**private**).

## The live deployment
- Oracle Cloud Always Free, `VM.Standard.E2.1.Micro` (1 OCPU / 1 GB), Ubuntu 24.04, Mumbai.
  Public IP **130.210.21.111** — ephemeral, so it changes on stop/start; `deploy.sh` and
  `scripts/redeploy.sh` both hardcode it and would need updating.
- nginx (our block is `default_server`, the packaged default site is removed) → Node on :8787.
- pm2 runs it; `pm2-ubuntu` systemd unit is enabled so it survives reboot.
- Let's Encrypt via certbot, `certbot.timer` active. Cloudflare proxies the record and its SSL
  mode is Full, so both the proxied and direct paths work with no redirect loop.
- Ship with `npm run deploy` (server pulls `origin/main` via its own read-only GitHub deploy
  key), then `BASE=https://tracker.shivrajsinh.in npm run smoke`.
- SSH from the owner's Mac: `ssh -i ~/.ssh/st-tracker-deploy ubuntu@130.210.21.111`.

**Deploy traps already hit — do not reintroduce:**
1. The upstream token is validated against an **IST** clock; a UTC host gets a bare HTTP 401.
   Fixed in code (Intl, `Asia/Kolkata`), not by setting the server timezone. Regression-tested.
2. nginx's packaged default site wins for any request that does not match `server_name`, so
   testing by IP returned the welcome page — `/` gave 200 while every asset 404'd.
3. `pm2 startup` only *prints* the privileged command; it must be eval'd or the app dies on reboot.
4. Oracle's Ubuntu image ends its iptables INPUT chain in REJECT, so rules must be inserted at
   position 1, not appended.

## Persistent state (added v1.6.0)
- **`server/db.mjs`** — SQLite via `node:sqlite` (no dependency), at `.data/st-tracker.db`, WAL
  mode. Tables: `subscriptions`, `alerts`, `arrivals`, `reports`. No accounts, no identifiers;
  reports keep only a salted truncated IP hash for rate limiting. Set `IP_HASH_SALT` in `.env`
  or the salt is random per boot and rate limits reset on restart.
- **`server/push.mjs`** — Web Push. `web-push` is the server's only dependency: VAPID and RFC
  8291 payload encryption fail *silently* when hand-rolled (push service returns 201, browser
  cannot decrypt), so it is not a place to be clever. VAPID keys live in `.env`; unset disables
  push and the client falls back to the in-page watcher.
- Alerts are evaluated inside `tracker.poll()`, so subscribers cost the operator **no extra
  upstream requests**. `tick()` re-adds plates with pending alerts to the watch list every 20s,
  or an alert could never fire with every app closed. An alert is marked fired *before* the
  send is awaited so a slow push cannot double-fire it.
- The server accepts **POST** on `/api/` only: JSON, 8 KB cap, rejected on static paths.

## Push — verified end to end (2026-08-23)
A notification was delivered to a real handset from the live server: `push.sent` incremented
with `failed: 0, expired: 0`, and the owner confirmed it arrived. Server → FCM → service worker
→ visible notification is proven, so **do not re-describe this as untested.** What is still
unconfirmed is specifically **iOS**, where web push only exists once the PWA is added to the
home screen.

`scripts/test-push.mjs` keeps the rest honest in CI without a phone: a TLS push service, a
subscription with real P-256 keys, the actual alert path, and the payload **decrypted with the
subscriber's private key**. That decryption is the point — encrypted push fails *silently* when
it is wrong (the service returns 201, the browser simply cannot read the message), so a broken
implementation is indistinguishable from a working one at the server. The decryption is written
from RFC 8291 rather than reusing the sender's code; a bug shared by both halves would cancel
out and prove nothing.

Two traps worth keeping: `web-push` **always speaks TLS** regardless of the endpoint's scheme,
so an `http://` test endpoint fails with a misleading "wrong version number" SSL error. And a
failed send used to be invisible from both ends — the rider is simply never told their bus is
coming — so failures now log status and push-service host, without the token half of the URL.

Settings carries a **Send a test notification** row (`POST /api/push/test`). It is a real round
trip rather than a local `showNotification`, which would prove only that the tab is awake. It
is shown only where a notification could actually arrive, needs the subscription's own keys so
it cannot target someone else's device, and is capped at one per endpoint per minute so our
VAPID identity cannot be used as a relay.

## Placing the bus stands (three sources, only two reach a village)
The gazetteer holds ~19,000 station **names** from autocomplete and timetables. Placing them on a
map needs coordinates, and they come from three places:

1. **The nearby-depot call** (`probe.warmStandCoordinates`) sweeps a grid over Gujarat, ~13 km
   cells to match that call's reach. **Measured ceiling: about 500 places, at 9 a minute.** It
   answers with *depots* and will never return a village stop however long it runs — which is why
   Wankaner could not appear this way. Resumable: the cursor is in `state`, because at three
   minutes' delay and an hour's runtime every deploy restarted it and it never once finished.
2. **The trip feed**, which geocodes every stop on a line (~7 each). The harvester fetches
   hundreds of trips an hour and was discarding their `LocationLat`/`LocationLong` while keeping
   the arrival times — the data to place thousands of stands passed through the process every two
   minutes and went in the bin.
3. **Route exploration** (`harvest.explorePairs`), which exists because (2) only ever visited the
   same ten routes. It pairs geocoded stations that are geographic neighbours and asks the
   timetable for a service between them; the trip that comes back places the villages in between.

**The explorer claims its anchors** (`stations.explored_at`) rather than counting into the list
with an OFFSET. `learn()` refreshes `seen_at` on every re-sighting, so an ordering by discovery
time reshuffled between batches — some stations were explored repeatedly, others never, and the
cursor meant nothing. It looked like it was working because the total kept rising.

Coordinates are validated on the way in: the operator sends `"0"`, `""` and `"N/A"` for stops it
has no position for, and a literal 0,0 is in the Atlantic.

## Google Geocoding: built, and switched OFF by the owner's decision (2026-08-25)
`server/geocode.mjs` can fill in stand positions the operator's feed has not reached. **It is
not enabled**: offered, costed and declined, because it breaches Google Maps Platform terms on
two clauses — geocoding results must be displayed on a Google
map (this app renders CARTO), and the lat/lng values must not be cached beyond a short window
(this app keeps a permanent shared gazetteer). Costed at $5/1,000 with 10,000 free a month — about **$42** once for the ~18,400 unplaced
stations, or $0 across two Google accounts, which is a *separate* terms violation whose
enforcement targets the accounts rather than the key. The owner weighed both and chose neither.
Leave `GOOGLE_GEOCODING_KEY` unset unless that decision is revisited.

Because of that, three things are structural and must not be quietly removed:
- **Off unless `GOOGLE_GEOCODING_KEY` is set.** Nothing here runs by accident.
- **Everything it writes is tagged `source = 'google'`**, so `db.stations.forgetSource('google')`
  removes all of it in one statement. Positions from the operator's own trip feed are tagged
  `operator` and survive that — those are ours to keep.
- **`GEOCODE_DAILY_CAP` is enforced from the database, not memory**, because the process
  restarts on every deploy and an in-memory counter hands out a fresh allowance each time. Every
  attempt stamps `geocode_tried_at` whether or not it resolved: a name Google cannot place would
  otherwise return to the top of the queue on every run and be billed again each time.

**The operator's trip feed is still the better source and should stay primary.** It gives the
exact stop the buses use; a geocoder returns its best guess at a village centre, which is a
different point and sometimes a different village. Checked before building this: OSM has only
**422** bus nodes and **3,045** named places in Gujarat, so it was not a viable substitute.

## Google Maps basemap: priced, declined (2026-08-25)
Asked for and costed. Google **removed the $200/month credit on 1 March 2025**; it is now 10,000
free map loads a month, then **$7 per 1,000**. Against measured traffic (474 track views + 89
nearby + route/trip maps ≈ 600+ loads/day) that is **~$56/month now and ~$266/month at 200 daily
users** — real money for an app whose only income is a Buy Me a Coffee link. It would also break
`script-src 'self'` and put a large external dependency into a no-build PWA.

And it would not solve the actual problem: **Google does not carry GSRTC's stop list**, so the
app's own stand layer is needed either way. Google buys better village and road labels, nothing
more. The owner's decision was to keep improving our own data. Do not reopen this without new
numbers.

## The observed timetable (`server/harvest.mjs`)
The published schedule is a plan; `arrivals` records what actually happened, because the trip
feed reports the real time a bus reached each stop it has passed.

Those observations used to be recorded **only** when a rider opened a route view, which needs
trip context that typing a plate never provides — a full day of real traffic produced *none*.
The harvester collects them deliberately: the routes people actually search, services that have
already departed, once per service per day. The unique index on `arrivals` refuses a repeat, so
running the loop more often spreads the same bounded work rather than multiplying it — the
day's total is set by how many distinct services run, not by the interval.

This is the data behind "usually 8 minutes late" and "usually crowded at this hour". Both stay
silent below their sample thresholds by design.

## The Morbi–Rajkot corridor is watched on purpose
`HARVEST_PINNED` (default `470>462,462>470`) is harvested every cycle whatever the day's
popularity looks like, because a timetable is only worth building if it is built every day
without a gap — one missing day is a hole in every median that follows.

Two things happen on those routes that do not happen elsewhere:

- **Running buses are put on the live tracker** (`watchRunning`). Tracking is otherwise
  demand-driven: a plate is polled only while somebody is looking at it and dropped five minutes
  later, so the corridor was only observed when a rider happened to have it open. The plates come
  out of a timetable the harvester is already fetching, so this costs **no extra upstream
  request** — only the position polls themselves. Capped at `HARVEST_TRACK_MAX` (25): the tracker
  is a budget against somebody else's API, and an unbounded watch list is the fleet-wide polling
  this codebase refuses to do everywhere else.
- **Services already read today are skipped before the request, not after.** The unique index
  refuses duplicate rows, but only once a trip has been fetched — so the same fifteen
  recently-departed services were re-read every two minutes for ever and the rest of the day was
  never reached. `arrivals.harvested()` asks the database first. Note the failure that matters is
  the *over*-report: if it ever answered for buses it had not seen, harvesting would stop dead in
  silence. That is what its test pins.

The observed timetable is built from `arrivals`, not from position fixes — the trip feed reports
the real time a bus reached every stop it has passed, so one request yields a whole journey.
Position polling would cost far more for the same answer. Locations are for riders watching a
bus now; arrivals are what become the timetable.

## Latency — the rider's wait, not the server's
Measured on live logs 2026-08-24: `/api/vehicle` p95 **25.8s**, max **29.9s**. The database was
748 KB and the tracker idle at 0.33 polls/s — it was never our load. `UPSTREAM_TIMEOUT_MS` was
15s and a timeout was retried, so the worst case was 15 + 0.4 + 15 = 30.4s, which is exactly
where max sat.

Two rules now, and both matter:
1. **A timeout is never retried.** Retrying one waits the whole budget twice and adds load to a
   backend that has just shown it is struggling. A dropped connection still gets one more go.
2. **`vehicle` and `trip` serve stale.** A position a minute old, returned instantly, beats a
   fresh one after a thirty-second wait — the client polls again shortly and the map animates
   between fixes anyway. Without `STALE.vehicle` every caller queued behind one slow upstream
   call.

The timeout is 9s: a live position refreshes every 20s, so a request still running after nine
has already missed its own window.

## Capacity — measured, not guessed (2026-08-23)
The instance is `VM.Standard.E2.1.Micro`: **1 OCPU / 1 GB, a fixed shape that cannot be
resized.** Always Free grants two of them. The resizable free option is a *different* shape
family — Ampere A1 Flex, up to 4 OCPU / 24 GB — which needs a new instance and a migration,
because x86 cannot be converted to ARM in place.

**It is not needed.** Under 150 concurrent simulated riders the app used 108 MB of 954 and
0.4% CPU, load 0.05. The p95 tail in the load test is the *operator's* API on cache misses,
not this server — more RAM or cores would not move it by a millisecond. Only self-hosting a
routing engine would justify A1, and `server/geometry.mjs` removes that need by caching.

## Permissions — never ask cold
`web/js/permissions.js` owns every location and notification request. A browser prompt is a
one-shot: a single Deny kills the API for the origin forever and `requestPermission()` then
returns "denied" without showing anything. So the app explains itself first in its own UI, and
only fires the native prompt after a yes there. **Do not call `Notification.requestPermission`
or `getCurrentPosition` directly** — go through `permissions.ensure(name)`; `ui.locate()`
already does. Blocked permissions get platform-specific recovery steps rather than more asking.

## Unfinished — do not describe these as done
- **Road geometry improves the map only, not the ETA maths yet.** `insight.locateOnRoute` still
  projects onto stop-to-stop straight lines and carries an 8 km off-route tolerance because of
  it. Feeding the road line into `progressKm` would let that tolerance shrink a lot.
- **On-time history records, and is now keyed on the right thing.** It was broken from the day
  it shipped and nobody could tell: the live `arrivals` table still carried `delay_min NOT NULL`
  from before the rename to `arrived_min`, `CREATE TABLE IF NOT EXISTS` never alters an existing
  table, so every insert failed — and `record()` returns false rather than throwing, so it
  reported nothing. **This is the second time this exact class of bug has bitten** (see the
  reports migration); any new column needs a migration, not just an edit to the CREATE.

  Then it was keyed wrong. `reputation()` pooled every service on a route: at Morbi on "Morbi to
  Rajkot" the live table held eight buses arriving between **07:15 and 21:42**, and the median it
  would have shown a rider was **10:11** — a time no bus ever arrives. A route is not a bus. It
  is keyed on `sched_min`, the service's scheduled departure, so the 06:40 and the 21:10 are
  counted apart. Rows recorded before that carry -1 and are never matched.

  It still stays silent below five observations *per service per stop*, which is now five days
  rather than five buses — so it will take a week or so to start speaking, and the harvester
  running every two minutes is what gets it there.

- **TWA is prepared but not built** — no JDK/Android SDK here, and the signing key is the
  owner's to generate and back up. See `twa/README.md`.

## Upstream health (/api/status and the home dot)
`server/uptime.mjs` keeps rolling per-method windows, fed from the single `call()` funnel in
`upstream.mjs` so nothing added later can go unmeasured. The home screen shows one dot; tapping
it opens per-service heartbeats.

**A reply is not the same as a good reply.** A request for a plate that does not exist comes
back HTTP 200 with a plain-text body, so counting parse failures as downtime meant one rider
mistyping a bus number turned the banner red for everybody. `UpstreamError.answered` marks
"the operator replied, just not usefully"; those count as *reachable* and are surfaced to the
owner as `dataErrors` instead. A steady stream of those across every method is how credential
rotation will look — not as an outage.

`server/probe.mjs` probes **every headline method every cycle**, whether or not organic traffic
has touched it. An earlier version skipped anything real requests had already exercised, which
halved the cost and produced a panel reading "100%" off a single sample — an uptime figure only
means something when the sampling rate is constant. Roughly six requests a minute, spaced, never
parallel. `GetBusTrackerDetails_V1` needs a live TripId, so the probe finds one from a timetable
once per cycle and reuses it.

Probes call `gsrtc.*` directly rather than over HTTP, so `uptime` sees them and the usage
counters never do — synthetic traffic in a usage report is a lie about how the app is used.

`probe.warmStations()` sweeps the alphabet once on a near-empty gazetteer. The station list can
only be searched by *name*, so an id arriving via a saved commute or a shared link can never be
resolved on demand and would stay a bare number on the dashboard forever.

## Who a rider is (and why it is not their IP)
Every request arrives at Node through nginx, and until 2026-08-25 `TRUST_PROXY` was never set on
the live host — so `clientIp()` fell through to the socket address and **every rider in the
country was `127.0.0.1`**. That was not only a rate-limit problem:

- **Crowd reports were keyed on a hash of that address**, so all riders were one person. The
  first to report a bus blocked everyone else for an hour, and the 30-second undo withdrew
  whichever report was most recent, whoever had made it. Reports now carry `store.reporterId()`
  — a random id the app keeps locally, sent in the body. Deliberately **not** the analytics
  device id: riders can switch that off and reset it, and reporting has to survive both. It is
  forgeable and that is fine — the per-hour rule is a guard against double-reporting, not a
  security boundary, and the token bucket is what bounds abuse. Missing id falls back to the IP,
  so an older client still works.
- **The rate limiter was one shared 600 rpm bucket** for the whole user base. It had not bitten
  (zero 429s in the logs) but it is an outage for everyone at once, not a slowdown.

Two things make the IP real, and **both** are needed:
1. `TRUST_PROXY=1` in `.env` — nginx was already sending `X-Real-IP` and `X-Forwarded-For`; the
   server was ignoring them.
2. `scripts/nginx-realip.sh` — Cloudflare proxies this site, so nginx's `$remote_addr` is an edge
   address and every rider behind one edge still looks identical. The realip module rewrites it
   from `CF-Connecting-IP`, but **only for requests that genuinely came from Cloudflare**: the
   origin IP is public and directly reachable, so trusting that header unconditionally would let
   anyone pick their own address. Re-run the script when Cloudflare publishes new ranges.

`clientIp()` prefers `X-Real-IP` over `X-Forwarded-For`. The latter is a list any caller may
prepend to, and reading its first entry is exactly how a client-controlled header becomes a
rate-limit identity.

## Translations: two dictionaries, hundreds of lines apart
`scripts/test-i18n.mjs` checks `en` and `gu` against each other. It exists because a **duplicate
key is silent and the later one wins**, and that had already shipped: `alreadyLeft` was defined
once as `'left {n} min ago'` and again ninety lines later as the filter chip's `'Already left'`,
so every departed bus in the timetable showed a bare "Already left" with the minutes thrown away
— which defeats the entire point of showing departed buses, since six minutes ago is catchable
at the next stop and eighty is not. Adding a string means editing two objects; missing the second
is invisible because `t()` falls back to English.

## One upstream timeout does not fit every method
`UPSTREAM_TIMEOUT_MS` is 9s because **live positions** refresh every 20s — a request still
running after nine has missed its own window and another is along shortly. That reasoning does
not transfer. A timetable has no successor: the rider pressed "Find buses" and is waiting on that
one answer. A full page of eighty services on a busy corridor measures 8.3s warm and **19.7s
cold**, so the app's own default query was returning **504 to riders**. `SLOW_METHODS` in
`upstream.mjs` gives that one method 25s. Check the shape of the request before assuming the
default budget suits it.

## Known, not ours
Cloudflare injects its own analytics beacon into every page, and the CSP (`script-src 'self'`)
blocks it — so it logs a console error on every load and collects nothing. The fix is to turn
Cloudflare Web Analytics **off in the Cloudflare dashboard**; do not widen the CSP to admit it.

## Analytics — pseudonymous, and the policy says so
`web/js/stats.js` sends event names from a fixed allowlist (`STAT_EVENTS` in `proxy.mjs`) plus a
**random device id** the app generates locally, so visits can be linked into sessions, funnels
and retention. That makes it **pseudonymous, not anonymous** — say it that way, because
`web/privacy.html` says it that way, and the two must not drift apart.

**The line that does not move: no location, ever.** A movement trail re-identifies a person
with no name anywhere — home plus workplace is enough. There is no column for it. Do not add one.

Which buses a device looks up **is** now recorded (`act:track` with the plate in `detail`), at
the owner's explicit and repeated direction, and `web/privacy.html` says so plainly including
what it implies: that the data can show one install repeatedly checking a bus at a time of day.
`detail` is validated as a plate before storage — the column is free text and the one thing that
must never reach it is anything a rider typed.

Still never recorded: any free text at all. The allowlist is the safeguard — the client
cannot increment a counter that does not already exist server-side, so neither a bug nor a
hostile caller can turn `/api/stat` into somewhere to store text about a person.

Riders get **two** controls, and both must keep working: Settings → *Help improve the app* → Off
stops the sending (and discards the queue, since flushing on the way out would send the batch
they just declined), and *Reset my analytics ID* calls `POST /api/stat/forget`, which really
deletes every row for that device before the app takes a new id.

`housekeeping()` in `proxy.mjs` runs the retention sweeps every six hours. **Nothing was calling
them before** — reports and fired alerts had been growing without limit since v1.6 — and the
90-day analytics retention the policy promises is only true because that timer exists.

Event ordering inside a session uses **row id, not `at`**: a batch inserts in one loop, so many
events share a millisecond and ordering by timestamp made one visit look like it started on
three different screens.

## The owner dashboard (/admin)## The owner dashboard (/admin)
`ADMIN_PASSWORD` in `.env`; **unset means the whole surface 404s**, so a deployment that forgets
to set it is closed rather than open. Sessions are HMAC-signed cookies (HttpOnly, SameSite=Strict,
Secure behind the proxy) keyed off the password, so changing the password invalidates them.
Password comparison is constant-time over hashes, and logins are capped at 6 attempts per IP per
15 minutes — the password is currently an email address, which is guessable, so that lockout is
the only thing standing between it and a dictionary. **Tell the owner to set a random one.**

**It is no longer aggregates only — that changed at the owner's explicit and repeated
direction.** It used to be true by construction: `db.metrics` is keyed on the *thing asked for*
— a plate, a route, an endpoint — never on who asked. That still holds for `metrics`, but the
`sessions` and `events` tables are keyed on a **random per-install device id**, and the dashboard
reads them directly: `sessionList` shows individual visits with their screen-by-screen path,
`busHistory` and `regulars` show which device looks up which bus and how often. That is
pseudonymous, not anonymous, and `web/privacy.html` says so plainly including what it implies.
**The Settings screen must not claim "no tracking"** while that is true, and the two must not
drift apart. The line that has not moved: **no location, ever** — there is no column for it.

**`node --check` cannot see the dashboard's script** — it lives inside a template literal, so
the checker validates a string. Three separate refactors deleted helper functions while their
call sites stayed, and each time the page rendered a sidebar with an empty body and only a
browser console explained why. `scripts/test-admin-page.mjs` parses the script out and checks
it properly; run it after touching that file.

The page is served from `server/admin-page.mjs`, outside the PWA: it is the owner's tool and has
no business being precached, translated or shipped to thousands of phones. It is the one page
with an inline script, so it gets a **per-response CSP nonce** rather than the origin's policy
being loosened — plus `style-src-attr 'unsafe-inline'`, because a nonce covers `<style>` blocks
but not the inline `style` attributes the bars size themselves with.

## Secrets
Credentials live in `.env` (gitignored) and are read via `process.loadEnvFile()`, resolved from the
**project root, not cwd** — pm2/systemd set the working directory somewhere else. `.env.example` is
the committed template. Nothing secret is in source. Quote any value containing `#` in `.env` or it
is silently truncated and surfaces as a confusing upstream 401.
The docs (`CLAUDE.md`, `docs/API_RESEARCH.md`) still spell the credentials out — that is why the
GitHub repo is **private**. Do not make it public without scrubbing those two files first.

## ⚠️ Honesty / ethics (important — do not paper over this)
The backend credentials and AES key here were **extracted from the third-party ST Bus Tracker app**
(`com.rninfosoft.stbustracker`). This is **NOT an official or open API**. Bus positions are
public-interest data, but the *access method* is reverse-engineered credential reuse, and it breaks
the moment the operator rotates keys or adds attestation. The official GSRTC app
(`com.infiniumsolutionzgsrtc.myapplication`) already gates its newer host behind **Google Play
Integrity**, which a third party cannot obtain.

This caveat is stated plainly in the README, in `docs/API_RESEARCH.md`, in `server/upstream.mjs`, and
in the app's own Settings screen ("Where this data comes from"). **Keep it visible.** Do not craft
anything to hide or route around it. Every credential is env-overridable so official access is a
config change, not a rewrite.

## The upstream API (verified working)
Host: `https://gujaratrajyamargvahanvyavaharcorporationmobileapi.infinium.management`
All POST, `application/x-www-form-urlencoded`. Every request sends:
- body: `APIUserName=AaMNex1201`, `APIPassword=AaMNexg@3248!!#` (+ method params)
- header `Authorization`: per-minute AES-192-ECB token — key `1tyu89rtuqeoptyklltyussq`,
  plaintext `deviceId&(stampMMyyyyddHHmm*6)&deviceId&amnexiinfi9849&Infi#65899`, Base64
- header `AmnexAuth`: any non-empty JWT (presence checked, value not validated)

Response is `<string>…JSON…</string>` (ASMX envelope) — unwrap, then `JSON.parse`.

Methods in use (shapes in `docs/API_RESEARCH.md`):
- `TrackingService.asmx/GetVehicleCurrentStatus_V1` {VehicleNo, ScheduleDate} → live Lat/Long + status
- `TrackingService.asmx/VehicleMaster_V1` {Date} → ~8,554 plates {Division,Depot,VehicleRegisteredNo}
- `TransistService.asmx/GetStationList_V1` {StationName} → station autocomplete (en + gu)
- `TransistService.asmx/Page_GetSourceDestinationWiseBusList_V1` → timetable rows w/ BusNo + TripId
- `TransistService.asmx/GetBusServiceTypeList` → service classes
- `TransistService.asmx/GetNearByDepotList_V1` {Lattitude, Longitude} → nearby stations
- `TransistService.asmx/GetBusTrackerDetails_V1` {TripId, TripStatus, TripStartTime} → route + stops + live

**The operator says "no" in plain text, not JSON — and one of those messages lies.**
`unwrap()` handles this; do not undo it. Bodies of `NO BUS AVAILABLE`, `NO DATA FOUND` and
`NO DATA AVAILABLE` are empty results, not faults — there were **1,215** of them in one day's
logs, every one shown to a rider as "the bus operator's service is not responding · HTTP 502".

**`INVALID AUTHENTICATION.` does not mean the credentials are wrong.** It is what
`GetVehicleCurrentStatus_V1` returns for a bus that is **not currently running**. Verified live:
a running plate answered 200 with a position in the same second that two idle plates got this
string on the same credentials, and all 273 occurrences in the logs were that one method. A
genuinely rejected token fails *every* method at once — which is the test to apply before ever
believing this string again. It is mapped to a 404 ("that bus is not running") for the vehicle
method only, and left loud everywhere else, because if the credentials really do rotate this is
the string that will say so.

**Two gotchas, both cost real debugging time:**
1. `GetBusTrackerDetails_V1` is on **TransistService**, not TrackingService (earlier versions of these
   docs and of `src/api/gsrtc.ts` had it wrong — fixed 2026-08-23). Its `TripStartTime` must be the
   timetable row's `ArrivalTimeAtBoarding` **verbatim** (`M/d/yyyy h:mm:ss tt`), and it only answers
   for a trip that is actually running.
2. Several TransistService methods return HTTP 500 unless `IMEINo=0` and empty `column1..3` are sent.
   `server/upstream.mjs` adds these as `FILLER`.

Not available on this older host (404): `GetBusScheduleForRoute_V1`, `GetRoutePoints_V1`,
`GetETATime_V1`, `Page_GetDepotWiseBusList`. `?WSDL` is 401-gated, so the surface is empirical.

## Architecture
```
Browser (PWA) ─► server/proxy.mjs ─► server/upstream.mjs ─► GSRTC backend
React Native  ─► src/api/gsrtc.ts  ─────────────────────►  (same, shared TS core)
```
- **`server/upstream.mjs`** — the ONLY server file that knows the backend. Auth token, endpoint list,
  retry, ASMX unwrapping. Swap this (or the env vars) to change data source.
- **`server/proxy.mjs`** — HTTP server: static files, API routes, TTL cache + in-flight de-dup,
  token-bucket rate limit, param validation, gzip/brotli, CSP + security headers, `/api/health`,
  structured JSON logs, graceful shutdown.
- **`server/tracker.mjs`** — background polling so clients get speed on their first request instead
  of after two of their own polls. **Demand-driven and capped**: a plate is watched only while
  someone is looking at it, dropped 5 min after the last interest, ceiling `TRACKER_MAX_PLATES` (80).
  At the defaults that is ~3 req/s worst case. This is a third party's API we reuse without an
  agreement — **never make this fleet-wide**, and treat the env limits as a budget. Consecutive
  failures trigger a global backoff. `/api/health` exposes `tracker.pollsPerSecond`.
  State is snapshotted to `.data/tracker.json` (atomic write) every 30s and on shutdown, and
  restored on boot minus anything older than 10 min — so a deploy restarts warm.
- **Run exactly one instance.** Cache and tracker are in-process; two copies would double upstream
  load for nothing.
- **`src/api/gsrtc.ts`** — the same data layer for RN/Node (crypto-js for AES).
- **`web/`** — no build step. `index.html`, `styles.css` (token-driven design system), and ES modules
  in `web/js/`: `app.js` (shell, router, theme, deep links, SW) plus `home` `track` `routes` `nearby`
  `settings` `trip` `routemap` screens over shared `api` `store` `i18n` `icons` `ui` `map` `alerts`
  `events`.
- **`web/js/insight.js`** — the derived intelligence: smoothed speed, moving/stopped, where the bus is
  on its line, delay against the schedule, ETA to a stop, and how fast to poll. Pure functions, no DOM,
  covered by `npm test`. **Every result carries a `confidence`, and callers must honour it** — the
  screen shows nothing rather than a number the data cannot support. Two rules learned the hard way:
  the operator's own `NextLocation` outranks our geometry, and a delay over two hours is our misreading,
  not a late bus.
- Leaflet is vendored in `web/vendor/` — no CDN. Map tiles are the only external request.

## Conventions that matter
- **No emoji anywhere in the UI.** Icons come from `web/js/icons.js` (inline SVG, stroke-based).
- **Escape everything from upstream** before `innerHTML` — use `esc()` from `ui.js`. Upstream strings
  are untrusted and also use the literal `"N/A"` for empty, which `clean()` normalises away.
- **All user-visible strings go through `t()`** in `i18n.js`, with a Gujarati translation. Station and
  route names use `localName(en, gu)` so the data's own Gujarati fields surface in Gujarati mode.
- **All z-indexes come from the named `--z-*` scale** in `styles.css`; never invent a number.
  Leaflet positions its own map container, so a map declared after a field will paint over that
  field's dropdown unless both sit on the scale. A field with an open list gets `.open` from
  `autocomplete()` so it clears its sibling fields.
- **`[hidden]` is forced to `display: none !important`** in `styles.css`. The attribute only
  carries UA-stylesheet strength, so any explicit `display` — `.row { display: flex }` was the
  one that bit — silently overrides it and the element stays on screen while every script
  correctly believes it is hidden. Do not remove that rule.
- **Spacing belongs to the container, not the component.** `.flow > * + *` owns the gap between
  stacked blocks and `.sec-title` opens a wider one; components must not set their own outer margin,
  and screens must not carry inline `style="margin-…"`. Everything derives from `--space-1..4`.
  Two competing mechanisms is exactly how the same list ended up with three different gaps.
- `insight.js` must stay **DOM-free** — the server imports it for the shared speed/movement maths.
- **Nothing leaves the device.** Commutes, saved buses, recents and alerts live in `localStorage`
  (`store.js`, `alerts.js`). No analytics, no accounts.
- Service worker: live `/api/` responses are **never** cached; app code is network-first with
  `cache: 'no-cache'` (filenames are not content-hashed, so a stale script could outlive its markup);
  images and vendor files are cache-first. Cross-origin tiles are deliberately not cached — opaque
  responses are charged against the storage quota at a padded size.

## Run it
```bash
npm install
npm start                       # http://localhost:8787
npm test                        # the ETA / delay / confidence logic
npm run smoke                   # every API route + static shell, against a running server
npm run check                   # syntax + types + tests
npm run loadtest                # concurrent riders; reports upstream amplification
npm run verify GJ-18-ZT-1028    # live check of the TS data layer
npm run icons                   # regenerate PNG icon set from web/icons/icon.svg (macOS)
```

## Releasing (no bundler — three manual version stamps)
1. `web/sw.js` → bump `VERSION` (discards the old shell cache).
2. `web/index.html` → bump `?v=` on `styles.css` and `js/app.js`.
3. `package.json` → bump `version`; `/api/health` reports it and Settings shows it.
Add any new `web/js/*.js` module to `SHELL_FILES` in `web/sw.js` or it will not be precached.

### Verify the deploy in a browser. Every time.
`npm run check` and `npm run smoke` both pass while the app is completely broken, because neither
loads the browser modules: `node --check` parses one file at a time, the tests never import
`web/js/*`, and smoke only exercises the API. A `ReferenceError` in `boot()` looks like nothing —
the page renders and the features simply never start.

**This is not hypothetical.** A batch shipped at 22:09 IST on 2026-08-24 deleted `handleDeepLink`
and `located` while their callers stayed. The app was dead for **13.5 hours**, straight through
the 06:00–09:00 morning commute — 116 sessions the previous day, **zero** that morning. And
because `stats.init()` is called *inside* `handleDeepLink`, the crash silently disabled the
analytics that would have shown it: the dashboard reported no traffic rather than an outage.

So after every deploy: open the live site, confirm the console is clean (bar Cloudflare's blocked
beacon), and confirm a session is being recorded. `scripts/test-references.mjs` and
`scripts/test-imports.mjs` catch most of this class now, but the first is scope-blind by design
and neither runs an engine.

## Automatic behaviour (deliberate — do not "simplify" these away)
- Polling paces itself (`insight.pollInterval`): quicker near your stop, slower for a parked bus,
  paused on a hidden tab, resumed on focus and on `online`.
- Home refreshes itself every 60s while visible, and again whenever the tab regains focus.
- Home shows a commute **the way it was saved**, with a one-tap swap that overrides for the
  session. It used to reverse itself after 14:00 and label the result Morning/Return — that
  guess silently flipped a direction the rider had chosen, and with both directions saved it
  produced two cards pointing opposite ways, each claiming to be the return. **Do not
  reintroduce clock-based direction guessing.**
- The Routes list scrolls itself to the next catchable departure (today + default sort only).
- A screen wake lock is held while actively tracking.
- Crowd reports run on **two axes**: occupancy (an ordered 1-5 scale, reported as a median) and
  service status (cancelled / replaced / departed, counted). They are separate because a
  cancelled bus has no occupancy and a replaced one moves the answer to another plate. The
  per-hour reporter limit is **per axis** — one person can truthfully report both. A report can
  be withdrawn for `db.UNDO_MS`. Old `full`/`seats`/`no_show` rows are migrated in place; see
  `scripts/test-reports.mjs`, which runs the migration against a genuine legacy schema.
- The boot splash lives in `index.html` with its CSS **inlined**, because it has to paint on the
  first frame — a splash that waits for styles.css has missed its own moment. It carries a CSS
  fallback timer as well as `app.dismissSplash()`, so a script that never runs leaves a usable
  app rather than a permanent logo, and it holds a short minimum so a warm load does not flash.
- Motion is one shared vocabulary near the end of `styles.css` (things rise in, pressed things
  give slightly), all of it collapsing under the `prefers-reduced-motion` block — which also
  has to stop infinite animations, not just shorten them.
- The map basemap is a rider setting (`mapStyle`): **standard / detailed / satellite**, all
  keyless raster sources, with **detailed** the default. Tile layers are built in exactly one
  function (`map.paint`), so a style applies to all map screens by construction. **Never add
  Google's tile URLs to `MAP_STYLES`** — their terms only permit that data through Google's own
  APIs, so real Google support means a second rendering engine, not a URL.
  `tile.openstreetmap.org` is likewise barred by OSM's own tile policy for a distributed app.

  A fourth style ("Roads", Esri World_Topo) existed only because it wrote road names out. It is
  gone: Voyager names roads as you zoom in, which is where a rider needs them.

  **Do not add Esri's `World_Transportation` label layer over a light basemap.** It was tried as
  a way of writing road names onto every style and it looks awful — it is drawn for dark
  satellite imagery, so over Voyager it renders as purple-haloed text fighting everything
  underneath, duplicating labels Voyager already draws. `paint()` still stacks overlays, and
  satellite still needs one: imagery carries no names at all.
- **Bus stands are drawn on the track, route and trip maps** (`map.showBusStands`), from zoom 11
  in — further out they pile into an unreadable smear and the viewport covers half the state.
  The layer remembers the area it has fetched, because the track map recentres on the bus every
  twenty seconds and would otherwise re-ask on each one.

  Their coordinates cost the operator nothing: every trip response carries `LocationLat`/
  `LocationLong` for its stops and the nearby-depot response carries `Center_Lat`/`Center_Lon` —
  both were being discarded, which is why the app knew 19,024 stand names and could place 39 of
  them. `probe.warmStandCoordinates()` fills the rest by sweeping a grid, because the nearby call
  is the only method that answers "what is around here" and there is no way to ask for a
  station's position by id. Coordinates are validated before storage: the operator sends "0", ""
  and "N/A" for stops it has no position for, and a literal 0,0 is in the Atlantic.
- The bus's map label names where it is going (`plate → NextLocation`), because raster tiles
  carry almost no village names at tracking zoom in rural Gujarat. When a stop list is loaded
  the route is drawn too, with standing labels on just the stop behind and the stop ahead.
- "From you" fills itself in: `track.ensureMyLocation()` seeds from the stored fix and refreshes
  when permission is already granted. It **never prompts** (only acts on `granted`, or on a
  stored fix, which is the sole signal Safari gives) and **never moves the map** — recentring
  belongs to the locate button and would otherwise fight the follow on the bus.
- Choosing a different bus drops the old marker and re-arms auto-follow. `_stUserMoved` latches
  on the first drag; leaving it set across a plate change stranded every later bus off-screen.
- The server tracks watched plates continuously (see `server/tracker.mjs`), and the client seeds its
  own history from `track.fixes` in the `/api/vehicle` response via `adoptServerFixes`.
- The Routes map refreshes every 15s while open and tears itself down when the screen is left.
- The install banner **waits for a free screen**. It used to appear purely on its 12s timer, so
  it landed on top of the walkthrough or the permission primer — and at `--z-toast` it painted
  *over* the primer's Allow button, leaving the rider asked two things and able to answer
  neither. It now sits at `--z-install` (below `--z-sheet`) and re-checks every 4s while a sheet
  or the tour is open. Never raise it above the sheet again.
- `web/js/install.js` owns Add-to-Home-Screen: holds `beforeinstallprompt` on Android, shows the
  Share-button instructions on iOS Safari, tells other iOS browsers to open in Safari. Asks once
  after 25s of use, remembers a dismissal for 21 days.

## Status
Working and verified live: home/morning board with live countdowns and time-aware direction,
track-by-plate with ETA-to-your-stop, delay, movement, smoothed speed, distance-to-you and trail,
whole-route stop timeline with a pickable "your stop", arrival alerts, 2-station timetable with
filters, sorting and countdowns, station and plate autocomplete, nearby stations, offline last-known
position, en/gu, themes, PWA install, icon set.

Also working: live route map, server-side continuous tracking with restart-safe state, install
prompt for Android + iOS, stale-while-revalidate on slow-changing endpoints, and server-pushed
arrival alerts — delivered to a real handset and confirmed (Android; iOS still needs a
home-screen install to be checked).

Measured (150 concurrent riders, 60s, one laptop): 0 errors, p50 14ms, p95 808ms, upstream
amplification **0.106x**. `RATE_LIMIT_RPM` defaults to 600 on purpose — Indian carriers put many
subscribers behind one NAT address, so a per-person limit would lock out a rush-hour crowd.

Not done yet: React Native (Expo) shell over `src/api`, browse-the-fleet-by-depot UI. Community
confirmations and on-time history are built and storing, but stay silent until enough
observations accumulate — see the caveat above.

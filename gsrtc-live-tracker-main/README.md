# ST Tracker

A live tracker for **Gujarat ST (GSRTC) buses**, built for the people who take them every day.
Track any bus by its number plate, see the whole route stop by stop, search timetables between two
stations, and find the stops around you — in English or Gujarati, with no ads and no account.

> **Live at [tracker.shivrajsinh.in](https://tracker.shivrajsinh.in)** — v1.4.3.

```bash
npm install
npm start          # http://localhost:8787
```

## What it does

**Home — your morning board.** Save the trip you make every day and the next departures are already
on screen when you open the app, counting down in real minutes and refreshing themselves while you
look at them. After midday the card turns around and shows your **return** trip instead — labelled,
with a one-tap flip, never a silent switch. Saved buses show their live status and next stop
underneath.

**Track.** Type a plate (or pick one from a timetable) and watch the bus move. Alongside the map you
get what the raw feed does not tell you directly: **how long until it reaches your stop**, whether it
is **running late**, whether it is **moving or stopped** (and for how long), a smoothed **speed**, the
**distance from where you are standing**, and a **trail** of where it has been this session. Star a
bus to keep it, or share a link that opens straight onto it.

Those estimates are computed in `web/js/insight.js` from the live position, the stop list and the
timetable. Each one carries a confidence, and the screen shows nothing rather than a number it cannot
stand behind — a tracker that confidently states the wrong ETA is worse than one that admits it does
not know. `npm test` covers that behaviour.

**Whole route.** For a running trip, every stop on the line with arrival times, which ones the bus
has already passed, how far it has travelled, and the live position drawn on the route.

**Arrival alerts.** Pick a stop on the route — or your own position — and get a notification when the
bus comes within your chosen radius. Alerts are evaluated in the page, so they work while ST Tracker
is open; there is no server pushing to you.

**Routes.** Every bus between two stations on a date, filtered by *running now* or service class, and
sorted by departure, fastest, or running-first. Each row carries the plate, route, duration, seats,
distance, and how long until it leaves — and a full-day timetable opened at noon scrolls itself to the
next service you could actually catch. Tap one to track it.

Switch to **Map** and every bus currently running that route is on one map, moving, refreshing every
fifteen seconds. Tap a bus for its plate, class, speed and next stop, then track it from there.

**Nearby.** Stations around you on a map with distances, one tap to see what leaves from there, and a
directions link out to your maps app.

**Built in.** English + Gujarati throughout (station and route names come through in Gujarati too),
light/dark/system themes, a large-text setting, installable as a PWA, and an offline mode that keeps
showing the last known position of the bus you were tracking.

**Speed without the wait.** The server keeps polling the buses people are looking at and holds a short
history for each, so the first request already comes back with speed, movement and a trail — no
standing there for two client polls before the app will tell you anything. See *Continuous tracking*
below for the load this costs and how it is capped.

**Installable.** On Android it offers the real install prompt; on iOS, where there is no install
API at all, it shows where the Share → Add to Home Screen button is. It asks once, after the app has
actually been used, and remembers a dismissal for three weeks.

**It looks after itself.** Polling paces itself — quicker as the bus closes on your stop, slower when
it is parked, stopped entirely on a tab you are not looking at, and resumed the moment you come back
or the connection returns. The screen stays awake while you are tracking. The morning board refreshes
on its own. None of it needs a tap.

## How it fits together

```
Browser (PWA)  ──►  server/proxy.mjs  ──►  GSRTC "mobileapi" backend
                    (holds the auth, caches, rate limits, serves web/)

React Native   ──►  src/api/gsrtc.ts  ──►  same backend (shared TS core)
```

| Path | What it is |
|---|---|
| `web/` | The PWA. `index.html` + `styles.css` + ES modules in `web/js/`, no build step. |
| `web/js/` | `app.js` (shell/router), one module per screen, plus `api` `store` `i18n` `icons` `ui` `map` `alerts` `events`. |
| `web/js/insight.js` | Pure derivations: speed, movement, position on route, delay, ETA, poll pacing. Every result carries a confidence. |
| `server/proxy.mjs` | HTTP server: static files, API routes, cache, rate limit, security headers, health. |
| `server/upstream.mjs` | The **only** file that knows the upstream — auth token, endpoints, response shapes. |
| `src/api/gsrtc.ts` | The same data layer for React Native / Node. |
| `docs/API_RESEARCH.md` | Full reverse-engineering writeup. |

Nothing is bundled and nothing is fetched from a CDN — Leaflet is vendored into `web/vendor/`. Map
tiles are the one external request the app makes.

## API

All `GET`, all JSON, all served by the proxy so the browser never holds upstream credentials.

| Route | Purpose |
|---|---|
| `/api/health` | version, uptime, upstream host, cache size |
| `/api/vehicle/:plate?date=&focus=1` | live position + status, plus the tracked history (`{ vehicle, track }`) |
| `/api/plates?q=` | plate autocomplete over the cached fleet master |
| `/api/stations/:query` | station autocomplete (English + Gujarati) |
| `/api/nearby?lat=&lng=` | stations near a coordinate |
| `/api/timetable?from=&to=&date=&type=&page=&pageSize=` | buses between two stations |
| `/api/trip?tripId=&status=&start=` | stop-by-stop route + live position (running trips only) |
| `/api/live?from=&to=&date=&limit=` | every bus running between two stations, positioned — the route map |
| `/api/servicetypes` | service classes, for the filter |
| `/api/fleet?date=` | the whole vehicle master (~8.5k plates) |

Every parameter is validated; responses are cached server-side with per-route TTLs (8s for a live
position, 12h for station lookups) and de-duplicated so a hundred clients tracking one bus produce
one upstream call.

## Deploying

Live on an Oracle Cloud Always Free instance (Ubuntu 24.04, Mumbai) behind nginx, with a
Let's Encrypt certificate that renews itself via `certbot.timer`. pm2 runs the app and
resurrects it on reboot.

```bash
git push                      # the server pulls from the repo, not from your machine
npm run deploy                # pull, restart, wait for /api/health to answer
BASE=https://tracker.shivrajsinh.in npm run smoke
```

`scripts/deploy.sh` is the first-time bootstrap (packages, firewall, nginx, pm2, certbot);
`scripts/redeploy.sh` is the everyday one. Secrets never travel with the code — `.env` lives
only on the server, and the box pulls from the private repo with its own read-only deploy key.

**Timezone matters.** The upstream validates its auth token against a minute-precision clock in
IST, so every timestamp is computed in `Asia/Kolkata` explicitly rather than in the host's local
zone. Without that, a UTC server gets a flat HTTP 401 — which is exactly what happened on the
first deploy.

## Continuous tracking

`server/tracker.mjs` keeps polling vehicles in the background so clients get speed and movement
immediately rather than after two of their own polls.

It is **demand-driven, never fleet-wide**. A plate enters the watch list when someone opens it or
when it turns up on a route map, and drops out five minutes after the last person stopped caring.
That matters: the upstream is a third party whose API we are reusing without an agreement, and
polling all 8,554 vehicles would be both rude and the fastest way to get the credentials rotated.

| Variable | Default | Purpose |
|---|---|---|
| `TRACKER_ENABLED` | `1` | `0` disables it entirely and falls back to on-demand fetching |
| `TRACKER_MAX_PLATES` | `80` | hard ceiling on how many vehicles are watched at once |
| `TRACKER_INTERVAL_MS` | `25000` | poll interval for a bus someone currently has open |
| `TRACKER_IDLE_INTERVAL_MS` | `45000` | poll interval for a bus only on a route map |
| `TRACKER_CONCURRENCY` | `3` | upstream requests in flight at once |
| `TRACKER_HISTORY` | `40` | fixes retained per vehicle |
| `TRACKER_STATE_FILE` | `.data/tracker.json` | where the history is snapshotted |
| `TRACKER_SAVE_MS` | `30000` | how often that snapshot is written |

State survives a restart. The tracker snapshots its history every 30s and on shutdown (atomic
write, so a half-written file is never read back), and restores it on boot — discarding anything
older than ten minutes, since a stale fix paired with a fresh one would poison the speed estimate.
A deploy therefore comes back warm instead of making the first rider wait for it to be relearned.

**Run one instance.** The cache and tracker are in-process. Two copies behind a load balancer would
each keep their own, doubling upstream load for no benefit. One small server is the right shape for
this, and comfortably handles the numbers above.

At the defaults the ceiling is roughly **3 requests per second** and in practice it sits far lower —
`/api/health` reports `tracker.pollsPerSecond` so you can watch it. Consecutive upstream failures
trigger a global backoff rather than retry pressure. Raising these limits raises the risk to the
credentials; treat them as a budget, not a starting point.

## Configuration

All optional — the defaults run correctly out of the box.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `BIND` | `8787` / `0.0.0.0` | listen address |
| `RATE_LIMIT_RPM` | `600` | requests per minute per IP (`0` disables). Deliberately generous — Indian mobile carriers put many subscribers behind one NAT address, so a per-person limit would lock out a crowd |
| `TRUST_PROXY` | off | read the client IP from `X-Forwarded-For` — only behind a proxy you control |
| `ALLOWED_ORIGINS` | none | comma-separated origins allowed to call the API cross-origin |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `UPSTREAM_TIMEOUT_MS` / `UPSTREAM_RETRIES` | `15000` / `1` | upstream call budget |
| `GSRTC_HOST`, `GSRTC_API_USER`, `GSRTC_API_PASS`, `GSRTC_AES_KEY`, `GSRTC_AUTH_SECRET`, `GSRTC_AMNEX_AUTH` | the reverse-engineered values | upstream credentials — **override these the day you get official access** |

Deploy behind TLS (the app needs a secure context for geolocation, notifications and the service
worker) and set `TRUST_PROXY=1` if a reverse proxy terminates it. A `Dockerfile` is included.

## Releasing

There is no bundler, so three things are version-stamped by hand:

1. `web/sw.js` — bump `VERSION` so the old shell cache is discarded.
2. `web/index.html` — bump the `?v=` on `styles.css` and `js/app.js`.
3. `package.json` — bump `version`; `/api/health` and the Settings screen report it.

App code is served `no-cache` and fetched network-first by the service worker, so a deploy takes
effect on the next load; the version stamps just make it immediate.

Icons are generated from `web/icons/icon.svg` — edit the SVG, then `npm run icons` (macOS).

## ⚠️ Where the data comes from — read this before shipping

The backend credentials and AES key in this repo were **reverse-engineered from a third-party app**
("ST Bus Tracker", `com.rninfosoft.stbustracker`). This is **not an official or open API**:

- It can break the moment the operator rotates keys or adds real attestation. The *official* GSRTC
  app already gates its newer host behind Google Play Integrity — see the research doc.
- Bus positions are public-interest data, but the access method here is credential reuse.
- **Before running this publicly or at scale, get official API access** from GSRTC / Infinium / Amnex
  and point `server/upstream.mjs` (or the env vars above) at it. No UI code needs to change.

ST Tracker is an independent app, not affiliated with or endorsed by GSRTC. The app says so in its
own Settings screen, and that notice should stay there.

## Checks

```bash
npm test                       # the ETA / delay / confidence logic
npm run smoke                  # every API route + the static shell, against a running server
npm run check                  # syntax, types, and the tests
npm run loadtest               # concurrent riders; reports latency and upstream amplification
npm run verify GJ-18-ZT-1028   # hit the upstream directly through the shared TS layer
```

### What the load test is for

Not raw throughput — the question it answers is **does serving N commuters cost N times as much
upstream traffic?** It reads the tracker's poll counter from `/api/health` before and after, so the
headline number is amplification.

Measured on one laptop, 150 concurrent riders at the app's real polling cadence for 60s:

| | |
|---|---|
| requests served | 509, zero errors, zero rate-limited |
| latency | p50 14 ms · p95 808 ms |
| upstream polls caused | 54 (0.62/s) |
| **amplification** | **0.106x** — a hundred riders cost the operator less than ten would unaided |

The p95 tail is the operator's own response time on a cold cache. Timetables, stations and nearby
lookups are served stale-while-revalidate for exactly that reason: past the TTL the cached copy goes
out immediately while a refresh runs behind it. Live positions never do that — stale is the whole
problem there.

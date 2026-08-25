/* Track screen: one bus, live on the map.
 *
 * The raw feed gives a dot. What a commuter standing at a stop wants is the answer to
 * "how long until it gets to me, and is it late" — so when we know the trip, this screen
 * polls the route alongside the position and derives that (see insight.js). It also paces
 * its own polling: faster when the bus is closing on your stop, slower when it is parked.
 */

import { api, ApiError } from './api.js';
import { icon, iconFilled } from './icons.js';
import { t, localName, OCCUPANCY_KEYS } from './i18n.js';
import * as store from './store.js';
import * as alerts from './alerts.js';
import * as push from './push.js';
import * as permissions from './permissions.js';
import * as stats from './stats.js';
import * as insight from './insight.js';
import { emit } from './events.js';
import {
  $, esc, clean, distance, num, since, haversineKm, locate,
  toast, autocomplete, emptyState, errorState, openSheet, closeSheet,
} from './ui.js';
import { createMap, busIcon, stopIcon, meIcon, glideTo, tooltip, fit, brandColour, mutedColour, showBusStands, markStandsNearBus, setRouteStops} from './map.js';

const TRAIL_MAX = 60;
const TRIP_REFRESH_MS = 30000;

let map, marker, meMarker, trailLine;
let plate = '';
let trip = null;              // { tripId, status, start, route } when we came from a timetable
let timer = null;
let fixes = [];               // {lat,lng,at} — drives movement, speed and the trail
let myPos = null;
let controller = null;
let wakeLock = null;

// Derived-route state, only populated when we know which trip this is.
let stops = [];
let targetIndex = -1;         // the stop the rider is waiting at
let tripFetchedAt = 0;
let roadIndex = null;        // the real road, once the router has supplied it
let routeLayer = null;       // the line and its stops, held together so they clear as one
let routeDrawnFor = null;    // 'plate:nextStopIndex' — redraw only when the bracket changes
let lastRow = null;
let crowd = null;            // { total, occupancy, status, replacement } — what riders say
let undoUntil = 0;           // epoch ms until which the last report can be taken back
let occupancyOpen = false;   // the slider is revealed only on a deliberate tap
let undoTimer = null;

/* ------------------------------------------------------------------ setup */
export function init() {
  map = createMap('map', { zoom: 7 });
  showBusStands(map);
  // Once the rider pans the map themselves, stop yanking it back on every poll.
  map.on('dragstart', () => { map._stUserMoved = true; });

  autocomplete($('#plate'), $('#plate-ac'), {
    fetcher: (q) => api.plates(q),
    render: (r) => `<span class="glyph">${icon('bus', 'i i-sm')}</span>
      <span class="grow"><span class="t1">${esc(r.plate)}</span>
      <span class="t2">${esc([clean(r.depot), clean(r.division)].filter(Boolean).join(' · '))}</span></span>`,
    onPick: (r) => start(r.plate),
  });

  $('#track-go').addEventListener('click', () => start($('#plate').value));
  $('#plate').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#plate-ac').getAttribute('aria-expanded') !== 'true') start($('#plate').value);
  });

  $('#pnr-toggle')?.addEventListener('click', () => {
    const row = $('#pnr-row');
    const toggle = $('#pnr-toggle');
    const opening = row.hasAttribute('hidden');
    row.toggleAttribute('hidden', !opening);
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.classList.toggle('open', opening);
    if (opening) $('#pnr')?.focus();
    else { $('#pnr-card').style.display = 'none'; }
  });

  // The occupancy slider. `input` only repaints; `change` fires on release and is what reports,
  // so dragging across the scale does not file four claims on the way to the fifth.
  $('#track-status')?.addEventListener('input', (e) => {
    const range = e.target.closest('[data-occ-range]');
    if (range) paintOccupancy(Number(range.value));
  });
  $('#track-status')?.addEventListener('change', (e) => {
    const range = e.target.closest('[data-occ-range]');
    if (range) sendReport('headcount', { headcount: Number(range.value) });
  });

  $('#pnr-go')?.addEventListener('click', () => lookupPnr($('#pnr').value));
  $('#pnr')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupPnr($('#pnr').value);
  });
  $('#pnr-card')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="view-ticket"]');
    if (btn) openTicketSheet(btn.dataset.pnr);
  });

  renderFabs();
  $('#map-fabs').addEventListener('click', onStatusClick);
  $('#track-status').addEventListener('click', onStatusClick);
  $('#track-chips').addEventListener('click', (e) => {
    // Dismiss is checked first: it sits inside the chip, so a plain [data-plate] lookup would
    // match the surrounding button and start tracking the bus being removed.
    const forget = e.target.closest('[data-forget-recent]');
    if (forget) {
      store.recents.removePlate(forget.dataset.forgetRecent);
      return renderChips();
    }
    const chip = e.target.closest('[data-plate]');
    if (chip) start(chip.dataset.plate);
  });

  // Automatic: stop burning requests on a tab nobody is looking at, pick straight back up
  // when they return, and recover by itself when the connection comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPolling(); releaseWakeLock(); }
    else if (plate) { poll(); requestWakeLock(); }
  });
  window.addEventListener('online', () => { if (plate) poll(); });

  renderChips();
  renderIdle();
}

async function lookupPnr(rawPnr) {
  const pnr = (rawPnr || '').trim().toUpperCase();
  if (!pnr) return;
  if ($('#pnr')) $('#pnr').value = pnr;
  const btn = $('#pnr-go');
  const card = $('#pnr-card');
  if (btn) { btn.disabled = true; btn.textContent = t('loading'); }
  try {
    const res = await api.pnr(pnr);
    const item = Array.isArray(res) ? res[0] : res;
    if (!item || !item.VehicleNo) {
      if (card) {
        card.style.display = 'block';
        card.innerHTML = `<div class="note warn">${icon('alert', 'i i-sm')}<div>${esc(t('pnrNotFound'))}</div></div>`;
      }
      toast(t('pnrNotFound'), 'alert');
      return;
    }

    const veh = clean(item.VehicleNo);
    const route = clean(item.RounteName);
    const dep = clean(item.DepartureDateTime);
    const status = clean(item.Status);
    const nextLoc = clean(item.NextLocation);

    if (card) {
      card.style.display = 'block';
      card.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div>
            <span class="badge ${/run/i.test(status) ? 'badge-live' : ''}">${esc(status || 'Booked')}</span>
            <strong style="margin-left:8px;font-size:calc(15px*var(--step));">PNR: ${esc(pnr)}</strong>
          </div>
          <button class="btn sm ghost" data-act="view-ticket" data-pnr="${esc(pnr)}">${icon('ticket', 'i i-sm')}${esc(t('ticketDetails'))}</button>
        </div>
        ${route ? `<div class="kv"><span class="k">${esc(t('route'))}</span><span class="v">${esc(route)}</span></div>` : ''}
        ${dep ? `<div class="kv"><span class="k">${esc(t('departs'))}</span><span class="v">${esc(dep)}</span></div>` : ''}
        ${veh && veh !== '0' ? `<div class="kv"><span class="k">${esc(t('plateLabel'))}</span><span class="v" style="font-weight:700;color:var(--brand);">${esc(veh)}</span></div>` : ''}
        ${nextLoc ? `<div class="kv"><span class="k">${esc(t('nextStop'))}</span><span class="v">${esc(nextLoc)}</span></div>` : ''}
      `;
    }

    if (veh && veh !== '0') {
      start(veh);
    } else {
      toast(t('pnrNoVehicle'), 'info');
    }
  } catch (e) {
    if (card) {
      card.style.display = 'block';
      card.innerHTML = `<div class="note warn">${icon('alert', 'i i-sm')}<div>${esc(e.message || t('errGeneric'))}</div></div>`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('lookup'); }
  }
}

async function openTicketSheet(pnrNo) {
  const body = document.createElement('div');
  body.className = 'pad-3 flow';
  body.innerHTML = `
    <div class="field">
      <span class="lead">${icon('phone', 'i i-sm')}</span>
      <input id="tkt-mobile" class="input" type="tel" inputmode="numeric" placeholder="${esc(t('mobileNumber'))} (10 digits)" maxlength="10" />
    </div>
    <button class="btn block" id="tkt-fetch">${icon('ticket', 'i i-sm')}${esc(t('ticketDetails'))}</button>
    <div id="tkt-result" class="flow" style="margin-top:var(--space-2);"></div>
  `;

  const doFetch = async () => {
    const mobile = ($('#tkt-mobile', body)?.value || '').trim();
    if (!/^\d{10}$/.test(mobile)) {
      toast(t('mobileNumber'), 'alert');
      return;
    }
    const resEl = $('#tkt-result', body);
    const fetchBtn = $('#tkt-fetch', body);
    if (fetchBtn) fetchBtn.disabled = true;
    if (resEl) resEl.innerHTML = `<div class="center" style="padding:var(--space-3);">${icon('refresh', 'i spin')}</div>`;
    try {
      const rows = await api.ticket({ pnr: pnrNo, mobile });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || (!row.seatNo && !row.fromPlace)) {
        if (resEl) resEl.innerHTML = `<div class="note warn">${icon('alert', 'i i-sm')}<div>${esc(t('pnrNotFound'))}</div></div>`;
        return;
      }
      if (resEl) {
        resEl.innerHTML = `
          <div class="card pad flow">
            <div class="row" style="justify-content:space-between;align-items:center;">
              <strong>${esc(row.fromPlace || '')} &rarr; ${esc(row.toPlace || '')}</strong>
              <span class="badge live">${esc(row.classofService || '')}</span>
            </div>
            <div class="kv"><span class="k">${esc(t('seatNo'))}</span><span class="v" style="font-weight:700;color:var(--brand);">${esc(row.seatNo || '')}</span></div>
            <div class="kv"><span class="k">${esc(t('fare'))}</span><span class="v">₹${esc(row.totalFare || '')}</span></div>
            ${row.pickupPointName ? `<div class="kv"><span class="k">${esc(t('pickup'))}</span><span class="v">${esc(row.pickupPointName)} (${esc(row.pickupPointTime || '')})</span></div>` : ''}
            ${row.dropoffPoint ? `<div class="kv"><span class="k">${esc(t('dropoff'))}</span><span class="v">${esc(row.dropoffPoint)}</span></div>` : ''}
            ${row.dateofJourney ? `<div class="kv"><span class="k">${esc(t('date'))}</span><span class="v">${esc(row.dateofJourney)} ${esc(row.dateTime || '')}</span></div>` : ''}
          </div>
        `;

        try {
          const points = await api.pickupPoints({ pnr: pnrNo, trip: row.tripCode || '0' });
          if (points && points.length > 0) {
            const stopsHtml = points.map((p, idx) => `
              <div class="row" style="align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line-2);">
                <span class="badge sm" style="background:var(--surface-2);color:var(--ink-2);">${idx + 1}</span>
                <span style="flex:1;font-weight:600;font-size:calc(13.5px*var(--step));">${esc(p.pickPointName || '')}</span>
                <span style="color:var(--ink-3);font-size:calc(12px*var(--step));">${esc(p.pickupPointTime || '')}</span>
              </div>
            `).join('');
            resEl.innerHTML += `
              <div class="card pad flow" style="margin-top:var(--space-2);">
                <div class="sec-title" style="margin:0 0 6px 0;">${esc(t('pickupPoints'))}</div>
                ${stopsHtml}
              </div>
            `;
          }
        } catch { /* optional enhancement */ }
      }
    } catch (err) {
      if (resEl) resEl.innerHTML = `<div class="note warn">${icon('alert', 'i i-sm')}<div>${esc(err.message || t('errGeneric'))}</div></div>`;
    } finally {
      if (fetchBtn) fetchBtn.disabled = false;
    }
  };

  $('#tkt-fetch', body)?.addEventListener('click', doFetch);
  $('#tkt-mobile', body)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFetch(); });

  openSheet({
    title: t('ticketDetails'),
    subtitle: `PNR: ${pnrNo}`,
    body,
  });
}

export function onShow() {
  setTimeout(() => map?.invalidateSize(), 60);
  renderChips();
  if (plate && !timer && !document.hidden) poll();
  if (plate) requestWakeLock();
  ensureMyLocation();
}

export function onHide() { stopPolling(); releaseWakeLock(); }

/** Entry point used by every other screen. */
/**
 * Whether a bus is being watched right now.
 *
 * Used by the update path: a new build should not reload the page out from under someone
 * following their bus across the map. It waits until they have left the screen.
 */
export function isActive() {
  return Boolean(plate && timer);
}

export function start(nextPlate, context = null) {
  const next = normalise(nextPlate);
  if (!next) return;
  if (next !== plate) {
    fixes = [];
    renderFabs();   // a new bus has no position yet, so nothing to recentre on
    trailLine?.remove(); trailLine = null;
    stops = []; targetIndex = -1; tripFetchedAt = 0; lastRow = null; crowd = null;
    occupancyOpen = false;
    clearUndo();
    roadIndex = null;

    // A different bus is somewhere else entirely, so the map has to let go of the old one.
    // Dropping the marker makes the first fix a clean jump; keeping it would glide the previous
    // bus's marker across the state to the new position, which reads as one bus teleporting.
    marker?.remove(); marker = null;
    if (routeLayer && map) map.removeLayer(routeLayer);
    routeLayer = null; routeDrawnFor = null;
    // And re-arm auto-follow. `_stUserMoved` latches on the first drag so that panning around
    // one bus is not fought by the next poll — but it was never cleared when the bus changed,
    // so a single drag left every later bus stranded off-screen until the recentre button was
    // pressed. Choosing a new bus is a fresh intent to watch it.
    if (map) map._stUserMoved = false;
  }
  plate = next;
  if (context?.trip) trip = context.trip;
  $('#plate').value = next;
  $('#plate').dataset.val = next;
  store.recents.pushPlate(next);
  stats.track('act:track', next);
  renderChips();
  emit('nav', 'track');
  requestWakeLock();
  ensureMyLocation();
  poll();
}

const normalise = (v) => (v || '').toString().trim().toUpperCase().replace(/\s+/g, '');

/* ------------------------------------------------------------------ screen wake lock */
/** Holding the phone at a stop watching the bus approach should not need thumb taps. */
async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator) || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* already gone */ }
  wakeLock = null;
}

/* ------------------------------------------------------------------ polling */
function stopPolling() {
  clearTimeout(timer);
  timer = null;
  controller?.abort();
  controller = null;
}

/** Automatic pacing: the interval follows what the bus is doing, not a fixed clock. */
function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const base = Math.max(10, store.settings.get().refresh);
  const eta = currentEta();
  const seconds = insight.pollInterval(base, {
    movement: insight.movementFrom(fixes).state,
    etaMinutes: eta?.minutes ?? null,
    freshness: insight.freshness(fixes[fixes.length - 1]?.at),
  });
  timer = setTimeout(poll, seconds * 1000);
}

async function poll() {
  if (!plate) return;
  const mine = plate;
  controller?.abort();
  controller = new AbortController();
  try {
    const { vehicle, track } = await api.vehicle(mine, { focus: true, signal: controller.signal });
    if (mine !== plate) return;
    if (track?.fixes?.length) adoptServerFixes(track.fixes);
    handleRow(vehicle);
    if (trip?.tripId && Date.now() - tripFetchedAt > TRIP_REFRESH_MS) refreshTrip(mine);
    refreshCrowd(mine);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'abort') return;
    if (mine !== plate) return;
    stats.track(e instanceof ApiError && e.kind === 'timeout' ? 'err:timeout' : 'err:track-failed');
    renderOfflineOrError(e);
  } finally {
    if (mine === plate) schedule();
    // Riders walk to the stop while they watch, so "from you" has to keep up. The staleness
    // guard inside makes this a no-op on most polls.
    if (mine === plate) ensureMyLocation();
  }
}

/** What other riders are saying. Never let this failing affect the position display. */
async function refreshCrowd(forPlate) {
  try {
    const data = await api.reports(forPlate, clean(lastRow?.RouteName));
    if (forPlate !== plate) return;
    const changed = JSON.stringify(data) !== JSON.stringify(crowd);
    crowd = data;
    if (changed) render(lastRow, fixes[fixes.length - 1] || null);
  } catch { /* reports are a bonus, not a requirement */ }
}

/** The stop list is what turns a dot into an ETA, so it is refreshed alongside the position. */
async function refreshTrip(forPlate) {
  tripFetchedAt = Date.now();
  try {
    const rows = await api.trip({ tripId: trip.tripId, status: trip.status ?? 1, start: trip.start, plate, route: trip.route });
    if (forPlate !== plate || !rows.length) return;
    stops = insight.normaliseStops(rows);
    render(lastRow, fixes[fixes.length - 1] || null);
    drawRoute();
    loadRoad(forPlate);
  } catch {
    // A trip that has finished stops answering; the position alone still works.
    stops = [];
  }
}

/**
 * The server has been watching this bus continuously, so its history is longer and older
 * than anything this page could have gathered. Take it as the baseline and keep only our
 * own fixes that are newer, rather than waiting two polls to know the speed.
 */
function adoptServerFixes(serverFixes) {
  const newest = serverFixes[serverFixes.length - 1]?.at ?? 0;
  const ours = fixes.filter((f) => f.at > newest);
  fixes = [...serverFixes, ...ours].slice(-TRAIL_MAX);
  renderFabs();
}

/**
 * Fetches the route's road line once, and keeps it.
 *
 * With it, "how far off the route is this bus" is measured against the actual road instead of
 * the chord between two sparse stops — where a bus on a perfectly ordinary detour can read as
 * fifty kilometres off course. That is why the straight-line tolerance had to be eight
 * kilometres, and why it can now be one and a half.
 */
async function loadRoad(forPlate) {
  if (roadIndex || !trip?.tripId) return;
  try {
    const line = await api.geometry({ tripId: trip.tripId, status: trip.status ?? 1, start: trip.start });
    if (forPlate !== plate || !line) return;
    roadIndex = insight.buildRoadIndex(line);
    render(lastRow, fixes[fixes.length - 1] || null);
    drawRoute();   // swap the chord for the road now that we have it
  } catch { /* straight lines still work, just less precisely */ }
}

function handleRow(row) {
  if (!row) return render(null, null);

  const lat = parseFloat(row.Latitude), lng = parseFloat(row.Longitude);
  const hasFix = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
  let pos = null;
  if (hasFix) {
    pos = { lat, lng };
    const prev = fixes[fixes.length - 1];
    if (!prev || haversineKm(prev, pos) > 0.002) { fixes.push({ ...pos, at: Date.now() }); renderFabs(); }
    if (fixes.length > TRAIL_MAX) fixes.shift();
    store.lastSeen.put(plate, { lat, lng, row });
    alerts.check(plate, pos);
    drawBus(pos, row);
  }
  render(row, pos);
}

/* ------------------------------------------------------------------ derived */
/**
 * Everything route-derived comes from one fix so the three numbers on screen agree with
 * each other. The operator's own "next stop" anchors it; our geometry only refines it.
 */
function routeFix() {
  if (!stops.length) return null;
  const located = insight.locateOnRoute(
    stops, fixes[fixes.length - 1] || null, clean(lastRow?.NextLocation), roadIndex,
  );
  if (located.km == null || located.confidence === 'low') return null;
  return located;
}

function currentDelay(located = routeFix()) {
  if (!located) return null;
  return insight.delayMinutes(stops, located.km, located.confidence);
}

/** ETA to the rider's chosen stop, or to the next stop on the line if they have not picked one. */
function currentEta() {
  const located = routeFix();
  if (!located) return null;
  const index = targetIndex >= 0 ? targetIndex
    : located.nextIndex >= 0 ? located.nextIndex
      : insight.nextStopIndex(stops, located.km);
  if (index < 0 || !stops[index]) return null;
  const eta = insight.etaToStop(stops, index, {
    busKm: located.km,
    delay: currentDelay(located),
    speedKmh: insight.speedFrom(fixes).kmh,
  });
  return eta ? { ...eta, stop: stops[index], chosen: targetIndex >= 0 } : null;
}

/** Station names carry a parenthesised city that adds nothing inside a narrow metric cell. */
const shorten = (name, max = 26) => {
  const trimmed = name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
};

const formatMinutes = (m) => (m <= 0 ? t('arrivingNow')
  : m < 60 ? t('minutesShort', { n: m })
    : t('hoursShort', { h: Math.floor(m / 60), m: m % 60 }));

/* ------------------------------------------------------------------ map */

/**
 * The route on the map, and the two place names that answer "where is it".
 *
 * Raster tiles carry almost no village names at tracking zoom in rural Gujarat, so the bus can
 * sit on an empty beige field with nothing around it to read. No basemap fixes that — the
 * labels are not in the tiles to begin with. But the stops of the bus's own route are exactly
 * the names a rider wants, and the app already has them with coordinates.
 *
 * Only the stop behind and the stop ahead get a standing label. Labelling all thirty would bury
 * the map in text, and almost none of it would be near the bus.
 */
const AT_STOP_KM = 0.25;   // close enough that the bus is at the stand, not passing it

/** The stop the bus is currently standing at, or null. */
function stopAtNow() {
  const pos = fixes[fixes.length - 1];
  if (!pos || !stops.length) return null;
  let best = null;
  for (const s of stops) {
    if (s.lat == null || s.lng == null) continue;
    const km = haversineKm(pos, { lat: s.lat, lng: s.lng });
    if (km <= AT_STOP_KM && (!best || km < best.km)) best = { stop: s, km };
  }
  return best?.stop || null;
}

function drawRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (!map) return;
  if (!stops.length) {
    // No route means nothing to defer to — the stand layer is the only thing naming places.
    setRouteStops(map, []);
    return;
  }

  const group = L.layerGroup();
  const placed = stops.filter((s) => s.lat != null && s.lng != null);

  const loc = routeFix();
  const nextIdx = loc ? insight.nextStopIndex(stops, loc.km) : -1;
  // Past the last stop, the bus is arriving: the stop behind it is the final one.
  const prevIdx = nextIdx > 0 ? nextIdx - 1 : (nextIdx === -1 && loc ? stops.length - 1 : -1);

  // Prefer the real road; the stop-to-stop chord is a poor drawing of a bus route but is
  // better than no line at all when the router has not answered yet.
  const line = roadIndex?.points?.length > 1
    ? roadIndex.points
    : placed.map((s) => [s.lat, s.lng]);
  if (line.length > 1) {
    L.polyline(line, { color: mutedColour(), weight: 5, opacity: .45, lineJoin: 'round' })
      .addTo(group);
  }

  // Hand the stand layer the stops this route already draws, so it does not draw them a second
  // time. It fetches independently and may already hold some of them.
  setRouteStops(map, placed.map((s) => L.latLng(s.lat, s.lng)));

  const here = stopAtNow();
  placed.forEach((s) => {
    const done = nextIdx >= 0 && s.index < nextIdx;
    const at = here && here.index === s.index;
    const marker = L.marker([s.lat, s.lng], { icon: stopIcon(done, { at }) });
    const name = localName(clean(s.name), clean(s.nameGu));
    if (!name) return;

    if (s.index === prevIdx || s.index === nextIdx) {
      const ahead = s.index === nextIdx;
      marker.bindTooltip(esc(shorten(name, 18)), {
        permanent: true,
        direction: ahead ? 'right' : 'left',
        className: 'map-tip stop-tip',
        offset: [ahead ? 9 : -9, 0],
      });
    } else {
      // The rest stay quiet until tapped, so the map keeps its shape.
      marker.bindTooltip(esc(name), { direction: 'top', className: 'map-tip' });
    }
    marker.addTo(group);
  });

  group.addTo(map);
  routeLayer = group;
  routeDrawnFor = `${plate}:${nextIdx}`;
}

/** Redraws only when the bus has actually moved between stops — not on every poll. */
function maybeDrawRoute() {
  if (!map || !stops.length) return;
  const loc = routeFix();
  const key = `${plate}:${loc ? insight.nextStopIndex(stops, loc.km) : -1}`;
  if (key !== routeDrawnFor) drawRoute();
}

/**
 * What the bus's own map label says.
 *
 * The plate alone tells a rider nothing about *where* the dot is, and the tiles rarely name the
 * village it is passing. The operator's own NextLocation does, and it is present on every
 * tracked bus — including a plate typed straight into the box, which never loads a stop list
 * and so gets no stop pins. This is the one label that is always available.
 */
function busLabel(row) {
  // Standing at a stop is different information from heading to one, and it is the answer to
  // the question a waiting rider is actually asking.
  const here = stopAtNow();
  if (here) {
    const name = localName(clean(here.name), clean(here.nameGu));
    if (name) return `${plate} · ${t('atStop', { stop: shorten(name, 14) })}`;
  }
  const next = clean(row?.NextLocation);
  return next ? `${plate} → ${shorten(next, 16)}` : plate;
}

// `row` is passed in rather than read from `lastRow`: handleRow draws before it calls render,
// and render is what assigns lastRow — so reading it here would always label the bus with the
// previous poll's next stop, and leave the very first draw with no name at all.
function drawBus(pos, row) {
  if (!marker) {
    marker = L.marker([pos.lat, pos.lng], { icon: busIcon(), zIndexOffset: 500 }).addTo(map);
    tooltip(marker, busLabel(row));
    map.setView([pos.lat, pos.lng], 14);
  } else {
    marker.setTooltipContent(esc(busLabel(row)));
    glideTo(marker, L.latLng(pos.lat, pos.lng));
  }
  if (fixes.length > 1) {
    const line = fixes.map((f) => [f.lat, f.lng]);
    if (trailLine) trailLine.setLatLngs(line);
    else trailLine = L.polyline(line, { color: brandColour(), weight: 4, opacity: .45, lineJoin: 'round' }).addTo(map);
  }
  if (!map._stUserMoved) map.panTo([pos.lat, pos.lng], { animate: true, duration: .6 });
  // So the stand the bus is drawing level with names itself, which is the question a rider
  // standing at that stop is actually asking.
  markStandsNearBus(map, L.latLng(pos.lat, pos.lng));
  maybeDrawRoute();
}

/**
 * The map's two buttons, drawn for the state the map is actually in.
 *
 * "Recentre on the bus" was rendered once at start-up and never again, so it sat there before a
 * plate had been entered, and while a bus was parked or its trip had finished — every one of
 * those a guaranteed no-op, because `recentre()` returns immediately without a fix. A control
 * that cannot do anything should not be on screen; a rider pressing it twice and getting
 * nothing has no way to tell a dead button from a broken app.
 *
 * "Show me" stays: it works whether or not a bus is being tracked.
 */
function renderFabs() {
  const el = $('#map-fabs');
  if (!el) return;
  const hasFix = fixes.length > 0;
  el.innerHTML = `
    ${hasFix ? `<button class="iconbtn bordered" data-act="recentre" title="${esc(t('recenter'))}"
      aria-label="${esc(t('recenter'))}">${icon('crosshair')}</button>` : ''}
    <button class="iconbtn bordered" data-act="me" title="${esc(t('fromYou'))}"
      aria-label="${esc(t('fromYou'))}">${icon('navigation')}</button>`;
}

function recentre() {
  const last = fixes[fixes.length - 1];
  if (!last) return;
  map._stUserMoved = false;
  map.flyTo([last.lat, last.lng], Math.max(map.getZoom(), 15), { duration: .6 });
}

async function showMe() {
  try {
    myPos = { ...await locate(), at: Date.now() };
    store.location.set(myPos);
    drawMe();
    const last = fixes[fixes.length - 1];
    if (last) {
      fit(map, [[last.lat, last.lng], [myPos.lat, myPos.lng]]);
    } else {
      // With no bus to frame against, centre on the rider. Without this the button drew a
      // marker that was already on screen and moved nothing — pressing it did visibly nothing,
      // which is indistinguishable from a broken control.
      map._stUserMoved = true;   // they asked to look here; do not drag them back to the bus
      map.setView([myPos.lat, myPos.lng], Math.max(map.getZoom(), 14), { animate: true });
    }
    // Only refresh the bus card if there is a bus. Finding your own location says nothing
    // about a bus, and repainting from a null row is what produced the false error.
    if (plate) render(lastRow, fixes[fixes.length - 1] || null);
  } catch (e) {
    // Not all failures are a refusal. Telling someone their permission is denied when it is
    // granted and the phone's location is simply switched off sends them to the wrong setting.
    const denied = e?.message === 'denied' || e?.code === 1;
    toast(denied ? t('locDenied') : t('locOff'), 'alert');
  }
}

function drawMe() {
  if (!myPos || !map) return;
  if (!meMarker) meMarker = L.marker([myPos.lat, myPos.lng], { icon: meIcon(), zIndexOffset: 400 }).addTo(map);
  else meMarker.setLatLng([myPos.lat, myPos.lng]);
}

const MY_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Fills in "from you" without waiting to be asked.
 *
 * `myPos` used to be set only by the locate button, so the headline distance sat on "measuring"
 * indefinitely even when location permission had already been granted — the app had everything
 * it needed and was simply waiting for a tap that says nothing it did not already know.
 *
 * Two rules hold it in place. It never prompts: it acts only when permission is already
 * granted, or when a stored fix proves it was granted before, which is the only signal Safari
 * gives (it cannot report the state without asking). And it never moves the map — recentring
 * belongs to the locate button, and doing it on every poll would fight the follow on the bus.
 */
async function ensureMyLocation() {
  const cached = store.location.get();
  // Show the last known distance straight away rather than "measuring" while a fix arrives.
  if (!myPos && cached) { myPos = cached; drawMe(); }

  if (myPos?.at && Date.now() - myPos.at < MY_LOCATION_MAX_AGE_MS) return;

  const state = await permissions.locationState();
  if (state !== 'granted' && !cached) return;

  try {
    const pos = await locate({ prime: false, highAccuracy: false });
    myPos = { ...pos, at: Date.now() };
    store.location.set(myPos);
    drawMe();
    render(lastRow, fixes[fixes.length - 1] || null);
  } catch {
    // Permission revoked, or no fix available. The cached distance stays; the button still works.
  }
}

/* ------------------------------------------------------------------ render */
function renderIdle() {
  $('#track-status').innerHTML = emptyState({
    glyph: 'bus', title: t('trackEmptyT'), body: t('trackEmptyB'),
  });
}

function renderChips() {
  const saved = store.buses.list().slice(0, 4);
  const recent = store.recents.plates().filter((r) => !saved.some((s) => s.plate === r.plate)).slice(0, 5);
  const items = [
    ...saved.map((b) => ({ plate: b.plate, saved: true })),
    ...recent.map((r) => ({ plate: r.plate, saved: false })),
  ];
  // Recents get a dismiss here too. Home has had one since the list started filling itself in
  // without being asked, and the same row on this screen offering no way out was simply an
  // oversight. A saved bus keeps no dismiss — that one was deliberate, and the star removes it.
  $('#track-chips').innerHTML = items.map((i) => (i.saved
    ? `<button class="chip${i.plate === plate ? ' on' : ''}" data-plate="${esc(i.plate)}">${
      iconFilled('star', 'i i-sm')}<span class="num">${esc(i.plate)}</span></button>`
    : `<span class="chip removable${i.plate === plate ? ' on' : ''}">
         <button class="chip-main" data-plate="${esc(i.plate)}">${
  icon('clock', 'i i-sm')}<span class="num">${esc(i.plate)}</span></button>
         <button class="chip-x" data-forget-recent="${esc(i.plate)}"
           aria-label="${esc(t('removeRecent'))} ${esc(i.plate)}">${icon('x', 'i i-sm')}</button>
       </span>`)).join('');
}

/** The three headline numbers, chosen by what we can actually answer right now. */
function metrics(row) {
  const eta = currentEta();
  const delay = currentDelay();
  const move = insight.movementFrom(fixes);
  const speed = insight.speedFrom(fixes);
  const distToMe = myPos && fixes.length ? haversineKm(fixes[fixes.length - 1], myPos) : null;

  const out = [];

  if (eta) {
    out.push({
      k: eta.chosen ? t('toYourStop') : t('nextStop'),
      v: `${formatMinutes(eta.minutes)}${eta.confidence === 'fair' ? '<span class="unit"> ~</span>' : ''}`,
      sub: eta.stop?.name ? shorten(localName(clean(eta.stop.name), clean(eta.stop.nameGu)), 22) : '',
      tone: eta.minutes <= 10 ? 'live' : '',
    });
  } else if (clean(row?.NextLocation)) {
    out.push({ k: t('nextStop'), v: esc(shorten(clean(row.NextLocation))), small: true });
  } else {
    out.push({
      k: t('movement'),
      v: move.state === 'moving' ? t('moving')
        : move.state === 'stopped' ? t('stopped') : t('measuring'),
      muted: move.state === 'unknown',
    });
  }

  if (delay != null) {
    out.push({
      k: t('delayLabel'),
      v: Math.abs(delay) <= 3 ? t('onTime')
        : delay > 0 ? t('lateBy', { n: delay }) : t('earlyBy', { n: Math.abs(delay) }),
      tone: Math.abs(delay) <= 3 ? 'live' : delay > 10 ? 'warn' : '',
      small: true,
    });
  } else if (move.state === 'stopped' && move.stillForMs > 120000) {
    out.push({
      k: t('movement'),
      v: t('stoppedFor', { n: Math.round(move.stillForMs / 60000) }),
      small: true, tone: 'warn',
    });
  } else {
    out.push({
      k: t('speed'),
      v: speed.kmh != null && speed.kmh >= 8
        ? `${num(speed.kmh)}<span class="unit"> ${esc(t('kmh'))}</span>`
        : t('measuring'),
      muted: speed.kmh == null,
      small: speed.kmh == null,
    });
  }

  out.push({
    k: t('fromYou'),
    v: distToMe != null ? distance(distToMe) : t('measuring'),
    muted: distToMe == null,
    small: distToMe == null,
  });

  return out;
}

function render(row, pos) {
  lastRow = row;
  const el = $('#track-status');

  if (!row) {
    // "No data for this bus" needs a bus. With no plate entered there is nothing being asked
    // about, and reporting a failed lookup for a search nobody made is how pressing the locate
    // button produced an alarming error about a bus that was never requested.
    el.innerHTML = plate
      ? head('idle') + emptyState({
        glyph: 'alert', title: t('noDataToday'), body: t('noDataTodayB'),
      })
      : emptyState({ glyph: 'bus', title: t('trackEmptyT'), body: t('trackEmptyB') });
    renderChips();
    return;
  }

  const fresh = insight.freshness(fixes[fixes.length - 1]?.at);
  const saved = store.buses.has(plate);
  const alerted = !!alerts.get(plate);
  const eta = currentEta();

  const rows = [
    [t('status'), clean(row.Status)],
    [t('route'), clean(row.RouteName)],
    [t('nextStop'), clean(row.NextLocation)],
    [t('eta'), clean(row.ETA)],
    [t('lastStation'), clean(row.LastBusStation)],
    [t('departed'), clean(row.DepartureDateTime)],
  ].filter(([, v]) => v);

  el.innerHTML = head(fresh)
    + (fresh === 'none' ? `<div class="pad-3">${note('alert', t('gpsStaleT'), t('gpsStaleB'))}</div>` : '')
    + `<div class="metrics">${metrics(row).map((m) => `
        <div class="metric">
          <div class="m-v${m.small ? ' sm' : ''}${m.tone ? ` ${m.tone}` : ''}${m.muted ? ' muted' : ''}">${m.v}</div>
          <div class="m-k">${esc(m.k)}</div>
          ${m.sub ? `<div class="m-s">${esc(m.sub)}</div>` : ''}
        </div>`).join('')}</div>`
    + (eta ? `<div class="pad-3 pad-tight">${note('info', '', t('etaHint'))}</div>` : '')
    + (rows.length
      ? rows.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')
      : (fresh === 'none' ? '' : `<div class="pad-3 pad-tight">${note('info', '', t('positionOnly'))}</div>`))
    + `<div class="actions">
        ${trip ? `<button class="btn ghost" data-act="route">${icon('route', 'i i-sm')}${
          esc(stops.length && targetIndex < 0 ? t('setYourStop') : t('viewRoute'))}</button>` : ''}
        <button class="btn ghost${alerted ? ' on' : ''}" data-act="alert">${icon('bell', 'i i-sm')}${
          esc(alerted ? t('alertOn') : t('notifyMe'))}</button>
        <button class="btn ghost" data-act="save">${
          (saved ? iconFilled : icon)('star', 'i i-sm')}${esc(saved ? t('savedBus') : t('saveBus'))}</button>
        <button class="btn ghost" data-act="share">${icon('share', 'i i-sm')}${esc(t('shareLive'))}</button>
       </div>`
    + crowdBlock();
  renderChips();
}

/**
 * Crowd reports. The operator's feed cannot tell you the bus is full, and it cannot tell you
 * the bus never turned up — a dead GPS looks exactly like a bus that is merely late. Riders
 * standing at the stop know both.
 */
const SEATS_FREE_MAX = 40;
const STANDING_MAX = 30;

/** Says the number back in words a rider would use, including the two edges of the scale. */
/** Mirrors the server's own bucketing so the optimistic UI agrees with what gets stored. */
function levelForCount(count) {
  if (count <= -10) return 1;
  if (count < 0) return 2;
  if (count === 0) return 3;
  if (count < 15) return 4;
  return 5;
}

function headcountLabel(count) {
  if (count == null) return t('occDragToSay');
  if (count < 0) return t('occSeatsFree', { n: -count });
  if (count === 0) return t('occJustFull');
  return t('occStandingN', { n: count });
}

// Kinds pair with the shared scale in i18n.js by position, so a level added in the middle
// cannot end up meaning one thing here and another in the departure list.
const OCCUPANCY_KINDS = ['empty', 'seats', 'standing', 'crowded', 'full'];
const OCCUPANCY_STEPS = OCCUPANCY_KINDS.map((kind, i) =>
  [kind, OCCUPANCY_KEYS[i], `${OCCUPANCY_KEYS[i]}Hint`]);

const STATUS_STEPS = [
  // First because it is the most common complaint: the GPS on these vehicles drifts, and a dot
  // in the wrong village is what a rider notices before anything else.
  ['wrong_location', 'reportWrongLocation', 'crosshair'],
  ['cancelled', 'reportCancelled', 'alert'],
  ['replaced', 'reportReplaced', 'swap'],
  ['departed', 'reportDeparted', 'arrowRight'],
];

// `restored` is not offered up front. It only makes sense as a reply to a claim that is on
// screen, and a standing "the original is running" button next to "a different bus came" would
// read as two ways to say the same thing.



const peopleSaying = (n) => (n === 1 ? t('reportedBy', { n }) : t('reportedByPlural', { n }));

/**
 * Repaints the gauge to a dragged value without re-rendering the card.
 *
 * Re-rendering mid-drag would replace the very input the finger is holding, and the browser
 * would drop the gesture — so this touches only the class list, the caption, and one variable.
 */
function paintOccupancy(count) {
  const occ = $('#occ');
  if (!occ) return;
  occ.classList.remove('unset');
  occ.classList.toggle('standing', count > 0);

  // The fill grows out from the centre in whichever direction is being reported, so the zero
  // mark stays where it is and the bar reads as "how far past full" rather than as a total.
  const fill = $('#occ-fill');
  if (fill) {
    const span = count < 0 ? SEATS_FREE_MAX : STANDING_MAX;
    const centre = (SEATS_FREE_MAX / (SEATS_FREE_MAX + STANDING_MAX)) * 100;
    const width = (Math.abs(count) / span) * (count < 0 ? centre : 100 - centre);
    fill.style.left = `${count < 0 ? centre - width : centre}%`;
    fill.style.width = `${width}%`;
  }

  const value = $('#occ-value');
  if (value) value.textContent = headcountLabel(count);
  occ.querySelector('[data-occ-range]')?.setAttribute('aria-valuetext', headcountLabel(count));
}

function crowdBlock() {
  const samples = crowd?.occupancy?.samples || 0;
  const reported = crowd?.occupancy?.headcount;
  const value = Number.isInteger(reported) ? reported : 0;

  const byKind = Object.fromEntries((crowd?.status || []).map((r) => [r.kind, r.n]));
  const replacement = crowd?.replacement;

  // The replacement is the only report that sends a rider somewhere else, so it is built as a
  // handover rather than a sentence: the plate is the thing they need, on its own line, with a
  // real button under it.
  const notices = [
    replacement ? `<div class="note warn crowd-note">
        ${icon('swap', 'i i-sm')}
        <div class="cn-body">
          <span class="cn-lead">${esc(t('replacedByLead'))}${
  crowd?.disputed ? ` · ${esc(t('disputedNote'))}` : ''}</span>
          <span class="cn-plate num">${esc(replacement.plate)}</span>
          <button class="btn sm" data-track-plate="${esc(replacement.plate)}">${
  esc(t('replacedTrack'))}${icon('right', 'i i-sm')}</button>
          <button class="cn-clear" data-report="restored">${esc(t('replacedClear'))}</button>
        </div>
      </div>` : '',
    byKind.wrong_location ? `<div class="note warn crowd-note">${icon('crosshair', 'i i-sm')}
        <div class="cn-body"><span>${esc(t('wrongLocationSaid'))}</span>
        <span class="cn-count">${esc(peopleSaying(byKind.wrong_location))}</span></div></div>` : '',
    byKind.cancelled ? `<div class="note warn crowd-note">${icon('alert', 'i i-sm')}
        <div class="cn-body"><span>${esc(t('cancelledSaid'))}</span>
        <span class="cn-count">${esc(peopleSaying(byKind.cancelled))}</span></div></div>` : '',
    byKind.departed ? `<div class="note crowd-note">${icon('arrowRight', 'i i-sm')}
        <div class="cn-body"><span>${esc(t('departedSaid'))}</span>
        <span class="cn-count">${esc(peopleSaying(byKind.departed))}</span></div></div>` : '',
  ].join('');

  const secondsLeft = Math.ceil((undoUntil - Date.now()) / 1000);
  const undo = secondsLeft > 0
    ? `<button class="undo-report" id="undo-report" data-undo>${
      esc(t('undoWindow', { s: secondsLeft }))}</button>`
    : '';

  // Shown on the stand-in bus. Someone handed this plate arrives knowing only a number; without
  // this they see an ordinary bus on an unexpected route with no way to tell it is the right one.
  const standIn = crowd?.standingInFor
    ? `<div class="note crowd-note stand-in">${icon('swap', 'i i-sm')}
        <div class="cn-body">
          <span class="cn-lead">${esc(t('standingInForBody'))}</span>
          <span class="cn-plate num">${esc(t('standingInFor', { plate: crowd.standingInFor.original }))}</span>
          <button class="btn sm ghost" data-track-plate="${esc(crowd.standingInFor.original)}">${
  esc(t('seeOriginal'))}${icon('right', 'i i-sm')}</button>
        </div>
      </div>`
    : '';

  const scale = occupancyOpen ? openScale(value, reported, samples) : closedScale(value, reported, samples);

  return `<div class="crowd">
    ${standIn}
    <div class="crowd-head">${esc(t('occupancyQ'))}</div>
    ${scale}
    ${undo}
    ${notices}
    <div class="crowd-head sub">${esc(t('statusQ'))}</div>
    <div class="chips no-bleed">
      ${STATUS_STEPS.map(([kind, label, glyph]) =>
    `<button class="chip" data-report="${kind}">${icon(glyph, 'i i-sm')}${esc(t(label))}</button>`).join('')}
    </div>
  </div>`;
}

/**
 * The resting state: what riders have said, and a button to say something yourself.
 *
 * The slider used to sit here permanently and was being dragged by accident while scrolling
 * the card — 32 undos against 156 reports in one day, a fifth of them taken straight back. A
 * report should be a decision, not a side effect of scrolling past one.
 */
function closedScale(value, reported, samples) {
  const known = reported != null;
  // What this service is usually like at this hour, which is the more useful number when
  // nobody has reported *this* bus yet — and the one that lets someone pick a later service.
  const usually = crowd?.usually;
  const typical = usually
    ? `<span class="occ-usually">${icon('clock', 'i i-sm')}${esc(t('usuallyAt', {
      what: headcountLabel(usually.headcount), n: usually.samples,
    }))}</span>`
    : '';
  return `<div class="occ-closed">
    ${typical}
    <span class="occ-summary">
      ${known
    ? `<span class="occ-value${value > 0 ? ' standing' : ''}">${esc(headcountLabel(value))}</span>
         ${samples ? `<span class="occ-count">${esc(t('occFrom', { n: samples }))}</span>` : ''}`
    : `<span class="occ-ask">${esc(t('occTapToSay'))}</span>`}
    </span>
    <button class="btn ghost sm" data-occ-open>${icon('users', 'i i-sm')}${esc(t('occOpen'))}</button>
  </div>`;
}

/**
 * One signed slider: seats going spare to the left, people standing to the right, and "every
 * seat taken, nobody up yet" in the middle. One axis because it is one quantity — a bus does
 * not have spare seats and standing passengers at once — so it can be dragged across the whole
 * range without first deciding which of two questions is being answered.
 */
function openScale(value, reported, samples) {
  if (reported != null) requestAnimationFrame(() => paintOccupancy(value));
  return `
    <div class="occ${value > 0 ? ' standing' : ''}${reported == null ? ' unset' : ''}" id="occ">
      <div class="occ-read">
        <span class="occ-value" id="occ-value">${esc(headcountLabel(reported == null ? null : value))}</span>
        ${samples ? `<span class="occ-count">${esc(t('occFrom', { n: samples }))}</span>` : ''}
      </div>
      <div class="occ-bar">
        <div class="occ-track" aria-hidden="true">
          <span class="occ-half left"></span>
          <span class="occ-half right"></span>
          <span class="occ-fill" id="occ-fill"></span>
          <span class="occ-zero"></span>
        </div>
        <input class="occ-range" type="range"
          min="${-SEATS_FREE_MAX}" max="${STANDING_MAX}" step="1" value="${value}"
          aria-label="${esc(t('occupancyQ'))}" aria-valuetext="${esc(headcountLabel(value))}"
          data-occ-range>
      </div>
      <div class="occ-ends" aria-hidden="true">
        <span>${esc(t('occSeatsSide'))}</span>
        <span class="occ-mid">${esc(t('occJustFullShort'))}</span>
        <span>${esc(t('occStandingSide'))}</span>
      </div>
      <button class="occ-cancel" data-occ-close>${esc(t('occCancel'))}</button>
    </div>`;
}

/**
 * Asks which bus actually turned up.
 *
 * A replacement is the one report that is useless without a second piece of information — "a
 * different bus came" tells the next rider nothing they can act on, while a plate sends them
 * to the bus that is actually running.
 */
function askReplacement() {
  const body = document.createElement('div');
  body.className = 'flow sheet-pad';
  body.innerHTML = `
    <p>${esc(t('replacedBody'))}</p>
    <div class="field">
      <div class="row tight">
        <input id="repl-plate" class="input plate" type="text" autocomplete="off"
          inputmode="latin" placeholder="E.G. GJ-18-ZT-1028" aria-label="${esc(t('replacedTitle'))}">
      </div>
      <div id="repl-ac" class="ac" role="listbox" aria-expanded="false"></div>
    </div>
    <button class="btn block" data-repl-save>${icon('check', 'i i-sm')}${esc(t('replacedSave'))}</button>`;

  openSheet({ title: t('replacedTitle'), body, compact: true });
  const input = $('#repl-plate');
  autocomplete(input, $('#repl-ac'), {
    fetcher: (q) => api.plates(q),
    render: (r) => `<span class="num">${esc(r.plate)}</span>`,
    onPick: (r) => { input.value = r.plate; },
  });
  setTimeout(() => input.focus(), 120);

  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-repl-save]')) return;
    const replacement = normalise(input.value);
    if (!replacement) return;
    if (replacement === plate) return toast(t('errSamePlate'), 'alert');
    closeSheet();
    sendReport('replaced', { replacement });
  });
}

async function sendReport(kind, extra = {}) {
  if (kind === 'replaced' && !extra.replacement) return askReplacement();
  const headcountGiven = extra.headcount !== undefined;
  // The slider reports a number; the server still wants a kind it recognises, and derives the
  // authoritative rung from the count itself so the two can never drift apart.
  if (kind === 'headcount') kind = OCCUPANCY_STEPS[levelForCount(extra.headcount) - 1][0];
  try {
    const result = await api.report({
      plate, kind, route: clean(lastRow?.RouteName), reporter: store.reporterId(), ...extra,
    });
    crowd = result;
    if (result.counted) offerUndo(result.undoMs);
    occupancyOpen = false;
    stats.track(headcountGiven ? 'act:report-occupancy' : 'act:report-status');
    toast(result.counted ? t('reportThanks') : t('reportAlready'), result.counted ? 'check' : 'info');
    render(lastRow, fixes[fixes.length - 1] || null);
  } catch {
    toast(t('errNetwork'), 'wifiOff');
  }
}

/**
 * Keeps the undo offer on screen while it is still real.
 *
 * The countdown is shown rather than left implicit: an Undo that vanishes on its own schedule
 * reads as a glitch, while one that visibly runs out reads as a rule. It ticks once a second
 * and touches only its own element, so it never re-renders the card underneath it.
 */
function offerUndo(windowMs = 30000) {
  clearUndo();
  undoUntil = Date.now() + windowMs;
  undoTimer = setInterval(() => {
    const left = Math.ceil((undoUntil - Date.now()) / 1000);
    const el = $('#undo-report');
    if (left > 0 && el) {
      el.textContent = t('undoWindow', { s: left });
      return;
    }
    clearUndo();
    render(lastRow, fixes[fixes.length - 1] || null);
  }, 1000);
}

function clearUndo() {
  clearInterval(undoTimer);
  undoTimer = null;
  undoUntil = 0;
}

async function undoReport() {
  clearUndo();
  stats.track('act:report-undo');
  try {
    const result = await api.reportUndo({ plate, reporter: store.reporterId() });
    crowd = result;
    toast(result.undone ? t('undoDone') : t('reportAlready'), 'info');
  } catch {
    toast(t('errNetwork'), 'wifiOff');
  }
  render(lastRow, fixes[fixes.length - 1] || null);
}

function head(state) {
  const last = fixes[fixes.length - 1];
  const badges = {
    live: ['live', `<span class="dot"></span>${esc(t('live'))}`],
    stale: ['warn', esc(t('noFix'))],
    dead: ['warn', esc(t('noFix'))],
    none: ['warn', esc(t('noFix'))],
    offline: ['warn', esc(t('offlineData'))],
    idle: ['', esc(t('checking'))],
  };
  const [cls, label] = badges[state] || badges.idle;
  return `<div class="status-head">
      <div class="grow" style="min-width:0">
        <div class="plate num">${esc(plate)}</div>
        <div class="when">${last ? `${esc(t('updated'))} ${esc(since(last.at))}` : '&nbsp;'}</div>
      </div>
      <span class="badge ${cls}">${label}</span>
    </div>`;
}

function note(glyph, title, body) {
  return `<div class="note">${icon(glyph, 'i i-sm')}<div>${
    title ? `<strong>${esc(title)}</strong><br>` : ''}${esc(body)}</div></div>`;
}

function renderOfflineOrError(err) {
  const cached = store.lastSeen.get(plate);
  if (cached?.row) {
    lastRow = cached.row;
    $('#track-status').innerHTML = head('offline')
      + `<div class="pad-3">${note('wifiOff', t('offline'), `${t('updated')} ${since(cached.at)}`)}</div>`
      + [[t('route'), clean(cached.row.RouteName)], [t('nextStop'), clean(cached.row.NextLocation)]]
        .filter(([, v]) => v)
        .map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
    return;
  }
  $('#track-status').innerHTML = errorState(err, 'retry');
}

/* ------------------------------------------------------------------ actions */
function onStatusClick(e) {
  if (e.target.closest('[data-undo]')) return undoReport();

  if (e.target.closest('[data-occ-open]')) {
    occupancyOpen = true;
    stats.track('act:report-open');
    return render(lastRow, fixes[fixes.length - 1] || null);
  }
  if (e.target.closest('[data-occ-close]')) {
    occupancyOpen = false;
    return render(lastRow, fixes[fixes.length - 1] || null);
  }

  const reportBtn = e.target.closest('[data-report]');
  if (reportBtn) return sendReport(reportBtn.dataset.report);

  // A reported replacement is only useful if the rider can follow it in one tap.
  const followBtn = e.target.closest('[data-track-plate]');
  if (followBtn) return start(followBtn.dataset.trackPlate);

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'retry': poll(); break;
    case 'recentre': recentre(); break;
    case 'me': showMe(); break;
    case 'save': {
      const added = store.buses.toggle({ plate });
      toast(added ? t('savedBus') : t('remove'), added ? 'star' : 'trash');
      render(lastRow, fixes[fixes.length - 1] || null);
      break;
    }
    case 'share': share(); break;
    case 'alert': alerts.get(plate) ? clearAlert() : openAlertSheet(); break;
    case 'route': stats.track('act:route-view'); emit('open-trip', { plate, trip }); break;
    default: break;
  }
}

async function share() {
  const url = `${location.origin}${location.pathname}?plate=${encodeURIComponent(plate)}`;
  const data = { title: `${t('appName')} · ${plate}`, text: `${plate} — ${t('tagline')}`, url };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(url); toast(t('copyLink'), 'copy'); }
  } catch { /* user dismissed the share sheet */ }
}

function clearAlert() {
  alerts.clear(plate);
  push.cancel(plate).catch(() => {});
  toast(t('alertCleared'), 'bellOff');
  render(lastRow, fixes[fixes.length - 1] || null);
}

async function openAlertSheet() {
  const perm = await alerts.requestPermission();
  const body = document.createElement('div');
  body.className = 'pad-3 flow';
  const radii = [1, 2, 5];
  body.innerHTML = `
    <div class="note">${icon('info', 'i i-sm')}<div>${esc(t('alertsWhileOpen'))}</div></div>
    ${perm === 'denied' ? `<div class="note warn">${
      icon('bellOff', 'i i-sm')}<div>${esc(t('alertNeedsPermission'))}</div></div>` : ''}
    ${trip ? `<div class="note">${
      icon('signpost', 'i i-sm')}<div>${esc(t('pickStopFirst'))}</div></div>` : ''}
    <div class="sec-title">${esc(t('notifyMe'))}</div>
    <div class="chips no-bleed" role="group">
      ${radii.map((r, i) => `<button class="chip${i === 1 ? ' on' : ''}" data-r="${r}">${esc(distance(r))}</button>`).join('')}
    </div>
    <button class="btn block" data-go="me">
      ${icon('navigation', 'i i-sm')}${esc(t('useLocation'))}</button>`;

  let radius = 2;
  body.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-r]');
    if (chip) {
      radius = +chip.dataset.r;
      body.querySelectorAll('[data-r]').forEach((c) => c.classList.toggle('on', c === chip));
      return;
    }
    if (e.target.closest('[data-go="me"]')) {
      try {
        myPos = await locate();
        await armAlert({ lat: myPos.lat, lng: myPos.lng, label: t('fromYou'), radiusKm: radius });
        closeSheet();
        render(lastRow, fixes[fixes.length - 1] || null);
      } catch { toast(t('locDenied'), 'alert'); }
    }
  });

  openSheet({ title: t('notifyMe'), subtitle: plate, body });
}

/**
 * The trip sheet calls this when the rider picks the stop they are waiting at. That one tap
 * both registers the alert and re-points every ETA on this screen at their stop.
 */
export function setStopAlert({ lat, lng, label, radiusKm = 1, index = -1 }) {
  stats.track('act:set-stop');
  if (index >= 0) targetIndex = index;
  armAlert({ lat, lng, label, radiusKm });
}

/**
 * Sets an arrival alert, preferring one that survives the app being closed.
 *
 * A push subscription is the real thing: the server checks it against positions it is already
 * polling, so it fires with the phone in a pocket. The in-page watcher is kept as the fallback
 * for browsers without push, a denied permission, or iOS before the app is installed — and the
 * rider is told plainly which of the two they got, because the difference matters.
 */
async function armAlert({ lat, lng, label, radiusKm = 1 }) {
  let outcome = 'unsupported';
  try {
    outcome = await push.subscribe({ plate, label, lat, lng, radiusKm });
  } catch {
    outcome = 'unsupported';
  }
  // Always keep the local watcher too: it costs nothing and covers the window where the app
  // is open but the push service is slow.
  alerts.set({ plate, kind: 'stop', lat, lng, label, radiusKm });
  stats.track('act:alert-on');

  toast(outcome === 'push' ? t('alertSetFor', { stop: label }) : push.explain(outcome),
    outcome === 'push' ? 'bell' : 'info');
  render(lastRow, fixes[fixes.length - 1] || null);
}

export function currentPlate() { return plate; }
export function currentTrip() { return trip; }
export function targetStopIndex() { return targetIndex; }

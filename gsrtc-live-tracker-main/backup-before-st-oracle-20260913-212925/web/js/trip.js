/* The whole-route view: every stop on the trip, which ones the bus has already passed,
   and where it is right now. Tap a stop to be alerted when the bus gets close to it.
   The operator only publishes this while a trip is actually running. */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, localName } from './i18n.js';
import { $, esc, clean, distance, toast, openSheet, emptyState, errorState, skeletons } from './ui.js';
import { createMap, destroyMap, busIcon, stopIcon, tooltip, fit, brandColour, mutedColour, showBusStands, setRouteStops} from './map.js';

let sheetMap = null;
let refreshTimer = null;
let ctx = null;
let reputation = {};   // stop name -> observed typical arrival
let roadLine = null;   // real road geometry, when the router could supply it

export async function open({ plate, trip, myStopIndex = -1 }, onSetAlert) {
  ctx = { plate, trip, onSetAlert, myStopIndex };
  const body = openSheet({
    title: t('tripRoute'),
    subtitle: [plate, trip?.route].filter(Boolean).join(' · '),
    body: `<div class="pad-3 flow">${skeletons(3)}</div>`,
    onClose: teardown,
  });
  body.addEventListener('click', onClick);
  await load();
}

function teardown() {
  reputation = {};
  roadLine = null;
  clearTimeout(refreshTimer);
  refreshTimer = null;
  destroyMap(sheetMap);
  sheetMap = null;
  ctx = null;
}

async function load() {
  if (!ctx) return;
  const { trip } = ctx;
  const body = $('#sheet-body');
  if (!trip?.tripId) {
    body.innerHTML = `<div class="pad-3">${emptyState({
      glyph: 'route', title: t('tripNotLive'), body: t('tripNotLiveB') })}</div>`;
    return;
  }
  try {
    // Fetch what we have learned about this route alongside the live trip; it is cheap, local,
    // and simply absent on a route nobody has tracked yet.
    if (trip.route && !Object.keys(reputation).length) {
      api.routeReputation(trip.route, trip.start)
        .then((r) => { reputation = r?.stops || {}; })
        .catch(() => { reputation = {}; });
    }
    const stops = await api.trip({ tripId: trip.tripId, status: trip.status ?? 1, start: trip.start, plate: ctx.plate, route: trip.route });
    if (!ctx) return;
    if (!stops.length) {
      body.innerHTML = `<div class="pad-3">${emptyState({
        glyph: 'route', title: t('tripNotLive'), body: t('tripNotLiveB') })}</div>`;
      return;
    }
    render(stops);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 30000);

    // Road geometry arrives after the first paint: the map is useful immediately with straight
    // lines, and simply gets more accurate a moment later.
    if (!roadLine) {
      api.geometry({ tripId: trip.tripId, status: trip.status ?? 1, start: trip.start })
        .then((line) => {
          if (!ctx || !line) return;
          roadLine = line;
          render(stops);
        })
        .catch(() => { /* straight lines remain perfectly usable */ });
    }
  } catch (e) {
    if (!ctx) return;
    body.innerHTML = `<div class="pad-3">${
      e.status === 502 || e.kind === 'upstream'
        ? emptyState({ glyph: 'route', title: t('tripNotLive'), body: t('tripNotLiveB') })
        : errorState(e, 'reload')}</div>`;
  }
}

function render(stops) {
  const head = stops[0] || {};
  const lastCovered = clean(head.LastLocationCovered);
  const coveredIndex = lastCovered
    ? stops.findIndex((s) => clean(s.LocationName).toLowerCase() === lastCovered.toLowerCase())
    : -1;

  const bus = {
    lat: parseFloat(head.CurrentLat),
    lng: parseFloat(head.CurrentLong),
  };
  const hasBus = isFinite(bus.lat) && isFinite(bus.lng) && !(bus.lat === 0 && bus.lng === 0);
  const travelled = parseFloat(head.KMTravelled);

  const metrics = [
    { k: t('kmTravelled'), v: isFinite(travelled) ? distance(travelled) : '—' },
    { k: t('stopsLabel'), v: t('stopsCovered', { a: Math.max(0, coveredIndex + 1), b: stops.length }) },
    { k: t('currentArea'), v: clean(head.CurrentLocationName) || '—' },
  ];

  $('#sheet-body').innerHTML = `
    <div id="trip-map" class="map map-flush"></div>
    <div class="metrics">${metrics.map((m) =>
      `<div class="metric"><div class="m-v" style="font-size:1em">${esc(m.v)}</div>
       <div class="m-k">${esc(m.k)}</div></div>`).join('')}</div>
    <div class="sec-title trip-title">${esc(t('alertPickStop'))}</div>
    <div class="note trip-note">${icon('bell', 'i i-sm')}<div>${esc(t('alertPickStopB'))}</div></div>
    <div class="timeline">${stops.map((s, i) => stopHtml(s, i, coveredIndex)).join('')}</div>
    <div class="trip-tail"></div>`;

  drawMap(stops, hasBus ? bus : null, coveredIndex);
}

function stopHtml(s, i, coveredIndex) {
  const done = i <= coveredIndex;
  const here = i === coveredIndex + 1;
  const mine = i === ctx?.myStopIndex;
  const time = clean(s.ETA) || clean(s.ArrivedTime);
  const km = parseFloat(s.Distance);
  const name = localName(clean(s.LocationName), clean(s.LocationNameGuj));
  return `<div class="stop${done ? ' done' : ''}${here ? ' here' : ''}${mine ? ' mine' : ''}"
      data-lat="${esc(s.LocationLat)}" data-lng="${esc(s.LocationLong)}"
      data-index="${i}" data-name="${esc(name)}" role="button" tabindex="0"
      aria-label="${esc(`${name} — ${t('setYourStop')}`)}">
    <div class="rail"><div class="node"></div></div>
    <div class="info">
      <div class="nm">${esc(name)}
        ${mine ? `<span class="mine-tag">${icon('bell', 'i i-sm')}${esc(t('yourStop'))}</span>` : ''}
        ${isFinite(km) && km > 0 ? `<span class="gu num">${esc(distance(km))}</span>` : ''}</div>
      <div class="tm num">${esc((time || '').trim())}${typicalFor(clean(s.LocationName))}</div>
    </div>
  </div>`;
}

/** "usually 4:52 PM" — from arrivals we have actually observed, never from the timetable. */
function typicalFor(stopName) {
  const rep = reputation[stopName];
  if (!rep || rep.samples < 5) return '';
  const hour24 = Math.floor(rep.typicalArrivalMin / 60) % 24;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const clock = `${hour12}:${String(rep.typicalArrivalMin % 60).padStart(2, '0')} ${suffix}`;
  return `<span class="tm-typical">${esc(t('typicallyAt', { time: clock }))}</span>`;
}

function drawMap(stops, bus, coveredIndex) {
  destroyMap(sheetMap);
  sheetMap = createMap('trip-map', { zoom: 8 });
  showBusStands(sheetMap);
  const pts = [];
  stops.forEach((s, i) => {
    const lat = parseFloat(s.LocationLat), lng = parseFloat(s.LocationLong);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
    pts.push([lat, lng]);
    L.marker([lat, lng], { icon: stopIcon(i <= coveredIndex) })
      .bindTooltip(esc(localName(clean(s.LocationName), clean(s.LocationNameGuj))), { direction: 'top' })
      .addTo(sheetMap);
  });
  // Same as the track map: this sheet already draws every stop on the route, so the generic
  // stand layer must not draw them again underneath.
  setRouteStops(sheetMap, pts.map((p) => L.latLng(p[0], p[1])));

  if (roadLine && roadLine.length > 1) {
    // The real road. Split it at the point nearest the last covered stop so the travelled
    // portion still reads as done.
    const splitAt = pts[coveredIndex] ? nearestIndex(roadLine, pts[coveredIndex]) : 0;
    if (splitAt > 0) {
      L.polyline(roadLine.slice(0, splitAt + 1),
        { color: mutedColour(), weight: 5, opacity: .55 }).addTo(sheetMap);
    }
    L.polyline(roadLine.slice(splitAt),
      { color: brandColour(), weight: 5, opacity: .9, lineJoin: 'round' }).addTo(sheetMap);
  } else if (pts.length > 1) {
    L.polyline(pts.slice(0, Math.max(1, coveredIndex + 1)),
      { color: mutedColour(), weight: 4, opacity: .6 }).addTo(sheetMap);
    L.polyline(pts.slice(Math.max(0, coveredIndex)),
      { color: brandColour(), weight: 4, opacity: .9 }).addTo(sheetMap);
  }
  if (bus) {
    tooltip(L.marker([bus.lat, bus.lng], { icon: busIcon(), zIndexOffset: 600 }).addTo(sheetMap), ctx.plate);
    pts.push([bus.lat, bus.lng]);
  }
  setTimeout(() => { sheetMap?.invalidateSize(); fit(sheetMap, pts, 30); }, 80);
}

/** Index of the point on a line closest to a target — used to split travelled from remaining. */
function nearestIndex(line, [lat, lng]) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < line.length; i += 1) {
    const d = (line[i][0] - lat) ** 2 + (line[i][1] - lng) ** 2;
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}

function onClick(e) {
  if (e.target.closest('[data-act="reload"]')) return load();
  const stop = e.target.closest('.stop');
  if (!stop || !ctx) return;
  const lat = parseFloat(stop.dataset.lat), lng = parseFloat(stop.dataset.lng);
  if (!isFinite(lat) || !isFinite(lng)) return;
  const index = Number(stop.dataset.index);
  ctx.myStopIndex = index;
  ctx.onSetAlert?.({ lat, lng, label: stop.dataset.name, radiusKm: 1, index });
  toast(t('alertSetFor', { stop: stop.dataset.name }), 'bell');
  // Repaint so the chosen stop is marked without waiting for the next refresh.
  $('#sheet-body').querySelectorAll('.stop').forEach((el, i) => el.classList.toggle('mine', i === index));
}

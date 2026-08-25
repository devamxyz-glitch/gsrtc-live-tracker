/* Every bus running between the two chosen stations, on one map.
 *
 * The server tracks these plates continuously, so each refresh returns positions it already
 * holds — which is what makes the markers glide between updates instead of teleporting, and
 * why a speed is attached to a bus the moment it appears.
 */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, localName } from './i18n.js';
import { emit } from './events.js';
import { $, esc, clean, num, since, emptyState, errorState, skeletons } from './ui.js';
import { createMap, destroyMap, busIcon, glideTo, busPopup, fit, showBusStands} from './map.js';

const REFRESH_MS = 15000;

let map = null;
let markers = new Map();     // plate -> L.Marker
let timer = null;
let query = null;
let buses = [];
let live = false;

export function isOpen() { return live; }

/** Opens the map for a from/to/date query, or refreshes it if already open. */
export function open(nextQuery) {
  query = nextQuery;
  live = true;
  $('#routes-results').innerHTML = `
    <div class="sec-title" id="routes-map-title">${esc(t('viewMap'))}</div>
    <div id="routes-map" class="map tall"></div>
    <div class="note">${icon('info', 'i i-sm')}<div>${esc(t('tapBusToTrack'))}</div></div>
    <div id="routes-map-list" class="flow">${skeletons(3)}</div>`;
  destroyMap(map);
  map = createMap('routes-map', { zoom: 7 });
  showBusStands(map);
  markers = new Map();
  refresh(true);
  schedule();
}

export function close() {
  live = false;
  clearTimeout(timer);
  timer = null;
  destroyMap(map);
  map = null;
  markers = new Map();
}

export function onHide() {
  clearTimeout(timer);
  timer = null;
}

export function onShow() {
  if (!live) return;
  setTimeout(() => map?.invalidateSize(), 60);
  refresh(false);
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!live) return;
  timer = setTimeout(() => { if (!document.hidden) refresh(false); schedule(); }, REFRESH_MS);
}

async function refresh(firstRun) {
  if (!query || !live) return;
  try {
    const result = await api.live(query);
    if (!live) return;
    buses = result.buses;
    draw(firstRun);
    renderList(result);
  } catch (e) {
    if (!live) return;
    if (firstRun) $('#routes-map-list').innerHTML = errorState(e, 'map-retry');
  }
}

function draw(fit_) {
  if (!map) return;
  const seen = new Set();

  for (const bus of buses) {
    seen.add(bus.plate);
    const position = L.latLng(bus.lat, bus.lng);
    let marker = markers.get(bus.plate);
    if (marker) {
      glideTo(marker, position);
      marker.setPopupContent(popupHtml(bus));
    } else {
      // Permanent labels would pile on top of each other the moment two buses are close,
      // so the plate lives in a popup the rider opens by tapping the bus they care about.
      marker = L.marker(position, { icon: busIcon(), zIndexOffset: 400 }).addTo(map);
      busPopup(marker, popupHtml(bus));
      markers.set(bus.plate, marker);
    }
  }

  // A bus that stopped reporting should leave the map rather than sit there frozen.
  for (const [plate, marker] of markers) {
    if (!seen.has(plate)) { marker.remove(); markers.delete(plate); }
  }

  if (fit_ && buses.length) {
    setTimeout(() => {
      map?.invalidateSize();
      fit(map, buses.map((b) => [b.lat, b.lng]), 40);
    }, 80);
  }
}

function popupHtml(bus) {
  const facts = [
    clean(bus.serviceType),
    bus.speedKmh != null && bus.speedKmh >= 8 ? `${num(bus.speedKmh)} ${t('kmh')}`
      : bus.movement === 'stopped' ? t('stopped') : '',
  ].filter(Boolean).join(' · ');
  return `<div class="bus-pop">
    <div class="bp-plate num">${esc(bus.plate)}</div>
    ${facts ? `<div class="bp-meta">${esc(facts)}</div>` : ''}
    ${clean(bus.nextStop) ? `<div class="bp-meta">${esc(t('nextStop'))}: ${esc(clean(bus.nextStop))}</div>` : ''}
    <button class="btn sm block bp-btn" data-track-plate="${esc(bus.plate)}">
      ${icon('pin', 'i i-sm')}${esc(t('track'))}</button>
  </div>`;
}

function renderList(result) {
  const container = $('#routes-map-list');
  const title = $('#routes-map-title');
  if (title) title.textContent = t('busesOnMap', { n: buses.length });

  if (!buses.length) {
    container.innerHTML = emptyState({
      glyph: 'bus',
      title: result.running ? t('noRunningNow') : t('noBuses'),
      body: t('noRunningNowB'),
    });
    return;
  }

  container.innerHTML = buses.map((bus, i) => `
    <button class="tile" data-map-i="${i}">
      <span class="glyph live">${icon('bus', 'i i-sm')}</span>
      <span class="body">
        <span class="t1 num">${esc(bus.plate)}</span>
        <span class="meta">${esc([
          clean(bus.serviceType),
          bus.speedKmh != null && bus.speedKmh >= 8 ? `${num(bus.speedKmh)} ${t('kmh')}`
            : bus.movement === 'stopped' ? t('stopped') : '',
          clean(bus.nextStop) ? `${t('nextStop')}: ${clean(bus.nextStop)}` : '',
        ].filter(Boolean).join(' · '))}</span>
        <span class="t2">${esc(localName(clean(bus.route), clean(bus.routeGu)))}</span>
      </span>
      <span class="end">
        <span>
          <span class="big num">${esc(clean(bus.arrivalTime) || '—')}</span>
          <span class="small num">${esc(since(bus.updatedAt))}</span>
        </span>
        ${icon('right', 'i i-sm')}
      </span>
    </button>`).join('');
}

/** Both the marker and the list row lead to the same place: tracking that bus. */
function track(bus) {
  emit('track', bus.plate, {
    trip: {
      tripId: clean(bus.tripId),
      status: 1,
      start: clean(bus.startTime),
      route: localName(clean(bus.route), clean(bus.routeGu)),
    },
  });
}

/** Called by the Routes screen's click handler for rows rendered here. */
export function handleClick(e) {
  if (e.target.closest('[data-act="map-retry"]')) { refresh(true); return true; }
  const fromPopup = e.target.closest('[data-track-plate]');
  if (fromPopup) {
    const bus = buses.find((b) => b.plate === fromPopup.dataset.trackPlate);
    if (bus) track(bus);
    return true;
  }
  const row = e.target.closest('[data-map-i]');
  if (!row) return false;
  const bus = buses[+row.dataset.mapI];
  if (bus) track(bus);
  return true;
}

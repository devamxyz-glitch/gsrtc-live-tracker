/* Nearby screen: which ST stations are around you, how far, and one tap to see what
   leaves from there. */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, localName } from './i18n.js';
import { emit } from './events.js';
import { location } from './store.js';
import {
  $, esc, clean, distance, locate, toast, emptyState, errorState, skeletons, autocomplete,
} from './ui.js';
import { createMap, destroyMap, meIcon, stopIcon, fit } from './map.js';

let map = null;
let stations = [];
let me = null;

export function init() {
  $('#nearby-body').addEventListener('click', onClick);
  $('#nearby-body').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tile[role="button"]')) {
      e.preventDefault();
      e.target.click();
    }
  });
  $('#locate').addEventListener('click', run);
  renderIdle();
}

export function onShow() {
  setTimeout(() => map?.invalidateSize(), 60);
  if (!stations.length && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((p) => { if (p.state === 'granted') run(); })
      .catch(() => {});
  }
}

function renderIdle() {
  $('#nearby-title').textContent = t('nearbyT');
  $('#nearby-body').innerHTML = emptyState({
    glyph: 'compass', title: t('nearbyT'), body: t('nearbyEmptyB'),
  }) + searchFallback();
  wireSearch();
}

async function run() {
  const body = $('#nearby-body');
  body.innerHTML = `<div class="note">${icon('crosshair', 'i i-sm')}<div>${esc(t('locating'))}</div></div>
    ${skeletons(4)}`;
  try {
    me = await locate();
    location.set(me);
  } catch (e) {
    body.innerHTML = locationProblem(e) + searchFallback();
    wireSearch();
    return;
  }
  try {
    stations = (await api.nearby(me.lat.toFixed(5), me.lng.toFixed(5)))
      .filter((s) => clean(s.StationName))
      .sort((a, b) => parseFloat(a.Distance) - parseFloat(b.Distance))
      .slice(0, 30);
    render();
  } catch (e) {
    body.innerHTML = errorState(e, 'locate');
  }
}

/**
 * Why the location failed, which decides what to tell the rider to do.
 *
 * These were all one message before — "permission denied" — which is wrong advice for two of
 * the three, and the frustrating one: the browser has permission, the phone's location is
 * switched off, and the app kept telling them to check a browser setting that was already
 * correct. `getCurrentPosition` distinguishes them (1 denied, 2 unavailable, 3 timed out); the
 * permission gate throws its own 'denied' before that.
 */
function locationProblem(e) {
  if (e?.message === 'denied' || e?.code === 1) {
    return emptyState({ glyph: 'alert', title: t('locDenied'), body: t('locDeniedB') });
  }
  if (e?.code === 3) {
    return emptyState({ glyph: 'clock', title: t('locSlow'), body: t('locSlowB') });
  }
  // Code 2, and anything unrecognised: the device could not produce a position. Telling someone
  // to switch location on is useful whether or not that is the exact cause; telling them their
  // permission is denied when it is granted is not.
  return emptyState({ glyph: 'compass', title: t('locOff'), body: t('locOffB') });
}

/**
 * A way through for anyone who cannot or will not share a location.
 *
 * Nearby was a dead end without it: no position, no stations, nothing else to try. Most of the
 * gazetteer is reachable by name, and someone who knows the station they want should not have
 * to hand over their whereabouts to look it up.
 */
function searchFallback() {
  // The same shape the Routes fields use: `.field` wrapping `.lead` + `.input` + `.ac`. The
  // list shows itself through `.ac:empty { display: none }`, so it must not carry a `hidden`
  // attribute — `[hidden]` is `display: none !important` here and would pin it shut for good.
  return `<div class="sec-title">${esc(t('nearbySearch'))}</div>
    <div class="field">
      <span class="lead">${icon('search', 'i i-sm')}</span>
      <input id="nearby-q" class="input" type="text" autocomplete="off"
        placeholder="${esc(t('nearbySearchPh'))}" aria-label="${esc(t('nearbySearchPh'))}" />
      <div class="ac" id="nearby-ac"></div>
    </div>`;
}

/** Wires the fallback search, once its markup is on screen. */
function wireSearch() {
  const input = $('#nearby-q');
  const pop = $('#nearby-ac');
  if (!input || !pop || input._stWired) return;
  input._stWired = true;
  autocomplete(input, pop, {
    fetcher: (q) => api.stations(q),
    render: (r) => esc(localName(clean(r.StationName), clean(r.StationNameGuj))),
    onPick: (r) => showStation(r),
  });
}

/**
 * Puts a searched-for station on the map, rather than jumping to its timetable.
 *
 * This is the Nearby screen, so the question a search here asks is "where is that" — and the
 * answer is a map with the place on it and what else is around it. Sending the rider to a
 * departure list instead answered a question they did not ask and left the screen behind.
 *
 * The autocomplete carries names and ids but no coordinates, and the operator has no call that
 * resolves one by id, so the position comes from the gazetteer this app builds for itself.
 * Where a station is not in it yet, say so plainly and offer the departures — which is genuinely
 * the only thing left to offer.
 */
async function showStation(row) {
  const id = String(row.StationId || '');
  const name = localName(clean(row.StationName), clean(row.StationNameGuj));
  const body = $('#nearby-body');
  body.innerHTML = `<div class="note">${icon('crosshair', 'i i-sm')}<div>${esc(t('locating'))}</div></div>`;

  let at = null;
  try {
    at = (await api.stopPositions([id]))?.[0] || null;
  } catch { /* treated the same as not knowing */ }

  if (!at) {
    $('#nearby-title').textContent = t('nearbyT');
    body.innerHTML = emptyState({
      glyph: 'compass',
      title: t('stationUnplaced', { name }),
      body: t('stationUnplacedB'),
    }) + `<button class="btn block" data-act="departures" data-id="${esc(id)}"
        data-name="${esc(clean(row.StationName))}" data-gu="${esc(clean(row.StationNameGuj))}">
        ${icon('route', 'i i-sm')}${esc(t('seeDepartures'))}</button>`
      + searchFallback();
    wireSearch();
    return;
  }

  // Everything around it, so the screen still answers "what can I catch here" — the same shape
  // as the rider's own location, centred somewhere else.
  me = { lat: at.lat, lng: at.lng, label: name };
  try {
    stations = (await api.nearby(at.lat.toFixed(5), at.lng.toFixed(5)))
      .filter((s) => clean(s.StationName))
      .sort((a, b) => parseFloat(a.Distance) - parseFloat(b.Distance))
      .slice(0, 30);
  } catch {
    stations = [];
  }
  render({ around: name, centreId: id });
}

function render({ around = '', centreId = '' } = {}) {
  if (!stations.length) {
    $('#nearby-body').innerHTML = emptyState({ glyph: 'compass', title: t('noBuses'), body: t('nearbyEmptyB') })
      + searchFallback();
    wireSearch();
    return;
  }
  // The screen already has a heading; repeating it here just pushed the list down.
  // Named when the map is centred somewhere the rider is not, so "near" is never ambiguous.
  $('#nearby-title').textContent = around
    ? t('stationsNear', { name: around })
    : t('stationsFound', { n: stations.length });
  $('#nearby-body').innerHTML = `
    <div id="nearby-map" class="map map-inline"></div>
    ${stations.map((s, i) => {
      const km = parseFloat(s.Distance);
      const name = localName(clean(s.StationName), clean(s.StationNameGuj));
      return `<div class="tile" data-act="depart" data-i="${i}" role="button" tabindex="0"
          aria-label="${esc(`${name} — ${t('departuresFrom')}`)}">
        <span class="glyph">${icon('signpost', 'i i-sm')}</span>
        <span class="body">
          <span class="t1">${esc(name)}</span>
          <span class="t2">${esc(centreId && String(s.StationId) === centreId
    // "0 m away" from the station you just searched for is noise. It still has a row, because
    // that row is how you get to its departures.
    ? t('thisStation')
    : (isFinite(km) ? `${distance(km)} ${t('awayFromYou')}` : ''))}</span>
        </span>
        <span class="end">
          <button class="iconbtn bordered" data-act="maps" data-i="${i}"
            title="${esc(t('openInMaps'))}" aria-label="${esc(`${t('openInMaps')} — ${name}`)}"
            >${icon('navigation', 'i i-sm')}</button>
          ${icon('right', 'i i-sm')}
        </span>
      </div>`;
    }).join('')}`;
  drawMap();
  // Kept on screen alongside the results: someone may still want a station that is not one of
  // the thirty nearest.
  $('#nearby-body').insertAdjacentHTML('beforeend', searchFallback());
  wireSearch();
}

function drawMap() {
  // destroyMap, not map.remove(): the module keeps a registry of open maps so a theme or style
  // change can repaint them, and removing one behind its back leaves a dead reference there.
  destroyMap(map);
  map = createMap('nearby-map', { zoom: 12, centre: [me.lat, me.lng] });
  // A searched station is a place, not the rider — a "you are here" dot sitting on Wankaner
  // when you are in Rajkot is simply wrong.
  const centre = L.marker([me.lat, me.lng], {
    icon: me.label ? stopIcon(false, { at: true }) : meIcon(), zIndexOffset: 500,
  }).addTo(map);
  if (me.label) centre.bindTooltip(esc(me.label), { permanent: true, direction: 'top', className: 'map-tip' });
  const pts = [[me.lat, me.lng]];
  stations.slice(0, 15).forEach((s) => {
    const lat = parseFloat(s.Center_Lat), lng = parseFloat(s.Center_Lon);
    if (!isFinite(lat) || !isFinite(lng)) return;
    pts.push([lat, lng]);
    L.marker([lat, lng], { icon: stopIcon(false) })
      .bindTooltip(esc(localName(clean(s.StationName), clean(s.StationNameGuj))), { direction: 'top' })
      .addTo(map);
  });
  setTimeout(() => { map.invalidateSize(); fit(map, pts, 34); }, 80);
}

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  const act = btn?.dataset.act;
  if (act === 'locate' || act === 'retry') return run();

  // Offered only when we cannot place a station on the map; it is the one useful thing left.
  if (act === 'departures') {
    return emit('set-stations', {
      fromId: btn.dataset.id, fromName: btn.dataset.name, fromGu: btn.dataset.gu,
    }, false);
  }

  if (act === 'maps') {
    const s = stations[+btn.dataset.i];
    const lat = parseFloat(s.Center_Lat), lng = parseFloat(s.Center_Lon);
    if (!isFinite(lat) || !isFinite(lng)) return toast(t('errGeneric'), 'alert');
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank', 'noopener');
    return;
  }

  const holder = btn || e.target.closest('[data-i]');
  if (!holder) return;
  const s = stations[+holder.dataset.i];
  if (!s) return;
  emit('set-stations', {
    fromId: s.StationId,
    fromName: clean(s.StationName),
    fromGu: clean(s.StationNameGuj),
  }, false);
}

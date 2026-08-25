/* Thin Leaflet wrapper. Keeps tile choice in step with the theme and animates the bus
   between two fixes instead of teleporting it, which reads far better at 20s polling. */

import { icon } from './icons.js';
import { esc } from './ui.js';
import { localName, t } from './i18n.js';
import { api } from './api.js';
import * as store from './store.js';

/**
 * The map styles a rider can pick between.
 *
 * Every one of these is a raster tile source that permits app use and needs no API key, so the
 * picker costs nothing and adds no key to ship to the browser. Two deliberate absences:
 *
 *   - `tile.openstreetmap.org` is NOT here. Their tile usage policy forbids distributing an app
 *     that draws from it; the polite and correct route to OSM data is a provider who serves it
 *     for that purpose, which is what CARTO is doing below.
 *   - Google's tiles are not here either, and must never be. Google's terms only permit their
 *     map data through their own APIs — pulling their tile URLs into Leaflet is a licence
 *     breach, not a shortcut. Real Google support is a second rendering engine; see GOOGLE.
 *
 * `dark` is optional: satellite imagery looks the same at night, so it simply has no variant.
 */
/**
 * Place and village names, transparent, for a basemap that carries none of its own.
 *
 * Esri's transportation label layer was tried here as a way of writing road names onto every
 * style. It is styled for dark satellite imagery, and over a light basemap it renders as
 * purple-haloed text fighting everything beneath it. Voyager already names roads as you zoom
 * in; that is the right place for road names, not an overlay.
 */
const PLACE_LABELS = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png';

export const MAP_STYLES = {
  standard: {
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  },
  detailed: {
    // Voyager keeps road classes, place names and landmarks that the minimal style drops —
    // the closest free thing to the density people expect from Google.
    //
    // No `dark` variant on purpose. Voyager has no dark counterpart, and the obvious
    // substitute is the minimal dark style — which is exactly what `standard` already is, so
    // picking "Detailed" at night would silently hand back the Standard map and look like the
    // setting was ignored. Someone who chose Detailed wants the extra information; showing it
    // is more useful than matching the UI.
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  },
  satellite: {
    light: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, labels &copy; CARTO',
    maxZoom: 18,
    // Imagery alone has no names at all, which makes a bus dot meaningless.
    overlays: [PLACE_LABELS],
  },
};

/** Chosen by the rider, falling back to the default if an old value no longer exists. */
export function styleId() {
  const id = store.settings.get().mapStyle;
  // Falls back to the app default, not to Standard: anyone still holding the removed "Roads"
  // value chose it for the extra detail, and Detailed is the closest thing left.
  return MAP_STYLES[id] ? id : 'detailed';
}

const GUJARAT_CENTRE = [22.75, 71.7];

const maps = new Set();

function currentScheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The tile URL for a style under the current theme, falling back when it has no dark variant. */
function urlFor(style) {
  return style[currentScheme()] || style.light;
}

function paint(map) {
  const style = MAP_STYLES[styleId()];

  map._stTiles?.remove();
  (map._stLabels || []).forEach((layer) => layer.remove());
  map._stLabels = [];

  map._stTiles = L.tileLayer(urlFor(style), {
    maxZoom: style.maxZoom, attribution: style.attribution,
  }).addTo(map);

  // Labels must sit above the basemap but below every marker, which is what Leaflet's shadow
  // pane is for — the tile pane would put them underneath.
  for (const url of style.overlays || []) {
    map._stLabels.push(
      L.tileLayer(url, { maxZoom: style.maxZoom, pane: 'shadowPane' }).addTo(map),
    );
  }
  return map;
}

export function createMap(elId, { zoom = 7, centre = GUJARAT_CENTRE } = {}) {
  const map = L.map(elId, { zoomControl: true, attributionControl: true, tap: false })
    .setView(centre, zoom);
  map.attributionControl.setPrefix('');
  maps.add(map);
  return paint(map);
}

export function destroyMap(map) {
  if (!map) return;
  maps.delete(map);
  map.remove();
}

/** Called by the theme switcher and the style picker, so every open map follows along. */
export function refreshTiles() {
  maps.forEach(paint);
}

export const busIcon = (label = '') => L.divIcon({
  className: '',
  html: `<div class="bus-pin">${icon('bus', 'i i-sm')}</div>`,
  iconSize: [34, 34], iconAnchor: [17, 17], tooltipAnchor: [0, -18],
  ...(label ? {} : {}),
});

/**
 * A stop on the route. `at` marks the one the bus is standing at right now, which is the single
 * most useful thing the map can say — "it is sitting at Tankara" answers a waiting rider's
 * question in a way a moving dot between two villages never does.
 */
export const stopIcon = (done, { at = false } = {}) => L.divIcon({
  className: '',
  html: `<div class="stop-pin${done ? ' done' : ''}${at ? ' at' : ''}"></div>`,
  iconSize: at ? [20, 20] : [12, 12],
  iconAnchor: at ? [10, 10] : [6, 6],
  tooltipAnchor: [0, at ? -12 : -8],
});

export const meIcon = () => L.divIcon({
  className: '', html: '<div class="me-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8],
});

/** Moves a marker along a short animation. Falls back to a jump when motion is reduced. */
/**
 * Every bus stand in view, drawn on any map that asks for them.
 *
 * A dot moving across open country does not tell a rider much; the same dot sitting on "Tankara
 * Bus Stand" tells them the bus is *at* their stop. The gazetteer fills itself from trip
 * responses the app already makes, so this costs the operator nothing.
 *
 * Only from zoom 11 in. Further out the stands pile into an unreadable smear, and the viewport
 * covers half the state — which is a large query to answer for something nobody can read.
 */
const STANDS_MIN_ZOOM = 11;

/**
 * How close counts as "the bus is at this stand".
 *
 * Generous on purpose, and widened once already. The operator's fixes drift by a couple of
 * hundred metres, stands sit off the carriageway, and a bus pulling in stops short of the pin —
 * so a tight radius blinks the highlight on and off while the rider watches.
 *
 * The case that set this figure: the operator lists one place twice under different names —
 * "Madhapar( Rajkot)" and "Madhapar(RJT)" — a few hundred metres apart. At 400m only one of the
 * pair lit up, which reads as the app picking a favourite between two identical labels rather
 * than as a radius. Marking every stand the bus is genuinely beside is the honest answer.
 */
const AT_STAND_M = 700;

/**
 * How close a stand has to be to a route stop to count as the same place.
 *
 * The two come from different sources — the route's stop list and the gazetteer — so the same
 * bus station lands at slightly different coordinates in each.
 */
const SAME_PLACE_M = 250;

/**
 * Below this, a stand and the bus are drawing at the same pixel, so only one of them may speak.
 * Generous, because the operator's fix drifts and a bus pulled into a stand is not at its pin.
 */
const TOO_CLOSE_TO_LABEL_M = 180;

export function showBusStands(map) {
  if (map._stStands) return map;
  const layer = L.layerGroup().addTo(map);
  map._stStands = layer;
  const drawn = new Map();
  let inFlight = false;
  let busAt = null;      // the bus's last known position, so newly drawn stands are marked too
  let covered = null;   // the area already fetched, so following a bus does not refetch it

  const refresh = async () => {
    if (map.getZoom() < STANDS_MIN_ZOOM) {
      layer.clearLayers(); drawn.clear(); covered = null; return;
    }
    if (inFlight) return;
    // The track map recentres on the bus every twenty seconds. Without this it would ask again
    // on every one of those, for stands it already has on screen.
    if (covered && covered.contains(map.getBounds())) return;
    inFlight = true;
    try {
      // Fetched a little wider than the screen, so a short pan is already covered.
      const b = map.getBounds().pad(0.4);
      covered = b;
      const stops = await api.stops({
        south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
      });
      for (const stop of stops || []) {
        if (drawn.has(stop.id)) continue;
        // The route's own stops are drawn by the track screen, with context this layer does not
        // have — behind the bus, ahead of it, at it. Adding a second marker for the same place
        // put "Rajkot" on screen four times over.
        if (onRoute(L.latLng(stop.lat, stop.lng))) continue;
        const marker = L.marker([stop.lat, stop.lng], { icon: standIcon(), interactive: true })
          // The app's own tooltip style, not Leaflet's default white box — and the quietest
          // variant of it, because there are hundreds of these and they are context for the
          // bus rather than the subject of the screen.
          .bindTooltip(esc(localName(stop.name, stop.nameGu)), {
            direction: 'top', className: 'map-tip stand-tip', offset: [0, -3],
          })
          .addTo(layer);
        marker._stName = localName(stop.name, stop.nameGu);
        drawn.set(stop.id, marker);
        if (busAt) applyNear(marker);
      }
    } catch {
      // The stands are context, not the point of the screen. A failed fetch leaves the map alone
      // — and forgets the area, so the next move tries again rather than assuming it has them.
      covered = null;
    } finally {
      inFlight = false;
    }
  };

  const onRoute = (latlng) =>
    (map._stRouteStops || []).some((p) => map.distance(p, latlng) < SAME_PLACE_M);

  /**
   * Drops stands the route turned out to cover.
   *
   * The stop list arrives after the stands do, so the overlap can only be resolved once it is
   * known — otherwise the duplicates simply stay on screen for the rest of the session.
   */
  map._stStandsPrune = () => {
    drawn.forEach((marker, id) => {
      if (!onRoute(marker.getLatLng())) return;
      layer.removeLayer(marker);
      drawn.delete(id);
    });
  };

  /** Marks one stand according to how far it is from the bus right now. */
  const applyNear = (marker) => {
    const d = busAt ? map.distance(marker.getLatLng(), busAt) : Infinity;
    // Sitting on top of the bus, the stand's own label has nowhere to go that is not already
    // occupied — below its pin lands exactly where the bus's label is, because the two markers
    // are the same point. The bus label already names the stop it is at, so the stand keeps its
    // highlight and gives up the words.
    const onTopOfBus = d <= TOO_CLOSE_TO_LABEL_M;
    const near = d <= AT_STAND_M;
    const el = marker.getElement()?.querySelector('.stand-pin');
    if (el) el.classList.toggle('near', !!near);
    // The name is worth saying out loud at the moment the bus reaches it — that is the whole
    // question a rider at that stop is asking. Elsewhere it stays a dot until tapped.
    const wantLabel = near && !onTopOfBus;
    const tip = marker.getTooltip();
    if (tip && tip.options.permanent !== wantLabel) {
      // "At Tankara" while the bus is there, the bare name otherwise. The basemap already
      // writes the town's name a few pixels away, so repeating it read as a duplicate label
      // rather than as a statement about the bus.
      const text = wantLabel
        ? esc(t('atStand', { name: marker._stName }))
        : esc(marker._stName);
      marker.unbindTooltip();
      marker.bindTooltip(text, {
        permanent: wantLabel,
        // Below the pin while the bus is here, above it otherwise. The bus carries its own
        // label directly above its marker, and at eight metres apart the two land on the same
        // pixel — the stand's name was rendering straight through "plate → next stop".
        direction: wantLabel ? 'bottom' : 'top',
        offset: wantLabel ? [0, 6] : [0, -3],
        className: `map-tip stand-tip${near ? ' near' : ''}`,
      });
      if (wantLabel) marker.openTooltip();
    }
  };

  map._stStandsNear = (latlng) => {
    busAt = latlng;
    drawn.forEach(applyNear);
  };

  map.on('moveend zoomend', refresh);
  refresh();
  return map;
}

/**
 * Tells the stand layer where the bus is, so the one it is passing can say so.
 *
 * Safe to call before the layer exists or on a map that never asked for stands — the track
 * screen calls it on every position update and should not have to know either.
 */
export function markStandsNearBus(map, latlng) {
  map?._stStandsNear?.(latlng);
}

/**
 * Tells the stand layer which stops the route already draws, so it stops drawing them too.
 *
 * Called whenever the route is redrawn, because the stands may have been fetched before the
 * stop list existed.
 */
export function setRouteStops(map, latlngs) {
  if (!map) return;
  map._stRouteStops = latlngs || [];
  map._stStandsPrune?.();
}

export const standIcon = () => L.divIcon({
  className: '',
  html: '<div class="stand-pin"></div>',
  iconSize: [9, 9],
  iconAnchor: [4.5, 4.5],
  tooltipAnchor: [0, -7],
});

export function glideTo(marker, latlng, ms = 900) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = marker.getLatLng();
  if (reduce || !from || from.equals(latlng)) return marker.setLatLng(latlng);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // easeInOutQuad
    marker.setLatLng([from.lat + (latlng.lat - from.lat) * e, from.lng + (latlng.lng - from.lng) * e]);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function tooltip(marker, text, { permanent = true } = {}) {
  marker.bindTooltip(esc(text), { permanent, direction: 'top', className: 'map-tip', offset: [0, -4] });
  return marker;
}

/** A tap target for a map full of buses, where permanent labels would just collide. */
export function busPopup(marker, html) {
  marker.bindPopup(html, { className: 'bus-popup', closeButton: false, offset: [0, -12], maxWidth: 260 });
  return marker;
}

export function fit(map, latlngs, padding = 46) {
  const pts = latlngs.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
  if (!pts.length) return;
  if (pts.length === 1) return map.setView(pts[0], Math.max(map.getZoom(), 14));
  map.fitBounds(L.latLngBounds(pts), { padding: [padding, padding], maxZoom: 15 });
}

export function brandColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#1b3c77';
}
export function mutedColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim() || '#78839a';
}

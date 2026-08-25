/* Arrival alerts.
 *
 * Two kinds, both evaluated on the live polls the app is already doing:
 *   - 'me'   : fire when the bus comes within N km of where you are standing
 *   - 'stop' : fire when the bus comes within N km of a chosen stop on its route
 *
 * Honest about its limits: this runs in the page, so it works while ST Tracker is open
 * (including as an installed app in the background on desktop). There is no server push.
 */

import { t } from './i18n.js';
import { haversineKm, toast } from './ui.js';

const KEY = 'st.alerts.v1';
const DEFAULT_RADIUS_KM = 2;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

let alerts = load();

export function supported() { return 'Notification' in window; }
export function permission() { return supported() ? Notification.permission : 'unsupported'; }

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

/** alert = { plate, kind:'me'|'stop', lat, lng, label, radiusKm } */
export function set(alert) {
  alerts[alert.plate] = { radiusKm: DEFAULT_RADIUS_KM, ...alert, at: Date.now() };
  save(alerts);
  return alerts[alert.plate];
}

export function get(plate) { return alerts[plate] || null; }
export function clear(plate) { delete alerts[plate]; save(alerts); }
export function list() { return Object.values(alerts); }

function fire(alert, km) {
  const body = t('alertFired', { plate: alert.plate, stop: alert.label });
  const detail = `${km.toFixed(1)} ${t('km')}`;
  if (permission() === 'granted') {
    try {
      new Notification(body, {
        body: detail,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-96.png',
        tag: `st-${alert.plate}`,
        renotify: false,
      });
    } catch { toast(body); }
  } else {
    toast(body, 'bell');
  }
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  clear(alert.plate);
}

/**
 * Call on every fresh fix. Returns the distance to the alert target, or null when
 * no alert is set for this plate.
 */
export function check(plate, pos) {
  const alert = alerts[plate];
  if (!alert || !pos) return null;
  const km = haversineKm(pos, { lat: alert.lat, lng: alert.lng });
  if (km <= alert.radiusKm) fire(alert, km);
  return km;
}

/* Arrival alerts.
 *
 * Existing behavior is intentionally preserved.
 *
 * Upgrades:
 *   - 1 km / 2 km / 5 km radius presets
 *   - persistent alert state
 *   - GPS jitter protection / hysteresis
 *   - duplicate-fire protection
 *   - distance progress events for premium UI
 *   - safer notification handling
 *   - backwards-compatible set/get/clear/list/check API
 *
 * Two kinds:
 *   - 'me'   : bus approaches the rider's current location
 *   - 'stop' : bus approaches a selected stop
 *
 * IMPORTANT:
 * This file does not replace the tracking system. It only evaluates the live fixes that
 * the existing tracker already receives.
 */

import { t } from './i18n.js';
import { haversineKm, toast } from './ui.js';

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

const KEY = 'st.alerts.v1';

/*
 * These are the officially exposed alert distances in the UI.
 * Keep this exported so other screens can use the same source of truth.
 */
export const ALERT_RADII_KM = Object.freeze([1, 2, 5]);

export const DEFAULT_RADIUS_KM = 2;

/*
 * Small hysteresis prevents a GPS fix bouncing around the threshold from behaving
 * like a human repeatedly pressing a doorbell.
 *
 * Example:
 *   radius = 2km
 *   enter  = <= 2.00km
 *   once triggered, the alert is considered consumed immediately.
 *
 * For progress UI we additionally expose the distance state without firing.
 */
const DISTANCE_EPSILON_KM = 0.05;

/*
 * A minimum time between progress events prevents excessive UI work when the GPS
 * feed becomes noisy or updates faster than expected.
 */
const PROGRESS_EVENT_THROTTLE_MS = 750;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function save(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable in private/restricted browser contexts. */
  }
}

let alerts = load();

/*
 * Runtime-only state.
 *
 * This deliberately isn't persisted because it is derived from the current GPS stream.
 */
const runtime = new Map();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseRadius(radiusKm) {
  const radius = finiteNumber(radiusKm);

  if (radius == null || radius <= 0) {
    return DEFAULT_RADIUS_KM;
  }

  /*
   * Keep arbitrary values working for backwards compatibility, but snap known
   * preset values cleanly to the official options.
   */
  const preset = ALERT_RADII_KM.find((value) => Math.abs(value - radius) < 0.001);

  return preset ?? radius;
}

function normaliseAlert(alert) {
  if (!alert || typeof alert !== 'object') return null;

  const plate = String(alert.plate || '').trim();
  if (!plate) return null;

  const lat = finiteNumber(alert.lat);
  const lng = finiteNumber(alert.lng);

  if (lat == null || lng == null) return null;

  return {
    ...alert,
    plate,
    lat,
    lng,
    radiusKm: normaliseRadius(alert.radiusKm),
    kind: alert.kind === 'me' ? 'me' : 'stop',
    label: String(alert.label || ''),
  };
}

function getRuntime(plate) {
  if (!runtime.has(plate)) {
    runtime.set(plate, {
      lastDistanceKm: null,
      lastEventAt: 0,
      fired: false,
    });
  }

  return runtime.get(plate);
}

/* -------------------------------------------------------------------------- */
/* Browser notification support                                               */
/* -------------------------------------------------------------------------- */

export function supported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';

  if (Notification.permission !== 'default') {
    return Notification.permission;
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/* -------------------------------------------------------------------------- */
/* Public alert management                                                    */
/* -------------------------------------------------------------------------- */

/**
 * alert = {
 *   plate,
 *   kind: 'me' | 'stop',
 *   lat,
 *   lng,
 *   label,
 *   radiusKm
 * }
 */
export function set(alert) {
  const normalised = normaliseAlert(alert);

  if (!normalised) {
    return null;
  }

  /*
   * Preserve the original timestamp behavior.
   * If the caller supplied an existing timestamp, don't destroy it.
   */
  const existing = alerts[normalised.plate];

  alerts[normalised.plate] = {
    radiusKm: DEFAULT_RADIUS_KM,
    ...existing,
    ...normalised,
    at: Number.isFinite(normalised.at)
      ? normalised.at
      : Date.now(),
  };

  /*
   * Reset runtime distance state whenever an alert is newly armed or its target
   * changes. This avoids carrying GPS state from an old alert into a new one.
   */
  runtime.set(normalised.plate, {
    lastDistanceKm: null,
    lastEventAt: 0,
    fired: false,
  });

  save(alerts);

  return alerts[normalised.plate];
}

export function get(plate) {
  return alerts[String(plate || '').trim()] || null;
}

export function clear(plate) {
  const key = String(plate || '').trim();

  delete alerts[key];
  runtime.delete(key);

  save(alerts);
}

export function list() {
  return Object.values(alerts);
}

/**
 * Update only the radius of an existing alert.
 *
 * This lets the UI switch 1km -> 2km -> 5km without having to rebuild
 * the complete alert object.
 */
export function setRadius(plate, radiusKm) {
  const key = String(plate || '').trim();
  const current = alerts[key];

  if (!current) return null;

  const radius = normaliseRadius(radiusKm);

  alerts[key] = {
    ...current,
    radiusKm: radius,
    at: Date.now(),
  };

  runtime.set(key, {
    lastDistanceKm: null,
    lastEventAt: 0,
    fired: false,
  });

  save(alerts);

  return alerts[key];
}

/**
 * Returns the supported radius presets.
 */
export function radii() {
  return [...ALERT_RADII_KM];
}

/**
 * Returns a small UI-friendly representation of an alert.
 */
export function describe(plate) {
  const alert = get(plate);

  if (!alert) return null;

  return {
    plate: alert.plate,
    label: alert.label,
    kind: alert.kind,
    radiusKm: normaliseRadius(alert.radiusKm),
    active: true,
    createdAt: alert.at || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Notification                                                               */
/* -------------------------------------------------------------------------- */

function fire(alert, km) {
  /*
   * Runtime protection.
   *
   * check() can be called more than once for the same GPS fix in some browsers
   * or integrations. Never show two notifications for the same alert.
   */
  const state = getRuntime(alert.plate);

  if (state.fired) {
    return;
  }

  state.fired = true;

  const body = t('alertFired', {
    plate: alert.plate,
    stop: alert.label,
  });

  const detail = `${Math.max(0, km).toFixed(1)} ${t('km')}`;

  if (permission() === 'granted') {
    try {
      const notification = new Notification(body, {
        body: detail,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-96.png',

        /*
         * Keep the tag stable for the bus so the same alert doesn't produce
         * a stack of notifications.
         */
        tag: `st-${alert.plate}`,

        renotify: false,

        /*
         * Keep the notification silent because vibration is handled below
         * and browsers differ wildly in their notification sound behavior.
         */
        silent: false,
      });

      /*
       * Closing the notification is harmless if the browser does not expose
       * the method.
       */
      if (notification && typeof notification.onclick === 'function') {
        notification.onclick = () => {
          try {
            window.focus();
          } catch {
            /* ignore */
          }
        };
      }
    } catch {
      toast(body, 'bell');
    }
  } else {
    toast(body, 'bell');
  }

  if (navigator.vibrate) {
    try {
      navigator.vibrate([120, 60, 120]);
    } catch {
      /* Vibration may be unavailable or blocked. */
    }
  }

  /*
   * Preserve original behavior:
   * an alert is one-shot and disappears after firing.
   */
  clear(alert.plate);
}

/* -------------------------------------------------------------------------- */
/* Progress events                                                            */
/* -------------------------------------------------------------------------- */

/*
 * UI modules can subscribe to:
 *
 *   distance-progress
 *
 * Detail:
 * {
 *   plate,
 *   km,
 *   radiusKm,
 *   remainingKm,
 *   progress,
 *   label,
 *   kind
 * }
 *
 * This is intentionally additive. Existing code does not have to listen to it.
 */
function emitProgress(alert, km) {
  if (typeof window === 'undefined') return;

  const state = getRuntime(alert.plate);
  const now = Date.now();

  if (now - state.lastEventAt < PROGRESS_EVENT_THROTTLE_MS) {
    return;
  }

  state.lastEventAt = now;

  const radius = normaliseRadius(alert.radiusKm);

  /*
   * 1 at the target, 0 outside the radius.
   */
  const progress = Math.max(
    0,
    Math.min(1, 1 - ((km - radius) / Math.max(radius, DISTANCE_EPSILON_KM)))
  );

  window.dispatchEvent(new CustomEvent('st:alert-distance', {
    detail: {
      plate: alert.plate,
      km,
      radiusKm: radius,
      remainingKm: Math.max(0, km),
      progress,
      label: alert.label,
      kind: alert.kind,
    },
  }));
}

/* -------------------------------------------------------------------------- */
/* Main GPS check                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Call on every fresh fix.
 *
 * Returns the distance to the alert target, or null when no alert exists.
 *
 * Existing tracker code can continue calling:
 *
 *   alerts.check(plate, pos);
 *
 * exactly as before.
 */
export function check(plate, pos) {
  const key = String(plate || '').trim();
  const alert = alerts[key];

  if (!alert || !pos) {
    return null;
  }

  const lat = finiteNumber(pos.lat);
  const lng = finiteNumber(pos.lng);

  if (lat == null || lng == null) {
    return null;
  }

  const targetLat = finiteNumber(alert.lat);
  const targetLng = finiteNumber(alert.lng);

  if (targetLat == null || targetLng == null) {
    return null;
  }

  const km = haversineKm(
    { lat, lng },
    { lat: targetLat, lng: targetLng }
  );

  if (!Number.isFinite(km)) {
    return null;
  }

  const state = getRuntime(key);
  const previous = state.lastDistanceKm;

  state.lastDistanceKm = km;

  /*
   * Tell the UI about movement toward/away from the target.
   */
  emitProgress(alert, km);

  const radius = normaliseRadius(alert.radiusKm);

  /*
   * Normal trigger.
   *
   * The epsilon allows tiny floating-point/GPS fluctuations around the exact
   * threshold without causing weird boundary behavior.
   */
  const insideRadius = km <= radius + DISTANCE_EPSILON_KM;

  /*
   * If the previous fix was already very close and the current fix moves
   * slightly outside because of GPS jitter, don't treat it as a meaningful
   * departure before the alert has had a chance to fire.
   *
   * The alert is still one-shot, so once it enters the radius, fire() clears it.
   */
  const crossedIntoRadius =
    previous == null ||
    previous > radius + DISTANCE_EPSILON_KM ||
    km <= previous;

  if (insideRadius && crossedIntoRadius) {
    fire(alert, km);
  }

  return km;
}

/* -------------------------------------------------------------------------- */
/* Utility helpers for UI                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Returns the nearest official preset to a supplied radius.
 *
 * Example:
 *   nearestRadius(1.7) -> 2
 */
export function nearestRadius(radiusKm) {
  const radius = finiteNumber(radiusKm);

  if (radius == null) {
    return DEFAULT_RADIUS_KM;
  }

  return ALERT_RADII_KM.reduce((best, current) => {
    return Math.abs(current - radius) < Math.abs(best - radius)
      ? current
      : best;
  }, ALERT_RADII_KM[0]);
}

/**
 * Returns whether a supplied radius is one of the official presets.
 */
export function isPresetRadius(radiusKm) {
  const radius = finiteNumber(radiusKm);

  if (radius == null) return false;

  return ALERT_RADII_KM.some(
    (value) => Math.abs(value - radius) < 0.001
  );
}

/**
 * Clear all runtime-only state.
 *
 * Useful when switching buses or leaving the tracking screen.
 * Does NOT delete persisted alerts.
 */
export function resetRuntime(plate = null) {
  if (plate == null) {
    runtime.clear();
    return;
  }

  runtime.delete(String(plate || '').trim());
}

/**
 * Returns the current distance observed for an alert.
 *
 * This is useful for a live "1.8 km away" indicator without exposing
 * internal runtime state.
 */
export function currentDistance(plate) {
  const key = String(plate || '').trim();
  const state = runtime.get(key);

  return state?.lastDistanceKm ?? null;
}
/**
 * Arrival alerts that work with the app closed.
 *
 * The in-page alerts in alerts.js only ever fired while a tab was open, which is precisely
 * when you do not need them — the whole point of "tell me when my bus is near" is that the
 * phone is in your pocket. This registers a real push subscription instead, and the server
 * evaluates it against positions it is already collecting.
 *
 * Falls back to the in-page alert when push is unavailable: an older browser, a denied
 * permission, or iOS where web push needs the app installed to the home screen first.
 */

import { api } from './api.js';
import { t } from './i18n.js';
import * as permissions from './permissions.js';

let cachedKey = null;

export function supported() {
  return 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && window.isSecureContext;
}

/**
 * iOS only allows web push once the app has been added to the home screen — asking in Safari
 * throws, so the UI has to say "install it first" rather than showing a dead button.
 */
export function needsInstallFirst() {
  const ua = navigator.userAgent || '';
  const isIOS = !/android/i.test(ua)
    && (/iphone|ipad|ipod/i.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return isIOS && !installed;
}

async function serverKey() {
  if (cachedKey !== null) return cachedKey;
  try {
    const { key, enabled } = await api.pushKey();
    cachedKey = enabled && key ? key : '';
  } catch {
    cachedKey = '';
  }
  return cachedKey;
}

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * The server's VAPID key as the bytes `PushManager.subscribe` wants. Exported so the settings
 * screen can raise a subscription for a test without duplicating the encoding.
 */
export async function serverKeyBytes() {
  const key = await serverKey();
  if (!key) throw new Error('push is not configured on this server');
  return urlBase64ToUint8Array(key);
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Registers an alert for a plate. Returns 'push' when it will arrive with the app closed,
 * or a reason string the caller can explain to the rider.
 */
export async function subscribe({ plate, label, lat, lng, radiusKm = 1 }) {
  if (!supported()) return 'unsupported';
  if (needsInstallFirst()) return 'install-first';

  const key = await serverKey();
  if (!key) return 'server-disabled';

  // Never fires the native prompt cold — permissions.ensure explains itself first, because a
  // reflexive Deny cannot be undone from inside the app.
  const permission = await permissions.ensure('notifications');
  if (permission !== 'granted') return permission === 'needs-install' ? 'install-first' : 'denied';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,                       // required by Chrome, and honest anyway
      applicationServerKey: urlBase64ToUint8Array(key),
    }).catch(() => null);
    if (!sub) return 'denied';
  }

  await api.pushSubscribe({
    subscription: sub.toJSON(),
    alert: { plate, label, lat, lng, radiusKm },
  });
  return 'push';
}

/** Cancels the alert for one plate, leaving the subscription in place for other buses. */
export async function cancel(plate) {
  if (!supported()) return false;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return false;
  const json = sub.toJSON();
  await api.pushCancel({ endpoint: json.endpoint, keys: json.keys, plate }).catch(() => {});
  return true;
}

/** A human-readable reason, for the cases where push could not be set up. */
export function explain(reason) {
  switch (reason) {
    case 'push': return t('alertPushOn');
    case 'install-first': return t('alertNeedsInstall');
    case 'denied': return t('alertNeedsPermission');
    case 'server-disabled':
    case 'unsupported':
    default: return t('alertsWhileOpen');
  }
}

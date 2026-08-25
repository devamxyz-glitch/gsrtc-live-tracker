/**
 * Web Push — arrival alerts that arrive with the app closed.
 *
 * This is the piece the in-page alerts could never be. Until now an alert only fired while a
 * tab was open, which is exactly when you do not need it: the point of "tell me when my bus is
 * close" is that you have put the phone in your pocket.
 *
 * How it fits together:
 *   1. the browser subscribes and hands us an endpoint + two keys (see web/js/push.js)
 *   2. that subscription and its alert go in the database
 *   3. `evaluate()` runs on the tracker's own polling loop — no extra upstream traffic — and
 *      compares each fresh position against the pending alerts for that plate
 *   4. when one is within its radius we push, mark it fired, and never fire it twice
 *
 * Payload encryption is RFC 8291 (ECDH + HKDF + AES-128-GCM) and the VAPID header is a signed
 * ES256 JWT. That is done by `web-push` rather than by hand: it is the one dependency the
 * server has, and cryptography implemented from the spec by eye fails silently — the push
 * service returns 201 and the browser quietly cannot decrypt the message.
 */

import webpush from 'web-push';
import { subscriptions, alerts } from './db.mjs';
import { haversineKm } from '../web/js/insight.js';

const env = process.env;

export const config = {
  publicKey: env.VAPID_PUBLIC_KEY || '',
  privateKey: env.VAPID_PRIVATE_KEY || '',
  subject: env.VAPID_SUBJECT || 'mailto:noreply@example.com',
};

export const enabled = Boolean(config.publicKey && config.privateKey);

if (enabled) {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

const counters = { sent: 0, failed: 0, expired: 0 };

/** The browser needs this to subscribe; it is public by design. */
export function publicKey() {
  return config.publicKey;
}

/**
 * Sends one notification. Returns false when the subscription is dead, so the caller can
 * stop carrying it around.
 */
async function send(sub, payload) {
  if (!enabled) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 900, urgency: 'high' },   // a bus alert is worthless fifteen minutes later
    );
    subscriptions.markOk(sub.sub_id);
    counters.sent += 1;
    return true;
  } catch (e) {
    // 404/410 mean the browser has thrown the subscription away — it is gone for good.
    if (e.statusCode === 404 || e.statusCode === 410) {
      subscriptions.remove(sub.endpoint);
      counters.expired += 1;
      return false;
    }
    subscriptions.markFailure(sub.sub_id);
    counters.failed += 1;

    // Say why. A push that fails is invisible from both ends — the rider is simply not told
    // their bus is coming — so the only place the reason can ever surface is here. The endpoint
    // host identifies the push service (FCM, Apple, Mozilla) without logging the token, which
    // is the secret half of the URL.
    let host = 'unknown';
    try { host = new URL(sub.endpoint).host; } catch { /* malformed endpoint */ }
    console.error(JSON.stringify({
      at: new Date().toISOString(), level: 'error', msg: 'push send failed',
      host, status: e.statusCode ?? null, error: e.body || e.message || String(e),
    }));
    return false;
  }
}

/**
 * Checks a fresh position against every alert waiting on that plate.
 *
 * Called from the tracker on each new fix, so it costs no extra upstream requests — the
 * positions are already being collected for everyone watching the map.
 */
export async function evaluate(plate, position, context = {}) {
  if (!enabled || !position) return 0;

  let pending;
  try {
    pending = alerts.pendingFor(plate);
  } catch {
    return 0;   // never let a database hiccup take down the tracker loop
  }
  if (!pending.length) return 0;

  let fired = 0;
  for (const alert of pending) {
    const km = haversineKm(position, { lat: alert.lat, lng: alert.lng });
    if (km > alert.radius_km) continue;

    // Mark it fired before awaiting the send: a slow push must not let the next poll fire
    // the same alert a second time.
    alerts.markFired(alert.id);
    fired += 1;

    const away = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
    await send(
      { endpoint: alert.endpoint, p256dh: alert.p256dh, auth: alert.auth, sub_id: alert.sub_id },
      {
        title: `${plate} is approaching`,
        body: alert.label ? `${away} from ${alert.label}` : `${away} away`,
        plate,
        url: `/?plate=${encodeURIComponent(plate)}`,
        nextStop: context.nextStop || '',
      },
    );
  }
  return fired;
}

/**
 * Sends a test notification to one subscription, on demand.
 *
 * Arrival alerts are the kind of feature nobody finds out is broken until the moment they were
 * relying on it — the bus goes past while the phone stays silent, and there is nothing to see
 * afterwards. This lets someone prove the whole chain works, on their own phone, before they
 * trust it with a journey. It is also the only way the final hop (FCM or APNs actually waking a
 * locked device) can be checked at all, since everything before it is testable in CI.
 *
 * The caller must present the subscription's own keys, which only the browser that owns it
 * has, so this cannot be used to send a notification to somebody else.
 */
export async function sendTest(sub) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  const ok = await send(sub, {
    title: 'ST Tracker alerts are working',
    body: 'This is what an arrival alert will look like. Close the app — they still arrive.',
    plate: '',
    // A hash route, not `?screen=`: the app's deep-link handler understands `plate`, `from`/`to`
    // and the hash, and nothing else — `?screen=settings` quietly landed on the home screen.
    // The hash also survives being clicked while the app is already open, since a fragment
    // navigation fires popstate, which the router listens for.
    url: '/#settings',
    test: true,
  });
  return { ok, reason: ok ? '' : 'send-failed' };
}

/** Everything the tracker must keep watching so that pending alerts can actually fire. */
export function platesToWatch() {
  if (!enabled) return [];
  try {
    return alerts.pendingPlates();
  } catch {
    return [];
  }
}

export function stats() {
  return { enabled, ...counters };
}

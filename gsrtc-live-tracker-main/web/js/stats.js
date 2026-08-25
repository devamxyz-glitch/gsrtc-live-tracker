/**
 * Product analytics: sessions, and the path taken through each one.
 *
 * This is **pseudonymous, not anonymous**, and the difference is worth stating plainly because
 * the privacy policy states it too. Each install gets a random device id, which links one visit
 * to the next — so "how many people came back this week" and "where do people give up" become
 * answerable. It is not derived from anything about the person or the hardware, there is no
 * account to attach it to, and it can be reset from Settings, after which the server deletes
 * everything it ever carried.
 *
 * What is deliberately never sent: your location, the buses you personally looked at, and any
 * free text. Event names come from a fixed list the server also holds, so the client cannot
 * record anything the server has not already agreed to store.
 *
 * Riders can switch the whole thing off, which stops the sending rather than asking the server
 * to disregard it.
 */

import { api } from './api.js';
import * as store from './store.js';

const DEVICE_KEY = 'st.analytics.device';
const MAX_QUEUE = 40;
const FLUSH_AFTER_MS = 12000;

let queue = [];
let timer = null;
let session = '';
let entry = '';

const enabled = () => store.settings.get().stats !== false;

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** The device id, created on first use. Readable so Settings can show and reset it. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = randomId(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    return 'nostorage';   // private mode: every visit looks like a new device, which is correct
  }
}

/**
 * Forgets this device everywhere: tells the server to delete its history, then takes a new id
 * so nothing after this point joins up with anything before it.
 */
export async function forget() {
  const device = deviceId();
  try { await api.statForget({ device }); } catch { /* the local reset still stands */ }
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* private mode */ }
  queue = [];
  session = randomId();
  return device;
}

export function track(name, detail = '') {
  if (!enabled() || !name) return;
  queue.push(detail ? { name, detail } : { name });
  if (queue.length >= MAX_QUEUE) return flush();
  if (!timer) timer = setTimeout(flush, FLUSH_AFTER_MS);
}

/** Throws away anything queued. Used when a rider opts out mid-session. */
export function discard() {
  clearTimeout(timer);
  timer = null;
  queue = [];
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!enabled() || !queue.length) return;

  const events = queue;
  queue = [];
  const s = store.settings.get();
  const payload = JSON.stringify({
    session,
    device: deviceId(),
    lang: s.lang === 'gu' ? 'gu' : 'en',
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    entry,
    events,
  });

  // sendBeacon survives the page closing, which is exactly when a session's last events happen.
  // It cannot be awaited, which is fine: nothing depends on the answer, and a lost batch costs
  // a tally rather than anything a rider would notice.
  if (navigator.sendBeacon?.(`${api.base}/api/stat`,
    new Blob([payload], { type: 'application/json' }))) return;
  api.stat(JSON.parse(payload)).catch(() => { /* never worth a retry storm */ });
}

/**
 * Screen dwell, in buckets.
 *
 * A rider who sits on Track for four minutes is watching a bus approach; one who bounces off in
 * three seconds did not find what they came for. That difference decides what to build, and it
 * is invisible in a plain screen-view count. Bucketed rather than timed, because a stream of
 * durations per device is a behavioural fingerprint and a bucket is not.
 */
let screenAt = 0;
let screenName = '';

export function enterScreen(name) {
  leaveScreen();
  screenName = name;
  screenAt = Date.now();
}

export function leaveScreen() {
  if (!screenName || !screenAt) return;
  const seconds = (Date.now() - screenAt) / 1000;
  if (seconds >= 45 && ['track', 'routes', 'home'].includes(screenName)) {
    track(`dwell:${screenName}-long`);
  }
  screenName = '';
  screenAt = 0;
}

/**
 * How the app performs where it is actually used.
 *
 * A server timing of 14ms says nothing about a rider on a slow connection in Morbi, and the
 * only place that shows up is the device. Buckets, not milliseconds — a precise load time per
 * device is another fingerprint for no extra insight.
 */
function recordEnvironment() {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const ms = nav?.domContentLoadedEventEnd ?? performance.now();
  track(ms < 1500 ? 'perf:boot-fast' : ms < 4000 ? 'perf:boot-ok' : 'perf:boot-slow');

  // effectiveType is the browser's own summary of the connection, already coarse.
  const type = navigator.connection?.effectiveType;
  if (type === '4g') track('net:4g');
  else if (type === '3g') track('net:3g');
  else if (type === '2g' || type === 'slow-2g') track('net:2g');
  if (navigator.connection?.saveData) track('net:slow');

  track(Math.min(screen.width, screen.height) < 380 ? 'screen:small' : 'screen:large');
}

/** Records what is true at startup rather than in response to a tap. */
export function init(entryKind = 'entry:direct') {
  session = randomId();
  entry = entryKind;

  const s = store.settings.get();
  const standalone = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;

  track(standalone ? 'app:standalone' : 'app:browser');
  track(entryKind);
  track(`set:lang-${s.lang === 'gu' ? 'gu' : 'en'}`);
  track(`set:theme-${s.theme || 'system'}`);
  if (s.text === 'large') track('set:text-large');
  track(`set:map-${s.mapStyle || 'standard'}`);
  if (!navigator.onLine) track('app:offline');
  recordEnvironment();

  // On a phone a visit ends by being hidden far more often than by a proper unload.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leaveScreen(); flush(); }
  });
  window.addEventListener('pagehide', () => { leaveScreen(); flush(); });
}

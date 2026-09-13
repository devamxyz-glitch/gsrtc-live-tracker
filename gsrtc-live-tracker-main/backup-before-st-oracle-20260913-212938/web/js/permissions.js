/**
 * Asking for location and notifications, properly.
 *
 * A browser permission prompt is a one-shot. Tap Deny once and the API is dead for that
 * origin — `requestPermission()` returns "denied" forever without showing anything, and the
 * only way back is a settings screen most people cannot find. So the app must never fire a
 * native prompt cold: it explains what it wants and why, gets a yes *in its own UI*, and only
 * then spends the one chance it gets.
 *
 * When a permission is already blocked, the honest thing is not to keep asking — it is to
 * show exactly where to turn it back on, on that specific browser and platform.
 */

import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, esc, openSheet, closeSheet } from './ui.js';
import * as stats from './stats.js';

const ASKED_KEY = 'st.permissions.asked';

const ua = navigator.userAgent || '';
const isAndroid = /android/i.test(ua);
const isIOS = !isAndroid && (/iphone|ipad|ipod/i.test(ua)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isStandalone = () => matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

/* ------------------------------------------------------------------ state */

export function notificationState() {
  if (!('Notification' in window)) return 'unsupported';
  // iOS only exposes notifications to an installed PWA; asking in Safari throws.
  if (isIOS && !isStandalone()) return 'needs-install';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function locationState() {
  if (!('geolocation' in navigator)) return 'unsupported';
  if (!navigator.permissions?.query) return 'prompt';   // Safari: cannot know without asking
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;                                 // granted | denied | prompt
  } catch {
    return 'prompt';
  }
}

const asked = () => {
  try { return JSON.parse(localStorage.getItem(ASKED_KEY)) || {}; } catch { return {}; }
};
const markAsked = (name) => {
  try { localStorage.setItem(ASKED_KEY, JSON.stringify({ ...asked(), [name]: Date.now() })); }
  catch { /* private mode */ }
};

/* ------------------------------------------------------------------ requesting */

/**
 * Fires the real prompt. Must be called straight from a tap — browsers ignore a permission
 * request that is not tied to a user gesture, and some silently deny it.
 */
async function requestNotifications() {
  markAsked('notifications');
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

function requestLocation() {
  markAsked('location');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? 'denied' : 'prompt'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  });
}

/* ------------------------------------------------------------------ recovery */

/**
 * Where the switch actually is, for this browser. Vague advice ("check your settings") is
 * useless to someone who has already tapped the wrong thing once.
 */
export function recoverySteps(name) {
  const what = name === 'location' ? t('permLocation') : t('permNotifications');
  if (isIOS) {
    return isStandalone()
      ? t('fixIosApp', { what })
      : t('fixIosSafari', { what });
  }
  if (isAndroid) {
    return isStandalone() ? t('fixAndroidApp', { what }) : t('fixAndroidChrome', { what });
  }
  return t('fixDesktop', { what });
}

/* ------------------------------------------------------------------ the primer */

/**
 * Explains both permissions, then asks — one at a time, only for what is still missing.
 * Resolves once the sheet closes, with the final state of each.
 */
export async function openPrimer({ want = ['location', 'notifications'] } = {}) {
  const states = {
    location: await locationState(),
    notifications: notificationState(),
  };

  // Nothing to ask for: everything is granted, unsupported, or blocked beyond our reach.
  const actionable = want.filter((n) => states[n] === 'prompt');
  if (!actionable.length && !want.some((n) => states[n] === 'denied')) return states;

  const body = document.createElement('div');
  body.className = 'perm-sheet';
  const render = () => {
    body.innerHTML = `
      <p class="perm-intro">${esc(t('permIntro'))}</p>
      ${want.map((name) => card(name, states[name])).join('')}
      <button class="btn ghost block" data-perm-skip>${esc(t('permLater'))}</button>`;
  };

  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-perm-skip]')) return closeSheet();

    const ask = e.target.closest('[data-perm-ask]');
    if (!ask) return;
    const name = ask.dataset.permAsk;

    // Tell them where to look *before* the native prompt covers the screen.
    ask.disabled = true;
    ask.innerHTML = `${icon('info', 'i i-sm')}${esc(t('permWatchForPrompt'))}`;

    states[name] = name === 'location' ? await requestLocation() : await requestNotifications();
    render();
    if (want.every((n) => states[n] !== 'prompt')) setTimeout(closeSheet, 900);
  });

  render();
  stats.track('onboard:primer-shown');
  openSheet({ title: t('permTitle'), subtitle: t('permSubtitle'), body });
  return states;
}

function card(name, state) {
  const meta = name === 'location'
    ? { glyph: 'crosshair', title: t('permLocation'), why: t('permLocationWhy') }
    : { glyph: 'bell', title: t('permNotifications'), why: t('permNotificationsWhy') };

  const action = {
    granted: `<span class="perm-ok">${icon('check', 'i i-sm')}${esc(t('permGranted'))}</span>`,
    denied: `<div class="note warn perm-fix">${icon('alert', 'i i-sm')}<div>
        <strong>${esc(t('permBlocked'))}</strong><br>${esc(recoverySteps(name))}</div></div>`,
    'needs-install': `<div class="note perm-fix">${icon('download', 'i i-sm')}<div>${
      esc(t('permNeedsInstall'))}</div></div>`,
    unsupported: `<span class="perm-muted">${esc(t('permUnsupported'))}</span>`,
    prompt: `<button class="btn sm" data-perm-ask="${esc(name)}">${
      icon('check', 'i i-sm')}${esc(t('permAllow'))}</button>`,
  }[state] || '';

  return `<div class="perm-card${state === 'granted' ? ' on' : ''}">
    <span class="perm-glyph">${icon(meta.glyph)}</span>
    <span class="perm-body">
      <span class="perm-title">${esc(meta.title)}</span>
      <span class="perm-why">${esc(meta.why)}</span>
      ${action}
    </span>
  </div>`;
}

/**
 * Ensures one permission, priming first if it has never been asked for.
 *
 * Call this instead of the browser API anywhere a feature needs a permission — it is the
 * difference between "the app explained itself and I said yes" and "a box appeared and I
 * tapped Deny to make it go away".
 */
export async function ensure(name) {
  const state = name === 'location' ? await locationState() : notificationState();
  if (state !== 'prompt') return state;

  // Already asked once and still at 'prompt' means they dismissed it; go straight to the
  // native prompt rather than showing the same explanation twice.
  if (asked()[name]) {
    return name === 'location' ? requestLocation() : requestNotifications();
  }
  const after = await openPrimer({ want: [name] });
  return after[name];
}

export function shouldOfferPrimer() {
  const seen = asked();
  return !seen.location && !seen.notifications;
}

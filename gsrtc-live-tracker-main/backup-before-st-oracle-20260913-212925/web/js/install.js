/* "Add to Home Screen".
 *
 * Two different worlds:
 *   - Chrome/Android fires `beforeinstallprompt`, which we hold onto and fire on a tap.
 *   - iOS Safari has no install API at all, so the only honest option is to show the rider
 *     where the button is. And only Safari can do it — Chrome or Firefox on iOS cannot add
 *     to the home screen, so those users get told to open the site in Safari instead.
 *
 * Neither works over plain http beyond localhost, and iOS needs a real HTTPS origin.
 *
 * It asks once, politely: after the app has been used a little, never on first paint, and a
 * dismissal is remembered for weeks. A nagging install banner is how apps get closed.
 */

import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, esc, isSheetOpen } from './ui.js';
import * as stats from './stats.js';

const DISMISS_KEY = 'st.install.dismissed';
const DISMISS_DAYS = 21;
const SHOW_AFTER_MS = 12000;   // long enough not to ambush, short enough to still be there
const RETRY_MS = 4000;         // how often to re-check when something else owns the screen

let deferredPrompt = null;
let shown = false;
let timer = null;

const ua = navigator.userAgent || '';
const isAndroid = /android/i.test(ua);
// iPadOS reports itself as a Mac, so the touch-point check is the only way to catch an iPad.
const isIOS = !isAndroid && (/iphone|ipad|ipod/i.test(ua)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isIOSSafari = isIOS && !/crios|fxios|edgios|opios/i.test(ua);

// Chrome fires beforeinstallprompt once its own engagement heuristics are satisfied, which can
// be before the app finishes booting. Capturing it at module scope means it is never missed.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  scheduleBanner();
});

export function isInstalled() {
  return matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: minimal-ui)').matches
    || navigator.standalone === true;
}

/** True when there is any route to installing on this device. */
export function canInstall() {
  return !isInstalled() && (!!deferredPrompt || isIOS);
}

/** Exposed for debugging a device that is behaving unexpectedly. */
export function platform() {
  return { isAndroid, isIOS, isIOSSafari, hasPrompt: !!deferredPrompt, state: installState() };
}

function dismissedRecently() {
  const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
}

export function init() {
  if (isInstalled()) return;

  // Schedule regardless of platform. This used to wait for beforeinstallprompt, which Chrome
  // withholds on its own engagement heuristics and may never fire — so Android and desktop
  // users simply never saw the banner. `actionFor(installState())` already adapts: a real
  // Install button if the prompt has arrived by then, the browser-menu route if it has not.
  scheduleBanner();

  window.addEventListener('appinstalled', async () => {
    deferredPrompt = null;
    hide();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    // The only place the primer is offered. Installing is the first moment notifications can
    // be granted at all on iOS, and the moment the app has most earned the right to ask.
    const permissions = await import('./permissions.js');
    if (permissions.shouldOfferPrimer()) setTimeout(() => permissions.openPrimer(), 1200);
  });

}

function scheduleBanner() {
  if (shown || timer || dismissedRecently() || isInstalled()) return;
  timer = setTimeout(() => { timer = null; show(); }, SHOW_AFTER_MS);
}

/** Opens the prompt straight away — used by the Settings screen's button. */
export async function promptNow() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    // Chrome allows one use per event. Dropping it is correct; the browser fires a fresh one
    // if the user declines and stays eligible.
    deferredPrompt = null;
    if (outcome === 'accepted') { stats.track('onboard:install-accepted'); hide(); }
    return outcome;
  }
  show(true);   // no live prompt: show whatever this platform's route actually is
  return 'instructions';
}

/**
 * True when something modal already has the rider's attention — the walkthrough, the permission
 * primer, or any other sheet.
 */
function somethingElseIsAsking() {
  return isSheetOpen() || document.body.classList.contains('tour-open');
}

export function show(force = false) {
  if (isInstalled() || (!force && (shown || dismissedRecently()))) return;

  // The banner used to arrive purely on a timer, so it landed on top of the permission primer
  // and covered its Allow button: the rider was asked two things at once and could not finish
  // answering either. Wait for a free screen rather than dropping the banner altogether —
  // whatever is open now is the more important question, and this one keeps.
  if (!force && somethingElseIsAsking()) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; show(); }, RETRY_MS);
    return;
  }

  shown = true;
  stats.track('onboard:install-shown');

  const host = $('#install-banner');
  host.innerHTML = card(actionFor(installState()));
  host.classList.add('on');
  host.addEventListener('click', onClick);
}

/**
 * What to offer, decided by the platform.
 *
 * This used to be `deferredPrompt ? android : ios`, which quietly told Android users to open
 * the page in Safari: on Android the prompt is null until Chrome decides to fire it, and null
 * again once it has been used, and both cases fell through to the iOS branch.
 */
function actionFor(state) {
  switch (state) {
    case 'available':
      return `<button class="btn sm" data-act="install">${
        icon('download', 'i i-sm')}${esc(t('install'))}</button>`;
    case 'ios':
      return `<span class="ib-steps">${esc(t('iosStep1'))} ${
        icon('share', 'i i-sm')} ${esc(t('iosStep2'))}</span>`;
    case 'ios-wrong-browser':
      // Chrome and Firefox on iOS genuinely cannot add to the home screen.
      return `<span class="ib-steps">${esc(t('iosOpenInSafari'))}</span>`;
    default:
      // Android without a live prompt, plus desktop and every other browser: the option lives
      // in the browser's own menu.
      return `<span class="ib-steps">${esc(t('installMenuHint'))}</span>`;
  }
}

function card(action) {
  return `<div class="install-card" role="dialog" aria-label="${esc(t('installTitle'))}">
    <span class="ib-icon">${icon('download')}</span>
    <span class="ib-body">
      <span class="ib-title">${esc(t('installTitle'))}</span>
      <span class="ib-sub">${esc(t('installBody'))}</span>
      ${action}
    </span>
    <button class="iconbtn ib-close" data-act="dismiss"
      aria-label="${esc(t('close'))}">${icon('x')}</button>
  </div>`;
}

function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'dismiss') {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    hide();
  }
  if (act === 'install') promptNow();
}

function hide() {
  shown = false;
  const host = $('#install-banner');
  host.classList.remove('on');
  setTimeout(() => { if (!host.classList.contains('on')) host.innerHTML = ''; }, 250);
}

/** For Settings: what this device can actually be told. */
export function installState() {
  if (isInstalled()) return 'installed';
  if (deferredPrompt) return 'available';
  if (isIOS) return isIOSSafari ? 'ios' : 'ios-wrong-browser';
  return 'menu';   // Android with no live prompt, desktop, anything else
}

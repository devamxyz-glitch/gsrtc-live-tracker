/* App shell: appearance, navigation, deep links, offline handling, service worker. */

import { icon } from './icons.js';
import { t, setLang, detectLang } from './i18n.js';
import * as store from './store.js';
import { on, emit } from './events.js';
import { $, $$, esc, closeSheet, isSheetOpen, toast } from './ui.js';
import { refreshTiles } from './map.js';

import * as home from './home.js';
import * as track from './track.js';
import * as routes from './routes.js';
import * as nearby from './nearby.js';
import * as settings from './settings.js';
import * as stats from './stats.js';
import * as trip from './trip.js';
import * as install from './install.js';

const SCREENS = { home, track, routes, nearby, settings };
const TABS = ['home', 'track', 'routes', 'nearby'];
let current = 'home';

/* ------------------------------------------------------------------ appearance */
const media = matchMedia('(prefers-color-scheme: dark)');

function applyAppearance() {
  const s = store.settings.get();
  const theme = s.theme === 'system' ? (media.matches ? 'dark' : 'light') : s.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.text = s.text;
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  $('meta[name="theme-color"]').setAttribute('content', bar || (theme === 'dark' ? '#111a2c' : '#ffffff'));
  refreshTiles();
}
media.addEventListener('change', () => { if (store.settings.get().theme === 'system') applyAppearance(); });

function applyLanguage() {
  const s = store.settings.get();
  setLang(s.lang || detectLang());
  paintStaticText();
}

/** Text that lives in index.html rather than inside a screen's render function. */
function paintStaticText() {
  document.title = `${t('appName')} — ${t('tagline')}`;
  $('#app-title').textContent = t('appName');
  $('#app-sub').textContent = t('tagline');
  $('#plate').placeholder = t('platePlaceholder');
  $('#plate').setAttribute('aria-label', t('plateLabel'));
  $('#track-go').textContent = t('track');
  $('#pnr').placeholder = t('pnrPlaceholder');
  $('#pnr').setAttribute('aria-label', t('pnrLabel'));
  $('#pnr-go').textContent = t('lookup');
  $('#from').placeholder = t('fromPlaceholder');
  $('#from').setAttribute('aria-label', t('from'));
  $('#to').placeholder = t('toPlaceholder');
  $('#to').setAttribute('aria-label', t('to'));
  $('#find').textContent = t('findBuses');
  $('#date').setAttribute('aria-label', t('date'));
  $('#route-swap').setAttribute('aria-label', t('swap'));
  $('#locate').innerHTML = icon('crosshair', 'i i-sm') + esc(t('useLocation'));
  $('#nearby-title').textContent = t('nearbyT');
  $('#settings-btn').setAttribute('aria-label', t('settings'));
  $('#sheet-close').setAttribute('aria-label', t('close'));
  $('#offline-bar').textContent = t('offline');
  TABS.forEach((name) => {
    const cap = $(`.tabbar button[data-screen="${name}"] .cap`);
    if (cap) cap.textContent = t(`nav${name[0].toUpperCase()}${name.slice(1)}`);
  });
}

/* ------------------------------------------------------------------ navigation */
function go(name, { push = true } = {}) {
  if (!SCREENS[name]) return;
  // Re-showing the current screen still counts as a view — and crucially, the very first
  // `go('home')` on boot lands here, because `current` already starts as 'home'. Without this
  // the opening screen was never recorded at all, so "where people start" showed Track for
  // everyone and Home for nobody.
  if (name === current) { SCREENS[name].onShow?.(); stats.track(`screen:${name}`); stats.enterScreen(name); return; }
  SCREENS[current]?.onHide?.();
  current = name;
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === `s-${name}`));
  $$('.tabbar button').forEach((b) => {
    const on = b.dataset.screen === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  $('#settings-btn').classList.toggle('on', name === 'settings');
  document.querySelector('.wrap').scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  SCREENS[name].onShow?.();
  stats.track(`screen:${name}`);
  stats.enterScreen(name);
  if (push) history.pushState({ screen: name }, '', screenUrl(name));
}

function screenUrl(name) {
  const url = new URL(location.href);
  url.hash = name === 'home' ? '' : `#${name}`;
  return url.toString();
}

window.addEventListener('popstate', (e) => {
  if (isSheetOpen()) { closeSheet(); history.pushState({ screen: current }, '', screenUrl(current)); return; }
  const name = e.state?.screen || (location.hash.slice(1) || 'home');
  go(SCREENS[name] ? name : 'home', { push: false });
});

/* ------------------------------------------------------------------ boot */
const START_AT = performance.now();

function boot() {
  applyLanguage();
  applyAppearance();

  Object.values(SCREENS).forEach((s) => s.init?.());

  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.screen)));
  $('#settings-btn').addEventListener('click', () => go(current === 'settings' ? 'home' : 'settings'));

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isSheetOpen()) closeSheet(); });

  on('nav', (name) => go(name));
  on('track', (plate, ctx) => { track.start(plate, ctx); go('track'); });
  on('set-stations', (stations, auto) => { routes.setStations(stations, auto); go('routes'); });
  on('open-trip', (payload) => trip.open(
    { ...payload, myStopIndex: track.targetStopIndex() },
    (stop) => track.setStopAlert(stop),
  ));
  on('lang-changed', () => { paintStaticText(); home.invalidate(); SCREENS[current].onShow?.(); });
  on('appearance-changed', applyAppearance);
  on('data-cleared', () => { home.invalidate(); applyAppearance(); applyLanguage(); });

  window.addEventListener('online', () => { $('#offline-bar').classList.remove('on'); SCREENS[current].onShow?.(); });
  window.addEventListener('offline', () => $('#offline-bar').classList.add('on'));
  if (!navigator.onLine) $('#offline-bar').classList.add('on');

  handleDeepLink();
  registerServiceWorker();
  install.init();
  dismissSplash();
  maybeOnboard();
}

/**
 * Opens whatever the URL asked for: a bus, a route, or a screen.
 *
 * Also decides how the session began, before anything else is recorded — a shared link that
 * works is the difference between the app spreading and not, and there is no other way to see
 * it. `replaceState` rather than push, so Back leaves the app instead of returning to a
 * parameterised URL the rider never chose to visit.
 */
function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const plate = params.get('plate');
  const from = params.get('from');
  const to = params.get('to');
  const hash = location.hash.slice(1);

  stats.init(hash === 'settings' && document.referrer === '' ? 'entry:notification'
    : plate ? 'entry:deep-link-plate'
      : from ? 'entry:deep-link-route' : 'entry:direct');

  if (plate) {
    history.replaceState({ screen: 'track' }, '', `${location.pathname}#track`);
    go('track', { push: false });
    track.start(plate);
    return;
  }

  if (from && to) {
    history.replaceState({ screen: 'routes' }, '', `${location.pathname}#routes`);
    go('routes', { push: false });
    routes.setStations({
      fromId: from, fromName: params.get('fromName') || from,
      toId: to, toName: params.get('toName') || to,
    }, true);
    return;
  }

  const start = SCREENS[hash] ? hash : 'home';
  history.replaceState({ screen: start }, '', screenUrl(start));
  go(start, { push: false });
}

/**
 * Takes the boot splash down once the first screen is actually rendered.
 *
 * A minimum on screen, not just a fade: a splash that flashes for 80ms on a warm load reads as
 * a glitch rather than as a brand, and the app is not ready to be *looked* at any sooner than
 * it is ready to be used. The CSS carries its own fallback timer, so this failing to run costs
 * a few hundred milliseconds rather than leaving the app behind a permanent logo.
 */
function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const MIN_MS = 550;
  const wait = Math.max(0, MIN_MS - (performance.now() - START_AT));
  setTimeout(() => {
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 400);
  }, wait);
}

/**
 * Onboarding, in the order the permissions actually work.
 *
 * Install first, permissions second — and only once installed. On iOS notifications simply do
 * not exist until the app is on the home screen, so asking before that is asking for something
 * that cannot be granted; and a browser permission is a one-shot, where a single Deny kills the
 * API for the origin for good. Spending that one chance while the answer cannot stick is the
 * worst possible order.
 *
 * The walkthrough is switched off for now. It was reaching 40 devices and only 18 finished it,
 * with 19 explicitly skipping — a tour that more than half the people abandon is in the way,
 * not helping. It stays replayable from Settings for anyone who wants it.
 */
function maybeOnboard() {
  const params = new URLSearchParams(location.search);
  // Someone following a link to a specific bus wants that bus, not an introduction.
  if (params.get('plate') || params.get('from')) return;

  const installed = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  if (!installed) return;   // install.js owns the prompt; permissions wait for it to succeed

  setTimeout(async () => {
    const permissions = await import('./permissions.js');
    if (permissions.shouldOfferPrimer()) permissions.openPrimer();
  }, 2500);
}

/**
 * Keeping every rider on the current build.
 *
 * Three things have to be true, and only the first two are ours.
 *
 * **The script URL has to change.** `sw.js` is fetched by the browser like any other file, and
 * Cloudflare rewrites our `no-cache` to `max-age=14400` on the way out — so a browser will sit
 * on a four-hour-old service worker and never learn there is a new one. `index.html` is still
 * served `no-cache`, and it points at `js/app.js?v=<version>`, so the *app* updates promptly on
 * a release; it is the worker that goes stale. Registering it under the same version stamp makes
 * every release a new URL, which is a guaranteed update check rather than a cached miss.
 *
 * **Something has to ask.** Browsers only check for a new worker on navigation, and an installed
 * PWA that is never fully closed may not navigate for days. So we ask on the way back in, which
 * is when a commuter opens it for the evening bus.
 *
 * **And the page has to actually reload**, because `skipWaiting()` means the new worker takes
 * over a page still running the old code. Not mid-journey though: someone watching their bus
 * approach should not have the screen pulled out from under them, so it waits for them to leave
 * and come back, and offers the toast in the meantime.
 */
const SW_VERSION = new URL(import.meta.url).searchParams.get('v') || '';
const UPDATE_CHECK_MS = 15 * 60 * 1000;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const url = SW_VERSION ? `sw.js?v=${encodeURIComponent(SW_VERSION)}` : 'sw.js';

  navigator.serviceWorker.register(url).then((reg) => {
    let pending = false;
    let lastCheck = Date.now();

    const applyWhenSafe = () => {
      if (!pending) return;
      // A reload during tracking loses the rider their live map for no reason they asked for.
      if (track.isActive?.()) return;
      pending = false;
      location.reload();
    };

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          pending = true;
          toast(t('updateReady'), 'refresh');
        }
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      applyWhenSafe();
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => { /* offline, or the check was throttled — try again later */ });
    });
  }).catch(() => { /* offline support is a bonus, never a blocker */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/**
 * First-run walkthrough.
 *
 * Not a carousel of screenshots. Each step navigates to the screen it is describing, spotlights
 * the actual element on it, and puts the explanation next to that element — so what someone
 * learns is *where the thing is*, not that a feature exists in the abstract.
 *
 * Skippable at every step, replayable from Settings, and it never runs twice on its own. It
 * ends by offering the permission primer, because that is the point at which the app has
 * explained why it would want them.
 */

import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, esc } from './ui.js';
import { emit } from './events.js';
import * as stats from './stats.js';

const SEEN_KEY = 'st.tour.seen';
const SETTLE_MS = 420;            // let a screen change finish before measuring anything

let steps = [];
let index = 0;
let active = false;
let onFinish = null;

/**
 * Each step names a screen and a selector. `optional` steps are skipped when their element is
 * not on screen — the Track card does not exist until a bus is being tracked, and a tour that
 * points at nothing is worse than one that is a step shorter.
 */
function buildSteps() {
  return [
    {
      screen: 'home', target: null,
      title: t('tourWelcomeTitle'), body: t('tourWelcomeBody'), cta: t('tourStart'),
    },
    {
      screen: 'home', target: '#home-body .sec-title', optional: true,
      title: t('tourHomeTitle'), body: t('tourHomeBody'),
    },
    {
      screen: 'track', target: '#plate',
      title: t('tourTrackTitle'), body: t('tourTrackBody'),
    },
    {
      screen: 'track', target: '#map-fabs',
      title: t('tourMapTitle'), body: t('tourMapBody'),
    },
    {
      screen: 'routes', target: '#s-routes .od',
      title: t('tourRoutesTitle'), body: t('tourRoutesBody'),
    },
    {
      screen: 'routes', target: '#routes-filters [data-view]', optional: true,
      title: t('tourMapViewTitle'), body: t('tourMapViewBody'),
    },
    {
      screen: 'nearby', target: '#locate',
      title: t('tourNearbyTitle'), body: t('tourNearbyBody'),
    },
    {
      // The gear, not the settings page itself: what someone needs to remember is where the
      // door is. Targeting #settings-body spotlighted a 1951px scroll container.
      screen: 'settings', target: '#settings-btn',
      title: t('tourSettingsTitle'), body: t('tourSettingsBody'), cta: t('tourFinish'),
    },
  ];
}

export function hasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
}

export function start({ onDone } = {}) {
  if (active) return;
  active = true;
  index = 0;
  steps = buildSteps();
  onFinish = onDone || null;
  document.body.classList.add('tour-open');
  stats.track('onboard:tour-start');
  ensureLayer();
  show();
}

export function end({ completed = false } = {}) {
  if (!active) return;
  active = false;
  markSeen();
  document.body.classList.remove('tour-open');
  $('#tour')?.remove();
  stats.track(completed ? 'onboard:tour-done' : 'onboard:tour-skip');
  const done = onFinish; onFinish = null;
  done?.(completed);
}

function ensureLayer() {
  if ($('#tour')) return;
  const layer = document.createElement('div');
  layer.id = 'tour';
  layer.innerHTML = `
    <div class="tour-scrim"></div>
    <div class="tour-ring" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title"></div>`;
  document.body.append(layer);

  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-tour="next"]')) return next();
    if (e.target.closest('[data-tour="back"]')) return back();
    if (e.target.closest('[data-tour="skip"]')) return end({ completed: false });
  });
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') end({ completed: false });
  if (e.key === 'ArrowRight' || e.key === 'Enter') next();
  if (e.key === 'ArrowLeft') back();
}

const next = () => { if (index >= steps.length - 1) end({ completed: true }); else { index += 1; show(); } };
const back = () => { if (index > 0) { index -= 1; show(); } };

async function show() {
  const step = steps[index];
  if (!step) return end({ completed: true });

  emit('nav', step.screen);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  if (!active) return;

  const target = step.target ? $(step.target) : null;
  if (step.target && !target && step.optional) {
    // Nothing to point at — move on rather than spotlight empty space.
    return index >= steps.length - 1 ? end({ completed: true }) : (index += 1, show());
  }

  if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await new Promise((r) => setTimeout(r, target ? 300 : 0));
  if (!active) return;

  paint(step, target);
}

function paint(step, target) {
  const ring = $('#tour .tour-ring');
  const card = $('#tour .tour-card');

  // A spotlight bigger than the screen is not a spotlight. Anything that large gets no ring
  // rather than a ring nobody can see the edges of.
  const rect = target?.getBoundingClientRect();
  const spotlightable = rect && rect.height < window.innerHeight * 0.7 && rect.width > 8;

  if (spotlightable) {
    const r = rect;
    const pad = 8;
    ring.hidden = false;
    ring.style.cssText = `top:${r.top - pad}px;left:${r.left - pad}px;`
      + `width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
  } else {
    ring.hidden = true;
  }

  card.innerHTML = `
    <div class="tour-progress">${steps.map((_, i) =>
    `<span class="${i === index ? 'on' : ''}"></span>`).join('')}</div>
    <h2 id="tour-title">${esc(step.title)}</h2>
    <p>${esc(step.body)}</p>
    <div class="tour-actions">
      <button class="btn quiet" data-tour="skip">${esc(t('tourSkip'))}</button>
      <span class="grow"></span>
      ${index > 0 ? `<button class="btn ghost sm" data-tour="back">${esc(t('back'))}</button>` : ''}
      <button class="btn sm" data-tour="next">${
        esc(step.cta || t('tourNext'))}${icon('right', 'i i-sm')}</button>
    </div>`;

  // Keep the card clear of the thing it is describing.
  card.classList.toggle('at-top', Boolean(spotlightable) && rect.top > window.innerHeight / 2);
}

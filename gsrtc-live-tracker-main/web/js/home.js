/* Home is the morning board: the trips you make every day and the buses you follow,
   already answered before you ask. Everything here is one tap from live tracking.

   It also reads the clock. A commuter's saved trip runs one way in the morning and the other
   way home, so after midday the card shows the return direction — labelled, never silently. */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, localName } from './i18n.js';
import * as store from './store.js';
import { emit } from './events.js';
import {
  $, esc, clean, untilDeparture, ymd, toast, emptyState, skeletons, autocomplete,
} from './ui.js';
import * as status from './status.js';
import * as stats from './stats.js';

const FRESH_MS = 60000;
const AUTO_REFRESH_MS = 60000;
const MAX_LIVE_LOOKUPS = 6;

const departures = new Map();          // directionKey -> { at, rows, error }
const statuses = new Map();            // plate -> { at, row }
const directionOverrides = new Map();  // commuteId -> 'forward' | 'reverse'
let loading = false;
let autoTimer = null;
let visible = false;

export function init() {
  $('#home-body').addEventListener('click', onClick);

  // The same track box as the Track screen. Home was previously nothing but empty-state cards
  // for things a new rider had not done yet, while the thing they opened the app to do sat
  // behind a tab — and the numbers said most sessions began by going straight there.
  const plate = $('#home-plate');
  autocomplete(plate, $('#home-plate-ac'), {
    fetcher: (q) => api.plates(q),
    render: (r) => `<span class="num">${esc(r.plate)}</span>`
      + (r.depot ? `<span class="t2">${esc(r.depot)}</span>` : ''),
    onPick: (r) => trackFromHome(r.plate),
  });
  $('#home-track-go').addEventListener('click', () => trackFromHome(plate.value));
  plate.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#home-plate-ac').getAttribute('aria-expanded') !== 'true') {
      trackFromHome(plate.value);
    }
  });

  status.init();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) refresh(false);
  });
  render();
}

export function onShow() {
  visible = true;
  render();
  refresh(false);
  startAutoRefresh();
}

export function onHide() {
  visible = false;
  clearInterval(autoTimer);
  autoTimer = null;
}

/** Automatic: keep the board current while it is on screen, and stop the moment it is not. */
function startAutoRefresh() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if (visible && !document.hidden) refresh(true);
  }, AUTO_REFRESH_MS);
}

/* ------------------------------------------------------------------ direction */
/**
 * A commute is shown the way it was saved, unless the rider flips it.
 *
 * It used to reverse itself after 14:00 on the theory that a commuter goes one way in the
 * morning and back in the evening. That guess was wrong in two ways at once. It silently
 * reversed a direction somebody had explicitly chosen, and it labelled the result "Return" from
 * the clock alone — so a rider with both directions saved saw two cards, pointing opposite
 * ways, each claiming to be the return journey. Neither claim was checked against anything.
 *
 * Anyone who wants the other direction can save it or tap swap; both are one action, and both
 * are the rider's decision rather than the app's assumption.
 */
function activeDirection(commute) {
  return directionOverrides.get(commute.id) || 'forward';
}

function resolve(commute) {
  const reversed = activeDirection(commute) === 'reverse';
  return {
    key: `${commute.id}:${reversed ? 'r' : 'f'}`,
    reversed,
    fromId: reversed ? commute.toId : commute.fromId,
    fromName: reversed ? commute.toName : commute.fromName,
    fromGu: reversed ? commute.toGu : commute.fromGu,
    toId: reversed ? commute.fromId : commute.toId,
    toName: reversed ? commute.fromName : commute.toName,
    toGu: reversed ? commute.fromGu : commute.toGu,
  };
}

/* ------------------------------------------------------------------ data */
async function refresh(force) {
  if (loading) return;
  loading = true;
  try {
    const jobs = [];
    for (const commute of store.commutes.list().slice(0, 4)) {
      const leg = resolve(commute);
      const cached = departures.get(leg.key);
      if (force || !cached || Date.now() - cached.at > FRESH_MS) jobs.push(loadDepartures(leg));
    }
    for (const bus of store.buses.list().slice(0, MAX_LIVE_LOOKUPS)) {
      const cached = statuses.get(bus.plate);
      if (force || !cached || Date.now() - cached.at > FRESH_MS) jobs.push(loadStatus(bus.plate));
    }
    if (jobs.length) render();
    await Promise.allSettled(jobs);
    render();   // the countdowns move even when the data does not
  } finally {
    loading = false;
  }
}

async function loadDepartures(leg) {
  try {
    const rows = await api.timetable({ from: leg.fromId, to: leg.toId, date: ymd(), pageSize: 60 });
    departures.set(leg.key, { at: Date.now(), rows });
  } catch (e) {
    departures.set(leg.key, { at: Date.now(), rows: [], error: e });
  }
}

async function loadStatus(plate) {
  try {
    const { vehicle } = await api.vehicle(plate);
    statuses.set(plate, { at: Date.now(), row: vehicle });
  } catch {
    statuses.set(plate, { at: Date.now(), row: null, error: true });
  }
}

/* ------------------------------------------------------------------ render */
function render() {
  $('#home-body').innerHTML = [
    frequentSection(store.recents.frequentPlates()),
    commuteSection(store.commutes.list()),
    busSection(store.buses.list()),
    recentSection(store.recents.plates(), store.buses.list()),
  ].filter(Boolean).join('');
}

/**
 * A one-line empty state.
 *
 * The full-height version is right when a screen has a single empty section to explain. Home
 * has two at once, and stacked they pushed everything real below the fold on a first run —
 * a screen that is mostly instructions about what is missing.
 */
function miniEmpty(glyph, title, body, act, label, actIcon) {
  return `<div class="card mini-empty">
    <span class="me-glyph">${icon(glyph)}</span>
    <span class="me-body">
      <span class="me-title">${esc(title)}</span>
      <span class="me-text">${esc(body)}</span>
    </span>
    ${act ? `<button class="btn ghost sm" data-act="${esc(act)}">${
    icon(actIcon, 'i i-sm')}${esc(label)}</button>` : ''}
  </div>`;
}

/**
 * The buses this phone keeps coming back to, above everything else.
 *
 * Five plates account for nearly half of all lookups in the app, and `act:save` was going
 * unused — people were typing the same number in every morning instead. This needs no server
 * data and no saving: the phone already knows, from its own history.
 */
function frequentSection(frequent) {
  if (!frequent.length) return '';
  return `<div class="sec-title">${esc(t('yourBuses'))}</div>
    <div class="chips">${frequent.map((r) =>
    `<button class="chip strong" data-act="track" data-plate="${esc(r.plate)}">
       ${icon('bus', 'i i-sm')}<span class="num">${esc(r.plate)}</span>
       <span class="chip-n">${r.count}\u00d7</span>
     </button>`).join('')}</div>`;
}

function commuteSection(commutes) {
  // The header action only appears once there is a list to add to. While the section is empty
  // the card below already carries an Add commute button, and showing both put two identical
  // calls to action a centimetre apart.
  const header = `<div class="sec-title">${esc(t('yourCommutes'))}
    ${commutes.length
    ? `<button class="act" data-act="add-commute">${icon('plus', 'i i-sm')}${esc(t('addCommute'))}</button>`
    : ''}</div>`;

  if (!commutes.length) {
    // A compact row, not a full-height empty card. Two of those stacked filled a first-time
    // home screen with nothing but placeholders for things the rider had not done yet.
    return header + miniEmpty('route', t('noCommutesT'), t('noCommutesB'),
      'add-commute', t('addCommute'), 'plus');
  }

  return header + commutes.map((commute) => {
    const leg = resolve(commute);
    const data = departures.get(leg.key);
    const next = data ? nextThree(data.rows) : null;
    return `<div class="card commute">
      <div class="commute-head">
        <button class="grow commute-title" data-act="open-commute" data-id="${esc(commute.id)}">
          <span class="legs">${esc(localName(leg.fromName, leg.fromGu))}
            ${icon('arrowRight', 'i i-sm')}${esc(localName(leg.toName, leg.toGu))}</span>
          <span class="when">${esc(t('nextDepartures'))}${
  leg.reversed ? ` · ${esc(t('swapped'))}` : ''}</span>
        </button>
        <button class="iconbtn" data-act="flip" data-id="${esc(commute.id)}"
          title="${esc(t('otherDirection'))}" aria-label="${esc(t('otherDirection'))}">${icon('swap')}</button>
        <button class="iconbtn" data-act="drop-commute" data-id="${esc(commute.id)}"
          title="${esc(t('remove'))}" aria-label="${esc(t('remove'))}">${icon('trash')}</button>
      </div>
      ${!data ? `<div class="pad-3">${skeletons(2)}</div>`
        : !next?.length ? `<div class="kv"><span class="k">${esc(t('noBuses'))}</span><span class="v"></span></div>`
          : next.map(depRow).join('')}
    </div>`;
  }).join('');
}

/**
 * The next three you could actually catch, soonest first.
 *
 * "Running" alone is not a reason to rank a service highly — a bus that left your stop
 * an hour ago is running and useless. Anything more than ten minutes gone is dropped.
 */
function nextThree(rows) {
  return rows
    .map((row) => ({ row, when: untilDeparture(row.ArrivalTime) }))
    .filter((entry) => entry.when && entry.when.minutes >= -10)
    .sort((a, b) => a.when.minutes - b.when.minutes)
    .slice(0, 3)
    .map((entry) => entry.row);
}

function depRow(row) {
  const running = /run|progress|depart/i.test(clean(row.BusRunningStatus));
  const service = clean(row.ServiceType) || clean(row.BusServiceType);
  const when = untilDeparture(row.ArrivalTime);
  const trip = JSON.stringify({
    tripId: clean(row.TripId), status: running ? 1 : 0,
    start: clean(row.ArrivalTimeAtBoarding), route: clean(row.RouteName),
  });

  return `<button class="kv kv-btn" data-act="track" data-plate="${esc(clean(row.BusNo))}"
      data-trip='${esc(trip)}'>
    <span class="k dep">
      ${running ? '<span class="live-dot" aria-hidden="true"></span>' : '<span class="live-dot off" aria-hidden="true"></span>'}
      <span class="dep-bus">
        <span class="num plate-sm">${esc(clean(row.BusNo) || '—')}</span>
        ${service ? `<span class="dep-service"> · ${esc(service)}</span>` : ''}
        <span class="sr-only">${esc(running ? t('running') : t('scheduled'))}</span></span>
    </span>
    <span class="v dep-when">
      <span class="num">${esc(clean(row.ArrivalTime) || '—')}</span>
      ${when ? `<span class="small num ${esc(when.state)}">${esc(when.label)}</span>` : ''}
    </span>
  </button>`;
}

function busSection(buses) {
  const header = `<div class="sec-title">${esc(t('savedBuses'))}</div>`;
  if (!buses.length) {
    return header + miniEmpty('star', t('noSavedT'), t('noSavedB'));
  }
  return header + buses.map((bus) => {
    const status = statuses.get(bus.plate);
    const row = status?.row;
    const lat = parseFloat(row?.Latitude), lng = parseFloat(row?.Longitude);
    const live = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
    const detail = row
      ? [clean(row.NextLocation) && `${t('nextStop')}: ${clean(row.NextLocation)}`, clean(row.RouteName)]
        .filter(Boolean)[0]
      : '';
    return `<button class="tile" data-act="track" data-plate="${esc(bus.plate)}">
      <span class="glyph${live ? ' live' : ''}">${icon('bus', 'i i-sm')}</span>
      <span class="body">
        <span class="t1 num">${esc(bus.plate)}</span>
        <span class="t2">${esc(detail || [clean(bus.depot), clean(bus.division)].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="end">
        ${!status ? `<span class="small">${esc(t('checking'))}</span>`
          : `<span class="badge ${live ? 'live' : 'warn'}">${live ? '<span class="dot"></span>' : ''}${
            esc(live ? t('live') : t('noFix'))}</span>`}
        ${icon('right', 'i i-sm')}
      </span>
    </button>`;
  }).join('');
}

function recentSection(recent, buses) {
  const frequent = new Set(store.recents.frequentPlates().map((r) => r.plate));
  const list = recent
    .filter((r) => !buses.some((b) => b.plate === r.plate) && !frequent.has(r.plate))
    .slice(0, 6);
  if (!list.length) return '';

  // Removable one at a time rather than hidden as a block. The list fills itself in without
  // being asked, so the useful control is "not that one" — hiding the lot also loses the
  // entries the rider did want.
  return `<div class="sec-title">${esc(t('recent'))}</div>
    <div class="chips">${list.map((r) =>
    `<span class="chip removable">
       <button class="chip-main" data-act="track" data-plate="${esc(r.plate)}">${
  icon('clock', 'i i-sm')}<span class="num">${esc(r.plate)}</span></button>
       <button class="chip-x" data-act="forget-recent" data-plate="${esc(r.plate)}"
         aria-label="${esc(t('removeRecent'))} ${esc(r.plate)}">${icon('x', 'i i-sm')}</button>
     </span>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ events */
function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id, plate } = btn.dataset;

  if (act === 'forget-recent' && plate) {
    store.recents.removePlate(plate);
    return render();
  }

  if (act === 'track' && plate) {
    let trip = null;
    try { trip = btn.dataset.trip ? JSON.parse(btn.dataset.trip) : null; } catch { /* ignore */ }
    return emit('track', plate, trip ? { trip } : null);
  }
  if (act === 'add-commute') return emit('nav', 'routes');
  if (act === 'open-commute') {
    const commute = store.commutes.list().find((c) => c.id === id);
    if (commute) emit('set-stations', resolve(commute), true);
    return;
  }
  if (act === 'flip') {
    // Overrides the clock's guess for this session without rewriting what was saved.
    const commute = store.commutes.list().find((c) => c.id === id);
    if (!commute) return;
    directionOverrides.set(id, activeDirection(commute) === 'reverse' ? 'forward' : 'reverse');
    render();
    refresh(false);
    return;
  }
  if (act === 'drop-commute') {
    store.commutes.remove(id);
    directionOverrides.delete(id);
    toast(t('remove'), 'trash');
    render();
  }
}

function trackFromHome(value) {
  const wanted = (value || '').trim();
  if (!wanted) return;
  stats.track('act:track-from-home');
  $('#home-plate').value = '';
  emit('track', wanted, null);
}

export function invalidate() { departures.clear(); statuses.clear(); }

/* Routes screen: every bus between two stations on a date, with the filters a commuter
   reaches for first — running now, service class, and how to order the list. */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, localName, getLang, occupancyLabel } from './i18n.js';
import * as store from './store.js';
import { emit } from './events.js';
import * as stats from './stats.js';
import * as routemap from './routemap.js';
import {
  $, esc, clean, duration, timeToMinutes, untilDeparture, ymd,
  toast, autocomplete, emptyState, errorState, skeletons,
} from './ui.js';

const PAGE_SIZE = 80;

let serviceTypes = [];
let filter = { type: '0', runningOnly: false, departedOnly: false, sort: 'time' };
let results = [];
let totalPages = 1;
let page = 1;
let lastQuery = null;
let busy = false;
let view = 'list';   // 'list' | 'map'
let crowd = {};      // plate -> what riders have said, for the rows on screen

export function init() {
  stationField('#from', '#from-ac');
  stationField('#to', '#to-ac');

  $('#date').value = ymd();
  $('#date').min = ymd(new Date(Date.now() - 86400000));

  $('#route-swap').addEventListener('click', swap);
  $('#find').addEventListener('click', () => search({ reset: true }));
  $('#routes-filters').addEventListener('click', onFilterClick);
  $('#routes-results').addEventListener('click', onResultClick);
  // Leaflet renders popups outside the results container, so catch their taps at the screen.
  $('#s-routes').addEventListener('click', (e) => {
    if (view === 'map' && e.target.closest('[data-track-plate]')) routemap.handleClick(e);
  });

  loadServiceTypes();
  renderFilters();
  renderIdle();
}

export function onShow() {
  if (view === 'map') return routemap.onShow();
  renderIdle(true);
}

export function onHide() { routemap.onHide(); }

function stationField(inputSel, popSel) {
  const input = $(inputSel);
  autocomplete(input, $(popSel), {
    fetcher: (q) => api.stations(q),
    render: (s) => `<span class="glyph">${icon('signpost', 'i i-sm')}</span>
      <span class="grow"><span class="t1">${esc(s.StationName)}</span>
      <span class="t2">${esc([clean(s.StationNameGuj), clean(s.CityName)].filter(Boolean).join(' · '))}</span></span>`,
    onPick: (s) => {
      input.value = localName(s.StationName, s.StationNameGuj);
      input.dataset.val = s.StationId;
      input.dataset.en = s.StationName;
      input.dataset.gu = s.StationNameGuj || '';
      if ($('#from').dataset.val && $('#to').dataset.val) search({ reset: true });
    },
  });
}

function swap() {
  const a = $('#from'), b = $('#to');
  for (const key of ['value']) { const tmp = a[key]; a[key] = b[key]; b[key] = tmp; }
  for (const key of ['val', 'en', 'gu']) {
    const tmp = a.dataset[key] || ''; a.dataset[key] = b.dataset[key] || ''; b.dataset[key] = tmp;
  }
  if (a.dataset.val && b.dataset.val) search({ reset: true });
}

/** Fills the two fields from outside (home commutes, nearby stations). */
export function setStations({ fromId, fromName, fromGu, toId, toName, toGu }, autoSearch = true) {
  if (fromId) {
    $('#from').value = localName(fromName, fromGu);
    Object.assign($('#from').dataset, { val: fromId, en: fromName || '', gu: fromGu || '' });
  }
  if (toId) {
    $('#to').value = localName(toName, toGu);
    Object.assign($('#to').dataset, { val: toId, en: toName || '', gu: toGu || '' });
  }
  emit('nav', 'routes');
  if (autoSearch && $('#from').dataset.val && $('#to').dataset.val) search({ reset: true });
  else $('#to').focus();
}

async function loadServiceTypes() {
  try {
    serviceTypes = (await api.serviceTypes()).filter((s) => clean(s.ServiceTypeName));
    renderFilters();
  } catch { /* filters simply stay minimal */ }
}

/* ------------------------------------------------------------------ search */
async function search({ reset = false } = {}) {
  const from = $('#from').dataset.val, to = $('#to').dataset.val;
  if (!from || !to) return toast(t('pickBoth'), 'alert');
  if (busy) return;

  if (reset) { page = 1; results = []; crowd = {}; }
  busy = true;
  const container = $('#routes-results');
  if (reset) container.innerHTML = skeletons(4);

  lastQuery = { from, to, date: $('#date').value || ymd(), type: filter.type };
  try {
    const rows = await api.timetable({ ...lastQuery, page, pageSize: PAGE_SIZE });
    totalPages = Math.max(1, parseInt(rows[0]?.TotalPage, 10) || 1);
    results = page === 1 ? rows : results.concat(rows);
    store.recents.pushRoute({
      fromId: from, fromName: $('#from').dataset.en || $('#from').value,
      toId: to, toName: $('#to').dataset.en || $('#to').value,
    });
    if (view === 'map') routemap.open({ from, to, date: lastQuery.date });
    else renderResults();
    // After the list is on screen, never before it: this is an extra on top of the departures,
    // and the departures must not wait on it. Called from here rather than from renderResults,
    // which it calls back into.
    loadCrowd();
  } catch (e) {
    if (view !== 'map') container.innerHTML = errorState(e, 'search');
  } finally {
    busy = false;
    // Redrawn here rather than on success alone: the chips are a function of whether there are
    // results, so a search that failed or came back empty has to take them away again.
    renderFilters();
  }
}

/* ------------------------------------------------------------------ render */
function renderIdle(keep = false) {
  if (results.length && keep) return;
  if (results.length) return;
  const recent = store.recents.routes().slice(0, 4);
  $('#routes-results').innerHTML = recent.length
    ? `<div class="sec-title">${esc(t('recent'))}</div>` + recent.map((r) =>
      `<button class="tile" data-recent='${esc(JSON.stringify(r))}'>
        <span class="glyph">${icon('route', 'i i-sm')}</span>
        <span class="body"><span class="t1">${esc(r.fromName)} → ${esc(r.toName)}</span>
        <span class="t2">${esc(t('nextDepartures'))}</span></span>
        <span class="end">${icon('right', 'i i-sm')}</span>
      </button>`).join('')
    : emptyState({ glyph: 'route', title: t('navRoutes'), body: t('routesIntroB') });
}

function renderFilters() {
  // Sorting and service-type chips wait for a *search*, not for results. Sixteen of them
  // scrolled across the untouched screen offering to reorder nothing, so they are hidden until
  // something has been asked for — but gating them on `results.length` instead was a trap: a
  // service-type filter that matches nothing empties the list, which took the chips away with
  // it and left the rider inside a filter with no way back out. The empty state literally says
  // "Tap All to see every bus" while All was not on screen.
  const hasSearched = Boolean(lastQuery);
  const sorts = hasSearched ? [['time', 'sortTime'], ['running', 'sortRunning'], ['fast', 'sortFast']] : [];
  const types = hasSearched
    ? [{ ServiceTypeID: '0', ServiceTypeName: t('all') }, ...serviceTypes.filter((s) => s.ServiceTypeID !== '0')]
    : [];
  $('#routes-filters').innerHTML = `
    <button class="chip${view === 'map' ? ' on' : ''}" data-view="${view === 'map' ? 'list' : 'map'}">
      ${icon(view === 'map' ? 'layers' : 'pin', 'i i-sm')}${esc(view === 'map' ? t('viewList') : t('viewMap'))}</button>
    ${hasSearched ? `<button class="chip${filter.runningOnly ? ' on' : ''}" data-running>
      ${icon('play', 'i i-sm')}${esc(t('onlyRunning'))}</button>` : ''}
    <!-- Buses that have left the origin are still catchable further down the route, and
         someone boarding from a later stop has no other way to find the plate. They were in
         the list all along, sorted to the very bottom, which is the same as not being there. -->
    ${hasSearched ? `<button class="chip${filter.departedOnly ? ' on' : ''}" data-departed>
      ${icon('clock', 'i i-sm')}${esc(t('filterDeparted'))}</button>` : ''}
    ${sorts.map(([k, label]) => `<button class="chip${filter.sort === k ? ' on' : ''}" data-sort="${k}">
      ${esc(t(label))}</button>`).join('')}
    ${types.slice(0, 10).map((s) => `<button class="chip${filter.type === String(s.ServiceTypeID) ? ' on' : ''}"
      data-type="${esc(s.ServiceTypeID)}">${esc(getLang() === 'gu' && clean(s.ServiceTypeNameGuj)
        ? s.ServiceTypeNameGuj : s.ServiceTypeName)}</button>`).join('')}`;
}

const isRunning = (row) => /run|progress|depart|track/i.test(clean(row.BusRunningStatus));
const isPremium = (row) => /volvo|sleeper|luxur|a\/?c|deluxe|intercity|super/i.test(
  clean(row.ServiceType) || clean(row.BusServiceType));

/**
 * For today, "sort by departure" has to mean *how soon*, not what the clock reads. Sorting on
 * the raw time puts the 12:30 AM service at the top of a list opened at two in the afternoon,
 * when it is really the last bus of the night — ten hours away, above buses leaving in minutes.
 * For any other date there is no "soon", so clock order is the right answer.
 */
function departureRank(row) {
  if (lastQuery?.date !== ymd()) return timeToMinutes(row.ArrivalTime);
  const when = untilDeparture(row.ArrivalTime);
  if (!when) return Number.MAX_SAFE_INTEGER;
  // Sorting the signed minutes directly puts the *most* past bus on top — at 2pm the 4:45am
  // service (-590) sorted above one that left ten minutes ago. Anything already gone belongs
  // below everything you can still catch, most recently departed first.
  // While filtering to departed buses the whole list is in the past, so the ordinary rule
  // (push everything gone to the bottom) would order them oldest-first. Most recently gone is
  // the one still within reach.
  if (filter.departedOnly) return -when.minutes;
  return when.minutes >= -10 ? when.minutes : 100000 - when.minutes;
}

const hasDeparted = (row) => {
  const when = untilDeparture(row.ArrivalTime);
  return Boolean(when) && when.minutes < 0;
};

function visibleRows() {
  let rows = results.slice();
  if (filter.runningOnly) rows = rows.filter(isRunning);
  // Only meaningful for today; on another date nothing has "already left".
  if (filter.departedOnly && lastQuery?.date === ymd()) rows = rows.filter(hasDeparted);
  const by = {
    time: (a, b) => departureRank(a) - departureRank(b),
    running: (a, b) => (isRunning(b) - isRunning(a)) || (departureRank(a) - departureRank(b)),
    fast: (a, b) => (parseDur(a.SchDuration) - parseDur(b.SchDuration)) || (departureRank(a) - departureRank(b)),
  };
  return rows.sort(by[filter.sort] || by.time);
}

const parseDur = (s) => {
  const p = clean(s).split(':').map(Number);
  return p.length >= 2 && !p.some(Number.isNaN) ? p[0] * 60 + p[1] : 1e9;
};

function renderResults() {
  const rows = visibleRows();
  const container = $('#routes-results');
  if (!rows.length) {
    // A search that returns nothing is a rider who did not get an answer, and the count of
    // those is the clearest signal of what the app is missing.
    stats.track('miss:no-buses');
    // A service-type filter that matched nothing is not the same as a route with no buses —
    // saying "nothing scheduled between these stations" when there are fifty of them, just none
    // of the chosen class, sends the rider away from a service they could have caught.
    const type = filter.type !== '0'
      && serviceTypes.find((x) => String(x.ServiceTypeID) === String(filter.type));
    container.innerHTML = type
      ? emptyState({
        glyph: 'bus',
        title: t('noBusesFiltered', { type: localName(clean(type.ServiceTypeName), clean(type.ServiceTypeNameGuj)) }),
        body: t('noBusesFilteredB'),
      })
      : emptyState({ glyph: 'bus', title: t('noBuses'), body: t('noBusesB') });
    return;
  }

  const fromName = $('#from').value, toName = $('#to').value;
  const saved = store.commutes.has($('#from').dataset.val, $('#to').dataset.val);

  container.innerHTML = `
    <div class="sec-title">${esc(t('servicesFound', { n: rows.length }))}
      ${saved
        ? `<span class="state">${icon('check', 'i i-sm')}${esc(t('commuteSaved'))}</span>`
        : `<button class="act" data-act="save-commute">${icon('plus', 'i i-sm')}${esc(t('saveThisCommute'))}</button>`}
    </div>
    ${rows.map(rowHtml).join('')}
    ${page < totalPages ? `<button class="btn ghost block" data-act="more">
      ${icon('down', 'i i-sm')}${esc(t('nextDepartures'))}</button>` : ''}`;

  container.dataset.from = fromName;
  container.dataset.to = toName;
  scrollToNextDeparture(rows, container);
}

/**
 * Automatic: a full-day timetable opened at noon should not start at midnight. Bring the
 * first service that has not gone yet to the top of the view — but only for today, and only
 * when there is actually something above it to skip.
 */
function scrollToNextDeparture(rows, container) {
  if (lastQuery?.date !== ymd() || filter.sort !== 'time') return;
  const index = rows.findIndex((row) => {
    const when = untilDeparture(row.ArrivalTime);
    return when && when.minutes >= -10;
  });
  if (index <= 0) return;
  const target = container.querySelector(`[data-i="${index}"]`);
  if (!target) return;
  requestAnimationFrame(() => {
    const top = target.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

/**
 * One service. Three fixed lines, nothing wraps: plate + status, the facts, the route.
 * The right column answers "should I run for it" — the clock time plus how long that is
 * from right now, which is the number people actually act on.
 */
/**
 * What riders have said about this bus, on the line where the bus is chosen.
 *
 * Crowd reports used to be visible only after you had already picked a bus and opened it, which
 * is one screen too late — the question "which of these do I get on" is answered here. Silent
 * when nobody has said anything, because an absent report and an empty bus are not the same.
 */
function crowdChip(plate) {
  const c = crowd[plate];
  if (!c) return '';
  const cancelled = c.status?.cancelled;
  const replaced = c.status?.replaced;
  // Not running at all outranks how full it is: there is no point knowing a cancelled bus
  // had seats.
  if (cancelled) return `<span class="crowd-chip gone">${esc(t('reportCancelled'))}</span>`;
  if (replaced) return `<span class="crowd-chip gone">${esc(t('reportReplaced'))}</span>`;
  const label = occupancyLabel(c.level);
  if (!label) return '';
  return `<span class="crowd-chip lvl-${Number(c.level)}">${esc(label)}</span>`;
}

/**
 * Asks once for every bus on screen. Failure is silent by design — the departure list is the
 * point of the screen and it must not depend on an extra we are adding to it.
 */
async function loadCrowd() {
  const plates = [...new Set(results.map((r) => clean(r.BusNo)).filter(Boolean))];
  if (!plates.length) return;
  try {
    const next = await api.crowd(plates);
    if (!Object.keys(next || {}).length) return;
    crowd = next;
    if (view !== 'map') renderResults();
  } catch { /* the list is already on screen and stays there */ }
}

function rowHtml(row, i) {
  const running = isRunning(row);
  const service = clean(row.ServiceType) || clean(row.BusServiceType);
  // Journey time only. Distance and seat count were pushing this line past twice the width it
  // has on a phone, and neither answers the question being asked while scanning departures —
  // which is how full the bus is, what class it is, and how long it takes. Both are still on
  // the bus's own screen, one tap away.
  const facts = duration(row.SchDuration);
  const when = untilDeparture(row.ArrivalTime);

  // The plate owns line one. Status is a dot beside it and a word on the meta line —
  // a full badge up there squeezes the one thing the rider is looking for.
  return `<button class="tile" data-i="${i}">
    <span class="glyph${running ? ' live' : ''}">${icon('bus', 'i i-sm')}</span>
    <span class="body">
      <span class="line1">
        <span class="t1 num">${esc(clean(row.BusNo) || '—')}</span>
        ${running ? '<span class="live-dot" aria-hidden="true"></span>' : ''}
      </span>
      <span class="meta">
        ${crowdChip(clean(row.BusNo))}
        ${running ? `<span class="meta-live">${esc(t('running'))}</span> · ` : ''}
        ${service ? `<span class="${isPremium(row) ? 'meta-premium' : ''}">${esc(service)}</span> · ` : ''}
        ${esc(facts)}</span>
      <span class="t2">${esc(localName(clean(row.RouteName), clean(row.RouteNameGuj)))}</span>
    </span>
    <span class="end">
      <span>
        <span class="big num">${esc(clean(row.ArrivalTime) || '—')}</span>
        ${when ? `<span class="small num ${esc(when.state)}">${esc(when.label)}</span>` : ''}
      </span>
      ${icon('right', 'i i-sm')}
    </span>
  </button>`;
}

/* ------------------------------------------------------------------ events */
function onFilterClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.view) return setView(chip.dataset.view);
  if (chip.hasAttribute('data-running')) filter.runningOnly = !filter.runningOnly;
  else if (chip.hasAttribute('data-departed')) {
    filter.departedOnly = !filter.departedOnly;
    if (filter.departedOnly) stats.track('act:show-departed');
  }
  else if (chip.dataset.sort) filter.sort = chip.dataset.sort;
  else if (chip.dataset.type != null) {
    filter.type = chip.dataset.type;
    renderFilters();
    if (lastQuery) return search({ reset: true });
  }
  renderFilters();
  if (results.length) renderResults();
}

/** Switches between the timetable and the live map of the same query. */
function setView(next) {
  if (view === next) return;
  view = next;
  renderFilters();
  if (view === 'map') {
    if (!lastQuery) { view = 'list'; renderFilters(); return toast(t('pickBoth'), 'alert'); }
    routemap.open({ from: lastQuery.from, to: lastQuery.to, date: lastQuery.date });
  } else {
    routemap.close();
    if (results.length) renderResults(); else renderIdle();
  }
}

function onResultClick(e) {
  if (view === 'map' && routemap.handleClick(e)) return;

  const recent = e.target.closest('[data-recent]');
  if (recent) {
    const r = JSON.parse(recent.dataset.recent);
    return setStations({ fromId: r.fromId, fromName: r.fromName, toId: r.toId, toName: r.toName });
  }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'search') return search({ reset: true });
  if (act === 'more') { page += 1; return search(); }
  if (act === 'save-commute') {
    const added = store.commutes.add({
      fromId: $('#from').dataset.val, fromName: $('#from').dataset.en || $('#from').value, fromGu: $('#from').dataset.gu,
      toId: $('#to').dataset.val, toName: $('#to').dataset.en || $('#to').value, toGu: $('#to').dataset.gu,
    });
    toast(t(added ? 'commuteSaved' : 'commuteRemoved'), added ? 'check' : 'trash');
    renderResults();
    return;
  }

  const tile = e.target.closest('[data-i]');
  if (!tile) return;
  const row = visibleRows()[+tile.dataset.i];
  if (!row) return;
  const plate = clean(row.BusNo);
  if (!plate) return toast(t('noDataToday'), 'alert');
  emit('track', plate, {
    trip: {
      tripId: clean(row.TripId),
      status: isRunning(row) ? 1 : 0,
      start: clean(row.ArrivalTimeAtBoarding),
      route: localName(clean(row.RouteName), clean(row.RouteNameGuj)),
      from: clean(row.FromStationName), to: clean(row.ToStationName),
    },
  });
}

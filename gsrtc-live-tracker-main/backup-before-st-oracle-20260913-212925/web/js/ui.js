/* Shared UI plumbing: escaping, formatting, toasts, the bottom sheet, and the
   keyboard-accessible autocomplete used by both the plate and station fields. */

import { icon } from './icons.js';
import { t, getLang } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Everything from the upstream API is untrusted text — always escape before innerHTML. */
export function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Upstream uses the literal string "N/A" for missing values. */
export const clean = (v) => {
  const s = (v ?? '').toString().trim();
  return !s || s === 'N/A' || s === 'null' || s === '0' ? '' : s;
};
export const dash = (v) => clean(v) || '—';

/* ------------------------------------------------------------------ format */
const nf = (opts) => new Intl.NumberFormat(getLang() === 'gu' ? 'gu-IN' : 'en-IN', opts);

export const num = (n, d = 0) => nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

export function distance(km) {
  if (!isFinite(km)) return '';
  return km < 1 ? `${num(Math.round(km * 1000))} m` : `${num(km, km < 10 ? 1 : 0)} ${t('km')}`;
}

export function clockTime(d = new Date()) {
  return d.toLocaleTimeString(getLang() === 'gu' ? 'gu-IN' : 'en-IN',
    { hour: '2-digit', minute: '2-digit' });
}

export function since(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return t('justNow');
  if (s < 60) return t('secsAgo', { n: s });
  return t('minsAgo', { n: Math.round(s / 60) });
}

/** "04:15:00" -> "4h 15m"; "00:29" -> "29m" */
export function duration(hms) {
  const s = clean(hms);
  if (!s) return '';
  const p = s.split(':').map(Number);
  if (p.some(Number.isNaN)) return '';
  const [h, m] = p.length >= 3 ? p : [p[0], p[1] || 0];
  if (!h && !m) return '';
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** "12:30 AM" -> minutes since midnight, for sorting. */
export function timeToMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(clean(str));
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = +m[1] % 12;
  if (/pm/i.test(m[3] || '')) h += 12;
  return h * 60 + +m[2];
}

/**
 * A timetable time against the clock right now: "in 12 min", "due now", "left 4 min ago".
 * Returns null when the time cannot be read. `minutes` is signed — negative means it has gone.
 */
export function untilDeparture(clockValue) {
  const target = timeToMinutes(clockValue);
  if (target === Number.MAX_SAFE_INTEGER) return null;
  const now = new Date();
  let diff = target - (now.getHours() * 60 + now.getMinutes());
  // Timetables wrap past midnight; take whichever reading is closest to now.
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;

  // Past a certain point "left 713 min ago" is noise — the clock time already says it.
  if (diff <= -90) return { minutes: diff, label: '', state: 'gone' };
  if (diff <= -6) return { minutes: diff, label: t('alreadyLeft', { n: Math.abs(diff) }), state: 'gone' };
  if (diff <= 1) return { minutes: diff, label: t('dueNow'), state: 'soon' };
  if (diff < 60) return { minutes: diff, label: t('inMinutes', { n: diff }), state: diff <= 20 ? 'soon' : 'ok' };
  return {
    minutes: diff,
    label: t('inHours', { h: Math.floor(diff / 60), m: diff % 60 }),
    state: 'ok',
  };
}

export const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ------------------------------------------------------------------ geo */
// Defined in insight.js so that module has no DOM dependency and the server can reuse it.
export { haversineKm } from './insight.js';

/**
 * Wraps geolocation in a promise with a sane timeout.
 *
 * `prime` routes a first-time request through the explanation sheet rather than firing the
 * native prompt cold; pass false where a prompt would be unwelcome (background refreshes).
 */
export async function locate({ timeout = 10000, highAccuracy = true, prime = true } = {}) {
  if (prime && navigator.geolocation) {
    const { ensure } = await import('./permissions.js');
    const state = await ensure('location');
    if (state === 'denied' || state === 'unsupported') throw new Error(state);
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 30000 },
    );
  });
}

/* ------------------------------------------------------------------ toast */
let toastTimer;
export function toast(message, iconName = null) {
  const el = $('#toast');
  el.innerHTML = (iconName ? icon(iconName, 'i i-sm') : '') + `<span>${esc(message)}</span>`;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ------------------------------------------------------------------ sheet */
let sheetCloser = null;

/**
 * `compact` sizes the sheet to its content instead of the standing 640px.
 *
 * That fixed height is right for a route timeline or a depot list, which fill it. For a
 * three-element form it leaves most of the screen as empty panel below the last control, which
 * reads as something failing to load rather than as a short form.
 */
export function openSheet({ title, subtitle, body, onClose, compact = false }) {
  const backdrop = $('#sheet-backdrop');
  const sheet = $('#sheet');
  sheet.classList.toggle('compact', compact);
  $('#sheet-title').innerHTML = `${esc(title)}${subtitle ? `<span class="s">${esc(subtitle)}</span>` : ''}`;
  const bodyEl = $('#sheet-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  bodyEl.scrollTop = 0;
  backdrop.classList.add('on');
  sheet.classList.add('on');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  sheetCloser = onClose || null;
  $('#sheet-close').focus({ preventScroll: true });
  return bodyEl;
}

export function closeSheet() {
  const backdrop = $('#sheet-backdrop');
  if (!backdrop.classList.contains('on')) return;
  backdrop.classList.remove('on');
  $('#sheet').classList.remove('on');
  $('#sheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  const fn = sheetCloser; sheetCloser = null;
  fn?.();
}

export function isSheetOpen() { return $('#sheet-backdrop').classList.contains('on'); }

/* ------------------------------------------------------------------ states */
/**
 * Placeholder rows while something loads.
 *
 * Wrapped in a container that owns the gap between them. As bare siblings they sat flush
 * against each other, and two large rounded blocks touching read as one broken shape rather
 * than as two rows waiting to arrive.
 */
export function skeletons(n = 3) {
  return `<div class="skel-stack">${
    Array.from({ length: n }, () => '<div class="skel tile-skel"></div>').join('')}</div>`;
}

export function emptyState({ glyph = 'info', title, body, action }) {
  return `<div class="empty">
    <div class="glyph">${icon(glyph, 'i i-lg')}</div>
    <div class="t1">${esc(title)}</div>
    ${body ? `<div class="t2">${esc(body)}</div>` : ''}
    ${action ? `<button class="btn ghost" data-act="${esc(action.act)}">${
      action.icon ? icon(action.icon, 'i i-sm') : ''}${esc(action.label)}</button>` : ''}
  </div>`;
}

export function errorState(err, retryAct = 'retry') {
  const kind = err?.kind;
  // 404 is not a fault, it is an answer: the thing asked for is not there. Saying "something
  // went wrong" and quoting a method name at someone who typed a plate of a parked bus is both
  // alarming and useless.
  const notFound = err?.status === 404;
  const msg = notFound ? t('errNotRunning')
    : kind === 'network' ? t('errNetwork')
      : kind === 'upstream' ? t('errUpstream') : t('errGeneric');
  const detail = notFound ? t('errNotRunningB') : (err?.message || '');
  return `<div class="empty">
    <div class="glyph">${icon(notFound ? 'bus' : 'alert', 'i i-lg')}</div>
    <div class="t1">${esc(msg)}</div>
    <div class="t2">${esc(detail)}</div>
    <button class="btn ghost" data-act="${esc(retryAct)}">${icon('refresh', 'i i-sm')}${esc(t('retry'))}</button>
  </div>`;
}

/* ------------------------------------------------------------------ autocomplete */
/**
 * Accessible combobox. `fetcher(query)` returns rows; `render(row)` returns the inner HTML
 * of one option; `onPick(row)` receives the chosen row.
 */
export function autocomplete(input, pop, { fetcher, render, onPick, minLen = 2, delay = 200 }) {
  let timer, rows = [], sel = -1, seq = 0;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  pop.setAttribute('role', 'listbox');

  // The wrapping field is lifted above its siblings while the list is showing, so the next
  // input down the form cannot paint over the options.
  const field = input.closest('.field');
  // The card is clipped (`overflow: hidden`) so its rounded corners cut inner content, which
  // also cropped this dropdown to whatever was left of the card — 177 matches showing as two.
  // It is released only while a list is open, so the corners stay clipped the rest of the time.
  const card = input.closest('.card');

  const close = () => {
    pop.innerHTML = '';
    rows = []; sel = -1;
    input.setAttribute('aria-expanded', 'false');
    field?.classList.remove('open');
    card?.classList.remove('has-open-list');
  };

  const open = (list) => {
    rows = list; sel = -1;
    if (!list.length) return close();
    pop.innerHTML = list.map((r, i) =>
      `<button type="button" class="ac-item" role="option" id="${pop.id}-o${i}" aria-selected="false">${render(r)}</button>`).join('');
    [...pop.children].forEach((node, i) => {
      node.addEventListener('mousedown', (e) => e.preventDefault());
      node.addEventListener('click', () => pick(i));
    });
    input.setAttribute('aria-expanded', 'true');
    field?.classList.add('open');
    card?.classList.add('has-open-list');
  };

  const highlight = () => {
    [...pop.children].forEach((n, i) => n.setAttribute('aria-selected', String(i === sel)));
    if (sel >= 0) {
      pop.children[sel].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', `${pop.id}-o${sel}`);
    } else input.removeAttribute('aria-activedescendant');
  };

  const pick = (i) => {
    const row = rows[i];
    if (!row) return;
    close();
    onPick(row, input);
  };

  input.addEventListener('input', () => {
    input.dataset.val = '';
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < minLen) return close();
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const list = await fetcher(query);
        if (mine === seq) open(list || []);
      } catch { if (mine === seq) close(); }
    }, delay);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    if (!rows.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % rows.length; highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + rows.length) % rows.length; highlight(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  return { close };
}

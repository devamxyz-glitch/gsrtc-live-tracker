/**
 * Whether the operator's system is answering, shown as one dot.
 *
 * This app is a window onto somebody else's backend. When that backend stops answering the app
 * looks broken — the screens are empty, nothing loads, and the rider concludes the app is
 * rubbish and stops opening it. A dot that says "GSRTC is not responding" turns a mystery into
 * an explanation, and costs one small line on the home screen to do it.
 *
 * Quiet when everything is fine, on purpose. A status indicator that shouts while healthy is
 * one people stop reading, and then it cannot tell them anything when it matters.
 */

import { api } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, esc, openSheet, since } from './ui.js';

const REFRESH_MS = 60000;

let snapshot = null;
let timer = null;

const LABEL = {
  ok: 'statusOk', degraded: 'statusDegraded', down: 'statusDown', unknown: 'statusUnknown',
};

export function init() {
  $('#status-dot')?.addEventListener('click', open);
  refresh();
  // Paused while hidden: a backgrounded tab polling a status endpoint every minute is pure
  // waste, and the answer is refetched the moment it matters again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else { refresh(); start(); }
  });
  start();
}

const start = () => { stop(); timer = setInterval(refresh, REFRESH_MS); };
const stop = () => { clearInterval(timer); timer = null; };

async function refresh() {
  try {
    snapshot = await api.status();
    paint();
  } catch {
    // Our own server being unreachable is its own kind of down, and the offline bar already
    // says so — claiming the operator is at fault would be a guess.
  }
}

function paint() {
  const el = $('#status-dot');
  if (!el || !snapshot) return;

  const state = snapshot.overall;
  el.hidden = false;
  el.className = `status-dot ${state}`;
  el.querySelector('.sd-text').textContent = t(LABEL[state] || LABEL.unknown);
}

function open() {
  if (!snapshot) return;

  const rows = snapshot.services.map((s) => {
    const known = s.samples > 0;
    // The heartbeat, oldest on the left. A percentage alone cannot tell a brief blip from a
    // service that has been failing for the last ten minutes, and those need opposite reactions
    // from a rider deciding whether to wait at the stop.
    const beats = (s.beats || []).map((b) =>
      `<i class="${b ? 'up' : 'down'}"></i>`).join('')
      || '<i class="idle"></i>'.repeat(8);

    return `<div class="svc">
      <span class="svc-pct ${esc(s.state)}">${known ? `${s.uptimePct}%` : '—'}</span>
      <span class="svc-name">${esc(s.name)}</span>
      <span class="beats" aria-hidden="true">${beats}</span>
    </div>
    <div class="svc-meta">${esc(known
    ? [
      t('statusChecks', { n: s.samples }),
      s.medianMs != null ? `${s.medianMs} ms` : '',
      (s.state === 'down' || s.state === 'degraded') && s.lastOkAt
        ? t('statusLastOk', { ago: since(s.lastOkAt) }) : '',
    ].filter(Boolean).join(' · ')
    : t('statusNotChecked'))}</div>`;
  }).join('');

  const body = document.createElement('div');
  body.className = 'flow sheet-pad';
  body.innerHTML = `
    <div class="note${snapshot.overall === 'ok' ? '' : ' warn'}">
      ${icon(snapshot.overall === 'ok' ? 'check' : 'alert', 'i i-sm')}
      <div>${esc(t(`statusBlurb_${snapshot.overall}`))}</div>
    </div>
    <div class="svc-list">${rows}</div>
    <p class="hint">${esc(t('statusFootnote'))}</p>`;

  openSheet({ title: t('statusTitle'), subtitle: t('statusSubtitle'), body, compact: true });
}

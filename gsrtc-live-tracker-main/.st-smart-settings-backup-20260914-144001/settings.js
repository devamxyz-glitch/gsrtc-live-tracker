/* Settings, plus the part every transit app should have and most do not:
   a plain statement of where the data comes from and what stays on your device. */

import { api } from './api.js';
import { icon } from './icons.js';
import { t, setLang, getLang } from './i18n.js';
import * as store from './store.js';
import { emit } from './events.js';
import { $, esc, toast } from './ui.js';
import * as install from './install.js';
import * as permissions from './permissions.js';
import * as tour from './tour.js';
import * as helpline from './helpline.js';
import * as push from './push.js';
import * as stats from './stats.js';
import { MAP_STYLES, styleId } from './map.js';

let version = '';

export function init() {
  $('#settings-body').addEventListener('click', onClick);
  // install.js owns beforeinstallprompt; re-render when the option appears or goes away.
  window.addEventListener('beforeinstallprompt', () => setTimeout(render, 0));
  window.addEventListener('appinstalled', render);

  api.health().then((h) => { version = h?.version || ''; render(); }).catch(() => {});
  render();
}

export function onShow() { render(); }

function seg(name, options, current) {
  return `<div class="seg" role="group">${options.map(([value, label]) =>
    `<button class="${value === current ? 'on' : ''}" data-set="${name}" data-value="${esc(value)}">${
      esc(label)}</button>`).join('')}</div>`;
}

function render() {
  const s = store.settings.get();
  const installable = install.installState();

  $('#settings-body').innerHTML = `
    <div class="sec-title">${esc(t('settings'))}</div>
    <div class="list">
      <div class="list-row">
        <span class="row-glyph">${icon('globe')}</span>
        <span class="lbl">${esc(t('language'))}</span>
        ${seg('lang', [['en', 'English'], ['gu', 'ગુજરાતી']], getLang())}
      </div>
      <div class="list-row">
        <span class="row-glyph">${icon(s.theme === 'dark' ? 'moon' : s.theme === 'light' ? 'sun' : 'monitor')}</span>
        <span class="lbl">${esc(t('theme'))}</span>
        ${seg('theme', [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], s.theme)}
      </div>
      <div class="list-row">
        <span class="row-glyph">${icon('type')}</span>
        <span class="lbl">${esc(t('textSize'))}</span>
        ${seg('text', [['normal', t('textNormal')], ['large', t('textLarge')]], s.text)}
      </div>
      <div class="list-row">
        <span class="row-glyph">${icon('refresh')}</span>
        <span class="lbl">${esc(t('refreshRate'))}</span>
        ${seg('refresh', [['10', t('seconds', { n: 10 })], ['20', t('seconds', { n: 20 })], ['60', t('seconds', { n: 60 })]], String(s.refresh))}
      </div>
      <div class="list-row wraps">
        <span class="row-glyph">${icon('layers')}</span>
        <span class="lbl">${esc(t('mapStyle'))}</span>
        ${seg('mapStyle', [
    ['standard', t('mapStandard')], ['detailed', t('mapDetailed')],
    ['satellite', t('mapSatellite')],
  ], styleId())}
      </div>
    </div>

    <!--
      The helpline is ours and opens in the app; everything under "GSRTC Services" below is an
      external link that leaves for gsrtc.in. Listing them together made a chevron and a
      leave-the-app arrow look like the same kind of row, and implied GSRTC provides this
      directory when it does not.
    -->
    ${installable === 'installed' ? '' : `
    <div class="sec-title">${esc(t('install'))}</div>
    ${installable === 'available'
      // Only offer a button when there is a real prompt behind it. Otherwise say where the
      // option actually lives on this platform, rather than opening a panel that cannot help.
      ? `<button class="btn block" data-act="install">${
        icon('download', 'i i-sm')}${esc(t('install'))}</button>`
      : `<div class="note">${icon('info', 'i i-sm')}<div>${esc(
        installable === 'ios' ? `${t('iosStep1')} ${t('iosStep2')}`
          : installable === 'ios-wrong-browser' ? t('iosOpenInSafari')
            : t('installMenuHint'))}</div></div>`}`}

    <div class="list">
      <button class="list-row" data-act="tour">
        <span class="row-glyph">${icon('info')}</span>
        <span class="lbl">${esc(t('tourReplay'))}
          <span class="hint">${esc(t('tourReplayHint'))}</span></span>
        <span class="row-tail">${icon('right')}</span>
      </button>
      <button class="list-row" data-act="permissions">
        <span class="row-glyph">${icon('shield')}</span>
        <span class="lbl">${esc(t('permManage'))}
          <span class="hint">${esc(t('permManageHint'))}</span></span>
        <span class="row-tail">${icon('right')}</span>
      </button>
      ${/* Only when a notification could actually arrive — a button that cannot work is worse
            than no button. An arrival alert is not something you find out is broken until the
            bus has already gone past, so it is worth being able to check on purpose. */
      push.supported() && permissions.notificationState() === 'granted' ? `
      <button class="list-row" data-act="push-test">
        <span class="row-glyph">${icon('bell')}</span>
        <span class="lbl">${esc(t('pushTest'))}
          <span class="hint">${esc(t('pushTestHint'))}</span></span>
        <span class="row-tail">${icon('right')}</span>
      </button>` : ''}
    </div>

    <div class="sec-title">${esc(t('depotDirectory'))}</div>
    <div class="list">
      <button class="list-row" data-act="helpline">
        <span class="row-glyph">${icon('phone')}</span>
        <span class="lbl">${esc(t('helplineDir'))}
          <span class="hint">${esc(t('helplineDirHint'))}</span></span>
        <span class="row-tail">${icon('right')}</span>
      </button>
    </div>

    <div class="sec-title">${esc(t('gsrtcServices'))}</div>
    <div class="note">${icon('external', 'i i-sm')}<div>${esc(t('gsrtcServicesHint'))}</div></div>
    <div class="list">
      <a class="list-row" href="https://www.gsrtc.in/OPRSOnline/prePrintTicket.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('ticket')}</span>
        <span class="lbl">${esc(t('printTicket'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://gsrtc.in/OPRSOnline/prePonePostPoneTicket.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('calendar')}</span>
        <span class="lbl">${esc(t('rescheduleJourney'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://www.gsrtc.in/OPRSOnline/preTicketCancellation.do?hiddenAction=TicketCancel&flag=C" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('x')}</span>
        <span class="lbl">${esc(t('cancelTicket'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://www.gsrtc.in/OPRSOnline/preWaitingListTicketStatus.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('users')}</span>
        <span class="lbl">${esc(t('waitingListStatus'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://www.gsrtc.in/OPRSPass/preOnlinePassengerNewBusPassSystem.do?hiddenAction=PassengerNewBussPass" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('ticket')}</span>
        <span class="lbl">${esc(t('newBusPass'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://www.gsrtc.in/OPRSPass/preOnlinePassengerNewBusPassSystem.do?hiddenAction=PassengerRenewalBussPass" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('refresh')}</span>
        <span class="lbl">${esc(t('renewBusPass'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://www.gsrtc.in/OPRSPass/preOnlinePassengerNewBusPassSystem.do?hiddenAction=PassengerApplicationStatus" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('search')}</span>
        <span class="lbl">${esc(t('passStatus'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://gsrtc.in/GSRTCPhonepe/preGatewayTransactionStatus.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('clock')}</span>
        <span class="lbl">${esc(t('refundStatus'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://yatradham.gujarat.gov.in/Booking" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('signpost')}</span>
        <span class="lbl">${esc(t('shravanTirth'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://gsrtc.in/OPRSOnline/preGsrtcWalletAccount.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('shield')}</span>
        <span class="lbl">${esc(t('walletAccount'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://gsrtc.in/OPRSOnline/preGsrtcWalletAccountSummary.do" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('copy')}</span>
        <span class="lbl">${esc(t('walletPassbook'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="http://mail1.gsrtc.in/helpdesk/open.php" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('info')}</span>
        <span class="lbl">${esc(t('pravasiHelpdesk'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <a class="list-row" href="https://feedback.gsrtc.org/" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('star')}</span>
        <span class="lbl">${esc(t('feedback'))}</span>
        <span class="row-tail">${icon('external')}</span>
      </a>
    </div>


    <div class="sec-title">${esc(t('dataAndPrivacy'))}</div>
    <div class="list">
      <div class="list-row top">
        <span class="row-glyph">${icon('info')}</span>
        <span class="lbl">${esc(t('aboutData'))}
          <span class="hint">${esc(t('aboutDataB'))}</span></span>
      </div>
      <div class="list-row top">
        <span class="row-glyph">${icon('shield')}</span>
        <span class="lbl">${esc(t('dataAndPrivacy'))}
          <span class="hint">${esc(t('privacyB'))}</span></span>
      </div>
      <div class="list-row top wraps">
        <span class="row-glyph">${icon('gauge')}</span>
        <span class="lbl">${esc(t('statsTitle'))}
          <span class="hint">${esc(t('statsB'))}</span></span>
        ${seg('stats', [['on', t('on')], ['off', t('off')]], s.stats === false ? 'off' : 'on')}
      </div>
      <button class="list-row" data-act="forget-device">
        <span class="row-glyph">${icon('refresh')}</span>
        <span class="lbl">${esc(t('forgetDevice'))}
          <span class="hint">${esc(t('forgetDeviceHint'))}</span></span>
        <span class="row-tail">${icon('right')}</span>
      </button>
      <a class="list-row" href="privacy.html" target="_blank" rel="noopener">
        <span class="row-glyph">${icon('shield')}</span>
        <span class="lbl">${esc(t('privacyPolicy'))}
          <span class="hint">${esc(t('privacyPolicyHint'))}</span></span>
        <span class="row-tail">${icon('external')}</span>
      </a>
      <button class="list-row" data-act="clear">
        <span class="row-glyph danger">${icon('trash')}</span>
        <span class="lbl danger">${esc(t('clearData'))}
          <span class="hint">${esc(t('clearDataHint'))}</span></span>
      </button>
    </div>

    <!--
      Last on the screen on purpose: everything the app actually does comes first, and the ask
      comes after. rel="noopener noreferrer" because this is the one link in Settings that
      leaves for a site we do not control.
    -->
    <a class="support-card" href="https://buymeacoffee.com/shivrajsinh.sh"
      target="_blank" rel="noopener noreferrer">
      <span class="sc-glyph">${icon('coffee')}</span>
      <span class="sc-body">
        <span class="sc-title">${esc(t('supportTitle'))}</span>
        <span class="sc-text">${esc(t('supportBody'))}</span>
        <span class="sc-cta">${icon('coffee', 'i i-sm')}${esc(t('supportCta'))}${
          icon('external', 'i i-sm')}</span>
        <span class="sc-note">${esc(t('supportNote'))}</span>
      </span>
    </a>

    <div class="app-version">
      <span>${esc(t('appName'))}${version ? ` · ${esc(t('version'))} ${esc(version)}` : ''}</span>
      <span class="av-by">${esc(t('builtBy'))}
        <a href="https://shivrajsinh.in" target="_blank" rel="noopener noreferrer"
          >shivrajsinh.in${icon('external', 'i i-xs')}</a></span>
    </div>`;
}

function onClick(e) {
  const setter = e.target.closest('[data-set]');
  if (setter) {
    const { set, value } = setter.dataset;
    if (set === 'lang') {
      setLang(value);
      localStorage.setItem('st.lang', value);
      store.settings.set({ lang: value });
      emit('lang-changed', value);
    } else if (set === 'refresh') {
      store.settings.set({ refresh: +value });
    } else if (set === 'stats') {
      // Turning it off must also drop whatever is already queued — flushing on the way out
      // would send exactly the batch the rider just said no to.
      store.settings.set({ stats: value === 'on' });
      if (value === 'on') stats.track('screen:settings'); else stats.discard();
    } else {
      store.settings.set({ [set]: value });
      emit('appearance-changed');
    }
    render();
    return;
  }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'helpline') helpline.open();
  if (act === 'permissions') permissions.openPrimer();
  if (act === 'tour') tour.start();
  if (act === 'install') install.promptNow().finally(render);
  if (act === 'push-test') sendTestNotification(e.target.closest('.list-row'));
  if (act === 'forget-device') {
    stats.forget().then(() => toast(t('forgetDone'), 'check'));
  }
  if (act === 'clear') {
    store.clearAll();
    localStorage.removeItem('st.alerts.v1');
    toast(t('cleared'), 'check');
    emit('data-cleared');
    render();
  }
}

/**
 * Fires one real notification at this device, through the push service.
 *
 * Deliberately the whole round trip rather than a local `showNotification` — a local one proves
 * only that the tab is awake, which is never the case when an arrival alert matters. This goes
 * out to FCM or APNs and comes back, so a success here means alerts will genuinely arrive with
 * the app closed and the phone locked.
 */
async function sendTestNotification(row) {
  // Feedback goes through the toast, and the row is only disabled — rewriting its label would
  // destroy the nested hint element inside it.
  if (row) row.disabled = true;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
      // No subscription yet: this device has permission but has never armed an alert.
      || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await push.serverKeyBytes(),
      });

    const result = await api.pushTest({ subscription: sub.toJSON() });
    if (result?.ok) toast(t('pushTestSent'));
    else if (result?.reason === 'wait') toast(t('pushTestWait', { sec: result.retryInSec }));
    else toast(t('pushTestFailed'));
  } catch {
    toast(t('pushTestFailed'));
  } finally {
    if (row) row.disabled = false;
  }
}

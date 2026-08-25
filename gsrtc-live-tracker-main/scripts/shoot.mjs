/**
 * Real screenshots of the live app, for the landing page.
 *
 * Chrome's `--screenshot` flag can only point at a URL and fire; it cannot dismiss the install
 * banner that covers half the screen, cannot wait for a bus position to arrive, and gets the
 * viewport wrong. So this drives Chrome over the DevTools Protocol instead — which needs no
 * dependency at all, because Node has had a WebSocket client built in since v22.
 *
 *   node scripts/shoot.mjs
 *
 * Writes PNGs into landing/screens/. Re-run whenever the app's look changes; that is the whole
 * cost of using real screenshots rather than a mockup, and it is why the markup version existed.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'landing', 'screens');
const APP = process.env.SHOOT_BASE || 'https://tracker.shivrajsinh.in';
const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222 + Math.floor(Math.random() * 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny CDP client: send a command, wait for the reply with the same id. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message));
    else slot.resolve(msg.result);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('could not attach to Chrome')), { once: true });
  });

  return {
    ready,
    /**
     * `sessionId` rides at the top level of the message, beside `params` and not inside it.
     * Nested, Chrome routes the command to the browser target instead of the page and answers
     * "'Page.enable' wasn't found" — which reads like a version problem and is not one.
     */
    send(method, params = {}, sessionId) {
      const mine = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mine, { resolve, reject });
        const msg = { id: mine, method, params };
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
      });
    },
    close: () => ws.close(),
  };
}

/**
 * The shots, in the order they appear on the page.
 *
 * `settle` is how long to wait after load. These screens are waiting on a live upstream, and a
 * screenshot taken too early is a picture of a spinner.
 */
const SHOTS = [
  { name: 'track', path: (plate) => `/?plate=${plate}`, settle: 9000 },
  { name: 'routes', path: () => '/?from=470&to=462&fromName=Rajkot&toName=Morbi', settle: 11000 },
  { name: 'nearby', path: () => '/#nearby', settle: 5000 },
];

/** A bus that is actually moving, so the Track shot shows a live position rather than an error. */
async function runningPlate() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const url = `${APP}/api/timetable?from=470&to=462&date=${today}&type=0&page=1&pageSize=60`;
  try {
    const rows = await fetch(url).then((r) => r.json());
    const live = rows.find((r) => /run|progress|track/i.test(String(r.BusRunningStatus || '')));
    return live?.BusNo || 'GJ-18-ZT-1028';
  } catch {
    return 'GJ-18-ZT-1028';
  }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const plate = await runningPlate();
  console.log(`using live plate ${plate}`);

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/st-shoot-profile',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // Wait for the debugger to answer rather than guessing at a delay.
    let wsUrl = null;
    for (let i = 0; i < 40 && !wsUrl; i += 1) {
      try {
        const v = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
        wsUrl = v.webSocketDebuggerUrl;
      } catch { await sleep(250); }
    }
    if (!wsUrl) throw new Error('Chrome never opened its debugging port');

    const cdp = connect(wsUrl);
    await cdp.ready;

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 400, height: 860, deviceScaleFactor: 2, mobile: true,
    });

    for (const theme of ['light', 'dark']) {
    for (const shot of SHOTS) {
      const url = APP + shot.path(plate);
      await send('Page.navigate', { url });
      await sleep(1200);

      // The app keeps its theme in localStorage, so it has to be set and the page reloaded —
      // both editions are captured because the landing page swaps them on the reader's own
      // preference, and a dark screenshot on a light page is the seam this avoids.
      await send('Runtime.evaluate', {
        expression: `
          try {
            const k = 'st.tracker.v1';
            const st = JSON.parse(localStorage.getItem(k) || '{}');
            st.settings = { ...(st.settings || {}), theme: '${theme}' };
            localStorage.setItem(k, JSON.stringify(st));
          } catch {}
        `,
      });
      await send('Page.navigate', { url });
      await sleep(1500);

      // Silence the things that would sit on top of the screenshot. These are real features —
      // they simply must not be the subject of a picture of something else.
      await send('Runtime.evaluate', {
        expression: `
          try {
            localStorage.setItem('st.install.dismissed', String(Date.now()));
            localStorage.setItem('st.tracker.v1', localStorage.getItem('st.tracker.v1') || '{}');
          } catch {}
          document.querySelectorAll('.install-card, #toast').forEach((el) => el.remove());
        `,
      });

      await sleep(shot.settle);
      // Again after settling: the banner appears on a timer, so it can arrive during the wait.
      await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.install-card, #toast').forEach((el) => el.remove());`,
      });
      await sleep(400);

      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${shot.name}-${theme}.png`);
      await fs.writeFile(file, Buffer.from(data, 'base64'));
      const { size } = await fs.stat(file);
      console.log(`  ${shot.name}-${theme}.png  ${Math.round(size / 1024)} KB`);
    }
    }

    cdp.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error('shoot failed:', e.message);
  process.exit(1);
});

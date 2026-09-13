/**
 * The dashboard's markup.
 *
 * Kept as a self-contained page rather than a screen inside the PWA: it is the owner's tool,
 * not a rider's, and it has no business being precached by the service worker, translated, or
 * shipped to eight thousand phones that will never open it.
 *
 * Everything it renders is an aggregate. There is deliberately no "users" panel — the app
 * stores nothing per person, so there is no such table to read, and the point of building it
 * this way is that adding one would be a visible decision rather than a quiet drift.
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHELL_CSS = `
  :root {
    --bg: #0b1220; --panel: #131d2f; --panel-2: #182338; --line: #253552;
    --ink: #eaf0fb; --ink-2: #93a3bf; --ink-3: #6b7b98;
    --brand: #5b8def; --brand-2: #8ab0f7; --good: #34c98a; --warn: #f0a340; --bad: #ef6a5e;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* Sidebar layout. Splitting by the question being asked means each screen holds one idea,
     rather than twenty panels competing on a single scroll. */
  .app { display: flex; min-height: 100vh; }
  .side {
    width: 232px; flex: none; position: sticky; top: 0; align-self: flex-start; height: 100vh;
    display: flex; flex-direction: column;
    padding: 22px 14px; border-right: 1px solid var(--line); background: var(--panel);
  }
  .brand {
    font-weight: 700; font-size: 16px; padding: 0 10px 18px; letter-spacing: -.3px;
    display: flex; align-items: center; gap: 9px;
  }
  .brand::before {
    content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--good);
    box-shadow: 0 0 0 4px rgba(52, 201, 138, .16);
  }
  #nav { display: flex; flex-direction: column; gap: 3px; }
  #nav button {
    text-align: left; border: 0; background: none; color: var(--ink-2); cursor: pointer;
    padding: 10px 12px; border-radius: 9px; font: inherit; font-size: 14px; width: 100%;
    transition: background .12s, color .12s;
  }
  #nav button:hover { background: var(--panel-2); color: var(--ink); }
  #nav button.on { background: var(--brand); color: #08111f; font-weight: 650; }
  .side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
  .signout {
    width: 100%; padding: 10px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 13.5px;
    border: 1px solid var(--line); background: var(--panel-2); color: var(--ink-2);
  }
  .signout:hover { color: var(--ink); }

  .main { flex: 1; min-width: 0; padding: 26px 28px 80px; }
  header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 22px; }
  header h1 { font-size: 24px; margin: 0; letter-spacing: -.5px; font-weight: 700; }
  .muted { color: var(--ink-2); font-size: 13px; }

  .range { display: flex; gap: 3px; background: var(--panel-2); padding: 4px; border-radius: 10px; }
  .range button {
    flex: 1; padding: 7px 4px; font: inherit; font-size: 12.5px; cursor: pointer;
    border: 0; background: none; color: var(--ink-2); border-radius: 7px;
  }
  .range button.on { background: var(--brand); color: #08111f; font-weight: 700; }

  /* Wider minimum than before: a panel narrower than about 340px cannot hold a label, a bar and
     a number on one line without truncating something. */
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
  .grid.one { grid-template-columns: 1fr; margin-top: 16px; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 20px;
  }
  .card h2 {
    font-size: 11.5px; text-transform: uppercase; letter-spacing: 1px;
    color: var(--ink-2); margin: 0 0 14px; font-weight: 700;
  }
  .big {
    font-size: 40px; font-weight: 700; letter-spacing: -1.4px; line-height: 1.05;
    font-variant-numeric: tabular-nums; margin-bottom: 4px;
  }

  .kv { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; font-size: 14px; }
  .kv + .kv { border-top: 1px solid var(--panel-2); }
  .kv span { color: var(--ink-2); }
  .kv b { font-weight: 650; font-variant-numeric: tabular-nums; }

  .row { display: flex; align-items: center; gap: 12px; padding: 7px 0; font-size: 13.5px; }
  .row + .row { border-top: 1px solid var(--panel-2); }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { height: 8px; border-radius: 4px; background: var(--brand); min-width: 4px; flex: none; }
  .n { color: var(--ink); font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; font-weight: 650; }
  .empty { color: var(--ink-3); font-size: 13.5px; padding: 18px 0; text-align: center; }
  .pill { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; }
  .pill.good { background: #143a2b; color: var(--good); }
  .pill.bad { background: #3a1a17; color: var(--bad); }

  /* Charts. Given real height and a labelled axis — a 40px sparkline with no scale is
     decoration, not a reading. */
  .chart-wrap { margin-bottom: 6px; }
  .chart-head {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 12px; color: var(--ink-2); margin-bottom: 6px;
  }
  .chart-head b { color: var(--ink); font-size: 15px; font-variant-numeric: tabular-nums; }
  .chart { width: 100%; height: 120px; display: block; overflow: visible; }
  .chart .grid-line { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .chart .area { fill: url(#g1); }
  .chart .line { fill: none; stroke: var(--brand); stroke-width: 2; vector-effect: non-scaling-stroke;
    stroke-linejoin: round; stroke-linecap: round; }
  .chart .dot { fill: var(--brand); }
  .chart-axis {
    display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3);
    margin: 6px 0 16px;
  }

  .hours { display: flex; align-items: flex-end; gap: 3px; height: 110px; }
  .hours i {
    flex: 1; background: var(--panel-2); border-radius: 3px 3px 0 0; min-height: 3px;
    transition: background .12s;
  }
  .hours i.peak { background: var(--brand); }
  .hours i.busy { background: #3a5c9e; }
  .hours-axis {
    display: flex; justify-content: space-between; margin-top: 7px;
    font-size: 11px; color: var(--ink-3);
  }

  /* Funnels */
  .step { margin-bottom: 14px; }
  .step-top { display: flex; justify-content: space-between; font-size: 13.5px; }
  .step-top b { font-variant-numeric: tabular-nums; }
  .step-bar { height: 9px; border-radius: 5px; background: var(--panel-2); margin-top: 6px; overflow: hidden; }
  .step-bar i { display: block; height: 100%; background: var(--brand); border-radius: 5px; }
  .step-drop { font-size: 11.5px; color: var(--bad); margin-top: 4px; }

  /* Tables */
  .filter {
    width: 100%; padding: 11px 14px; margin-bottom: 12px; font: inherit; font-size: 13.5px;
    border-radius: 10px; border: 1px solid var(--line); background: #0e1728; color: var(--ink);
  }
  .filter:focus { outline: none; border-color: var(--brand); }
  .tbl { max-height: 520px; overflow: auto; }
  .tr {
    display: grid; gap: 14px; align-items: center;
    padding: 9px 4px; border-bottom: 1px solid var(--panel-2); font-size: 13.5px;
  }
  .tr.th {
    color: var(--ink-2); font-size: 11px; text-transform: uppercase; letter-spacing: .8px;
    position: sticky; top: 0; background: var(--panel); z-index: 1; font-weight: 700;
  }
  .tr.th span { cursor: pointer; user-select: none; }
  .tr.th span:hover { color: var(--ink); }
  .tr span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr:not(.th):hover { background: var(--panel-2); }

  /* Journeys */
  .jrn { padding: 14px 0; border-top: 1px solid var(--panel-2); }
  .jrn:first-of-type { border-top: 0; }
  .jrn-head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
  .tag {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
    background: var(--panel-2); padding: 3px 9px; border-radius: 7px; color: var(--brand-2);
  }
  .hops { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .hop {
    font-size: 12px; background: var(--panel-2); border: 1px solid var(--line);
    padding: 3px 10px; border-radius: 999px; color: var(--ink-2); white-space: nowrap;
  }
  .arr { color: var(--ink-3); }

  .note {
    margin-top: 24px; padding: 16px 18px; border-radius: 14px;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink-2); font-size: 13px;
  }

  @media (max-width: 860px) {
    .app { flex-direction: column; }
    .side { width: auto; height: auto; position: static; border-right: 0;
      border-bottom: 1px solid var(--line); }
    #nav { flex-direction: row; flex-wrap: wrap; }
    #nav button { width: auto; }
    .main { padding: 20px 16px 60px; }
  }
`;

const LOGIN_CSS = `
  body { display: grid; place-items: center; min-height: 100vh; padding: 20px; }
  form { width: min(340px, 100%); }
  input {
    width: 100%; font: inherit; padding: 12px 14px; margin: 14px 0 10px;
    border-radius: 10px; border: 1px solid var(--line); background: #0f1828; color: var(--ink);
  }
  button { width: 100%; background: var(--brand); border-color: var(--brand); color: #08111f; font-weight: 650; }
  .err { color: var(--bad); font-size: 13px; min-height: 18px; }
`;

export function adminLogin(nonce, error = '') {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ST Tracker — admin</title>
<style nonce="${nonce}">${SHELL_CSS}${LOGIN_CSS}</style></head><body>
<form id="f" autocomplete="off">
  <h1>ST Tracker</h1>
  <div class="muted">Owner dashboard</div>
  <input id="p" type="password" placeholder="Password" autocomplete="current-password" required autofocus>
  <div class="err" id="e">${esc(error)}</div>
  <button type="submit">Sign in</button>
</form>
<script nonce="${nonce}">
  const form = document.getElementById('f');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('p').value }),
    });
    if (res.ok) return location.replace('/admin');
    // The server answers a failure with the whole login page, error and all.
    document.documentElement.innerHTML = await res.text();
  });
</script>
</body></html>`;
}

export function adminPage(nonce) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ST Tracker — admin</title>
<style nonce="${nonce}">${SHELL_CSS}</style></head><body>
<div class="app">
  <aside class="side">
    <div class="brand">ST Tracker</div>
    <nav id="nav">
      <button data-view="overview" class="on">Overview</button>
      <button data-view="people">People</button>
      <button data-view="behaviour">Behaviour</button>
      <button data-view="buses">Buses &amp; routes</button>
      <button data-view="community">Rider reports</button>
      <button data-view="sessions">Sessions</button>
      <button data-view="health">Health</button>
    </nav>
    <div class="side-foot">
      <div class="range" id="range">
        <button data-days="1" class="on">1d</button>
        <button data-days="7">7d</button>
        <button data-days="30">30d</button>
        <button data-days="90">90d</button>
      </div>
      <button id="out" class="signout">Sign out</button>
    </div>
  </aside>
  <main class="main">
    <header><h1 id="title">Overview</h1><span class="muted" id="stamp">loading…</span></header>
    <div id="view"></div>
  </main>
</div>
<script nonce="${nonce}">
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const OCCUPANCY = { 1: 'Many seats', 2: 'Some seats', 3: 'Standing', 4: 'Crowded', 5: 'Cannot board' };

const card = (title, inner) => '<div class="card"><h2>' + esc(title) + '</h2>' + inner + '</div>';
const kv = (k, v) => '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';

function bars(rows, label = (r) => r.key) {
  if (!rows || !rows.length) return '<div class="empty">Nothing yet today.</div>';
  const max = Math.max(...rows.map((r) => r.n));
  return rows.map((r) =>
    '<div class="row"><span class="name">' + esc(label(r)) + '</span>'
    + '<span class="bar" style="width:' + Math.round((r.n / max) * 96) + 'px"></span>'
    + '<span class="n">' + r.n + '</span></div>').join('');
}

function hours(rows) {
  if (!rows || !rows.length) return '<div class="empty">Nothing yet in this range.</div>';
  const byHour = Object.fromEntries(rows.map((r) => [String(r.key).padStart(2, '0'), r.n]));
  const max = Math.max(...rows.map((r) => r.n), 1);
  const peak = rows.reduce((a, b) => (b.n > a.n ? b : a));
  const total = rows.reduce((a, b) => a + b.n, 0);

  let out = '<div class="chart-head"><span>' + total + ' events</span><b>busiest '
    + esc(String(peak.key).padStart(2, '0')) + ':00</b></div><div class="hours">';
  for (let h = 0; h < 24; h += 1) {
    const key = String(h).padStart(2, '0');
    const n = byHour[key] || 0;
    // Three tiers rather than a gradient: quiet, busy, and the peak. A commuter day has two
    // humps and the point is to see them, not to grade every hour against every other.
    const cls = n === max && n > 0 ? ' class="peak"' : (n > max * 0.4 ? ' class="busy"' : '');
    out += '<i' + cls + ' style="height:' + Math.max(3, Math.round((n / max) * 110)) + 'px" title="'
      + esc(key + ':00 — ' + n) + '"></i>';
  }
  out += '</div><div class="hours-axis"><span>00</span><span>06</span><span>12</span>'
    + '<span>18</span><span>23</span></div>';
  return out;
}

/**
 * A trend line, drawn as inline SVG.
 *
 * No charting library: the page runs under a CSP that allows one nonced script and no external
 * hosts, and a trend line is a polyline. Given real height, gridlines at nothing/half/peak, and
 * a labelled date axis — a sparkline without a scale is decoration, not a reading.
 */
function line(rows, pick, label) {
  const vals = (rows || []).map(pick);
  const max = Math.max(...vals, 1);
  const total = vals.reduce((a, b) => a + b, 0);

  // A single day cannot be a trend, and a flat segment between two points would imply one.
  if (vals.length < 2) {
    return '<div class="chart-head"><span>' + esc(label) + '</span><b>' + (vals[0] || 0) + '</b></div>'
      + '<div class="empty">One day so far — a trend needs at least two.</div>';
  }

  const w = 300; const h = 110; const pad = 4;
  const x = (i) => (i / (vals.length - 1)) * w;
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const pts = vals.map((v, i) => x(i) + ',' + y(v)).join(' ');
  const gridLines = [0, 0.5, 1].map((q) =>
    '<line class="grid-line" x1="0" y1="' + y(max * q) + '" x2="' + w + '" y2="' + y(max * q) + '"/>').join('');
  const dots = vals.map((v, i) =>
    '<circle class="dot" cx="' + x(i) + '" cy="' + y(v) + '" r="2.5"/>').join('');

  return '<div class="chart-wrap">'
    + '<div class="chart-head"><span>' + esc(label) + ' · ' + total + ' total</span>'
    + '<b>peak ' + max + '</b></div>'
    + '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
    + '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#5b8def" stop-opacity=".34"/>'
    + '<stop offset="100%" stop-color="#5b8def" stop-opacity="0"/></linearGradient></defs>'
    + gridLines
    + '<polygon class="area" points="0,' + h + ' ' + pts + ' ' + w + ',' + h + '"/>'
    + '<polyline class="line" points="' + pts + '"/>' + dots
    + '</svg>'
    + '<div class="chart-axis"><span>' + esc(rows[0].day) + '</span>'
    + '<span>' + esc(rows[rows.length - 1].day) + '</span></div></div>';
}

/** A funnel: how many devices reached each step, and what fell away between them. */
function funnel(steps) {
  if (!steps || !steps.length) return '<div class="empty">Nothing yet in this range.</div>';
  const top = steps[0].devices || 1;
  return steps.map((s, i) => {
    const pct = Math.round((s.devices / top) * 100);
    const prev = i ? steps[i - 1].devices : s.devices;
    const drop = prev && i ? prev - s.devices : 0;
    return '<div class="step"><div class="step-top"><span>' + esc(s.label) + '</span>'
      + '<b>' + s.devices + '</b></div>'
      + '<div class="step-bar"><i style="width:' + pct + '%"></i></div>'
      + (drop > 0 ? '<div class="step-drop">-' + drop + ' here</div>' : '')
      + '</div>';
  }).join('');
}

const PREFIXES = ['screen:', 'act:', 'onboard:', 'set:', 'app:', 'entry:', 'err:', 'miss:',
  'perf:', 'net:', 'dwell:'];
/** Strips the category prefix so a card reads as labels rather than as raw counter names. */
function pretty(name) {
  for (const p of PREFIXES) if (name.indexOf(p) === 0) return name.slice(p.length).replace(/-/g, ' ');
  return name;
}

/** One visit, as the path actually taken through the app. */
function journeys(rows) {
  if (!rows || !rows.length) return '<div class="empty">No visits recorded yet.</div>';
  return rows.map((s) => {
    const when = new Date(s.last_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const path = (s.path || []).map((e) =>
      '<span class="hop">' + esc(pretty(e.name)) + (e.detail ? ' ' + esc(e.detail) : '') + '</span>')
      .join('<span class="arr">›</span>');
    return '<div class="jrn"><div class="jrn-head">'
      + '<span class="tag">' + esc(s.device) + '</span>'
      + '<span class="muted">' + esc(when) + ' · ' + s.durationSec + 's · '
      + esc(s.platform || '?') + (s.standalone ? ' · installed' : '') + '</span></div>'
      + '<div class="hops">' + (path || '<span class="muted">no steps</span>') + '</div></div>';
  }).join('');
}

let days = 1;
let view = 'overview';

async function load() {
  const res = await fetch('/admin/stats?days=' + days);
  if (res.status === 401) return location.replace('/admin');
  const d = await res.json();

  document.getElementById('stamp').textContent =
    (d.range.days === 1 ? d.range.to : d.range.from + ' to ' + d.range.to)
    + ' · up ' + Math.floor(d.server.uptimeSec / 3600) + 'h · v' + d.server.version;

  const p = d.people || {};
  const ret = p.retention || {};
  const events = (p.eventCounts) || [];
  const group = (prefix) => events
    .filter((e) => e.key.indexOf(prefix) === 0)
    .map((e) => ({ key: e.key.slice(prefix.length).replace(/-/g, ' '), n: e.n }));

  const VIEWS = {
    overview: () => grid([
      card('People', big(p.devices || 0,
        (p.sessions || 0) + ' visits · ' + (p.avgSessionSec || 0) + 's average · '
        + (p.bouncedPct || 0) + '% did nothing')),
      card('Coming back', big((ret.returningPct || 0) + '%',
        (ret.returning || 0) + ' of ' + (ret.total || 0) + ' had used it before')),
      card('Requests', big(d.traffic.requests, 'API calls in range')),
      card('Rider reports', big(d.community.reports, 'occupancy and status reports stored')),
      card('Devices and visits per day',
        line(p.daily || [], (r) => r.devices, 'devices')
        + line(p.daily || [], (r) => r.sessions, 'visits')),
      card('When the app is used (IST)', hours(clockRows(p.hours))),
    ]),

    people: () => grid([
      card('Devices', bars((p.platforms || []).map((r) => ({ key: r.key, n: r.devices })))),
      card('How people arrive', bars((p.entries || []).map((r) => ({ key: pretty(r.key), n: r.n })))),
      card('Where people start', bars((p.firstScreens || []).map((r) => ({ key: pretty(r.key), n: r.n })))),
      card('Did they come back?', (p.cohorts || []).length
        ? (p.cohorts).map((c) =>
          '<div class="row"><span class="name">' + esc(c.day) + '</span>'
          + '<span class="bar" style="width:' + Math.round((c.returned / Math.max(1, c.devices)) * 90) + 'px"></span>'
          + '<span class="n">' + c.returned + '/' + c.devices + '</span></div>').join('')
        : '<div class="empty">Needs more than one day.</div>'),
      card('Phones and networks', bars([...group('perf:'), ...group('net:'),
        ...events.filter((e) => e.key === 'screen:small' || e.key === 'screen:large')
          .map((e) => ({ key: e.key.slice(7), n: e.n }))])),
    ]),

    behaviour: () => grid([
      card('Screens opened', bars(group('screen:').filter((r) => !['small', 'large'].includes(r.key)))),
      card('What people do', bars(group('act:'))),
      card('Onboarding', bars(group('onboard:'))),
      card('Settings chosen', bars(group('set:'))),
      card('Onboarding funnel', funnel(p.funnels && p.funnels.onboarding)),
      card('Getting to an alert', funnel(p.funnels && p.funnels.alerts)),
      card('Where the app fails people', [...group('miss:'), ...group('err:')].length
        ? bars([...group('miss:'), ...group('err:')])
        : '<div class="empty">Nothing failed in this range.</div>'),
    ]) + wide(card('Every event recorded', table(
      ['Event', 'Count', 'Devices'],
      events.map((r) => [r.key, r.n, r.devices != null ? r.devices : '—']),
      'events'))),

    buses: () => grid([
      card('Most tracked buses', bars(d.buses.topPlates)),
      card('Most searched routes', bars(d.routes.topRoutes)),
      card('Busiest endpoints', bars(d.traffic.byEndpoint)),
      card('Observed timetable', (() => {
        const h = d.harvest || {};
        return kv('Harvest runs', h.runs || 0) + kv('Services read', h.trips || 0)
          + kv('Arrival times captured', h.arrivals || 0)
          + kv('Stored in total', d.community.arrivals) + kv('Errors', h.errors || 0);
      })()),
    ]) + wide(card('Bus lookups per device', table(
      ['Bus', 'Lookups', 'Devices', 'Sessions'],
      (p.busHistory || []).map((r) => [r.plate, r.lookups, r.devices, r.sessions]),
      'bushist')))
      + wide(card('Regulars — devices that keep returning to one bus', table(
        ['Device', 'Bus', 'Lookups', 'Days'],
        (p.regulars || []).map((r) => [r.device, r.plate, r.n, r.days]),
        'regulars'))),

    community: () => grid([
      card('How full riders say buses are', bars((d.community.occupancy || []).map(
        (r) => ({ key: OCCUPANCY[r.level] || r.level, n: r.n })))),
      card('Replacements reported', (d.community.replacements || []).length
        ? d.community.replacements.map((r) =>
          '<div class="row"><span class="name">' + esc(r.plate) + ' → ' + esc(r.replacement)
          + '</span><span class="n">' + r.n + '</span></div>').join('')
        : '<div class="empty">None reported.</div>'),
      card('Alerts', kv('Subscriptions', d.community.subscriptions)
        + kv('Waiting to fire', d.community.pendingAlerts) + kv('Sent', d.push.sent)
        + kv('Failed', d.push.failed) + kv('Expired', d.push.expired)),
    ]),

    sessions: () => wide(card('All sessions', table(
      ['Device', 'Day', 'Started', 'Seconds', 'Events', 'Platform', 'Entry'],
      (p.sessionList || []).map((r) => [
        r.device, r.day,
        new Date(r.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        Math.round((r.last_at - r.started_at) / 1000), r.events,
        r.platform + (r.standalone ? ' (installed)' : ''), pretty(r.entry || ''),
      ]), 'sessions')))
      + wide(card('Recent journeys', journeys(p.recent))),

    health: () => grid([
      card('GSRTC API health', (d.uptime || []).length
        ? (d.uptime).map((u) =>
          '<div class="kv"><span>' + esc(u.name) + '</span><b>' + u.calls + ' calls'
          + (u.dataErrors ? ' · <span style="color:var(--bad)">' + u.dataErrors + ' bad</span>' : '')
          + (u.medianMs != null ? ' · ' + u.medianMs + 'ms' : '') + '</b></div>').join('')
        : '<div class="empty">No upstream calls since restart.</div>'),
      card('Tracker', kv('Watching', d.tracker.watching) + kv('With a live fix', d.tracker.withFixes)
        + kv('Polls/sec', d.tracker.pollsPerSecond) + kv('Upstream errors', d.tracker.errors)),
      card('Probe', kv('Every', (d.probe && d.probe.everySec) + 's')
        + kv('Checks', d.probe && d.probe.checks) + kv('Per day', d.probe && d.probe.perDay)),
      card('Server', kv('Memory', d.server.memoryMb + ' MB') + kv('Cached', d.server.cacheEntries)
        + kv('Node', d.server.node) + kv('Version', d.server.version)),
    ]),
  };

  document.getElementById('view').innerHTML = (VIEWS[view] || VIEWS.overview)();
  document.getElementById('title').textContent =
    document.querySelector('#nav button.on')?.textContent || 'Overview';
}

const grid = (cards) => '<div class="grid">' + cards.filter(Boolean).join('') + '</div>';
const wide = (c) => '<div class="grid one">' + c + '</div>';
const big = (v, sub) => '<div class="big">' + esc(v) + '</div><div class="muted">' + esc(sub) + '</div>';
const clockRows = (rows) => (rows || []).map((r) => ({ key: String(r.hour).padStart(2, '0'), n: r.n }));

/**
 * A sortable, searchable table.
 *
 * Every panel above is a summary of something; this is the something. Sorting is by click on a
 * header and filtering is live over the rows already rendered — no refetch, because the data is
 * already here and a round trip to re-sort numbers would be theatre.
 */
function table(headers, rows, id) {
  if (!rows.length) return '<div class="empty">Nothing in this range.</div>';
  return '<input class="filter" data-filter="' + id + '" placeholder="Search…">'
    + '<div class="tbl" id="t-' + id + '">'
    + '<div class="tr th" style="grid-template-columns:repeat(' + headers.length + ',1fr)">'
    + headers.map((h, i) => '<span data-sort="' + i + '">' + esc(h) + '</span>').join('')
    + '</div>'
    + rows.map((r) => '<div class="tr" style="grid-template-columns:repeat(' + headers.length + ',1fr)" '
      + 'data-k="' + esc(r.join(' ').toLowerCase()) + '">'
      + r.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div>').join('')
    + '</div>';
}

// Live search across any rendered table.
document.addEventListener('input', (e) => {
  const id = e.target.dataset && e.target.dataset.filter;
  if (!id) return;
  const q = e.target.value.trim().toLowerCase();
  [...document.querySelectorAll('#t-' + id + ' .tr[data-k]')].forEach((row) => {
    row.style.display = row.dataset.k.includes(q) ? '' : 'none';
  });
});

// Click a header to sort. Numbers sort numerically, everything else alphabetically.
document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-sort]');
  if (!h) return;
  const tbl = h.closest('.tbl');
  const i = Number(h.dataset.sort);
  const asc = tbl.dataset.asc === String(i);
  tbl.dataset.asc = asc ? '' : String(i);
  const rows = [...tbl.querySelectorAll('.tr[data-k]')];
  rows.sort((a, b) => {
    const x = a.children[i].textContent.trim();
    const y = b.children[i].textContent.trim();
    const nx = Number(x); const ny = Number(y);
    const cmp = (!Number.isNaN(nx) && !Number.isNaN(ny)) ? nx - ny : x.localeCompare(y);
    return asc ? cmp : -cmp;
  });
  rows.forEach((r) => tbl.appendChild(r));
});

document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  view = b.dataset.view;
  [...document.querySelectorAll('#nav button')].forEach((x) => x.classList.toggle('on', x === b));
  load();
});

document.getElementById('range').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  days = Number(b.dataset.days);
  [...document.querySelectorAll('#range button')].forEach((x) => x.classList.toggle('on', x === b));
  load();
});

// The event filter is live, and applies to the table already rendered rather than refetching.
document.addEventListener('input', (e) => {
  if (e.target.id !== 'evfilter') return;
  const q = e.target.value.trim().toLowerCase();
  [...document.querySelectorAll('#evtable .tr[data-k]')].forEach((row) => {
    row.style.display = row.dataset.k.toLowerCase().includes(q) ? '' : 'none';
  });
});

document.getElementById('out').addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  location.replace('/admin');
});

load();
setInterval(load, 20000);
</script>
</body></html>`;
}

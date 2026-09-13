const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const SHELL_CSS = `
:root {
  --bg: #070a10;
  --panel: #0d131c;
  --panel-2: #111925;
  --panel-3: #172131;
  --line: #202c3e;
  --ink: #f4f7fb;
  --ink-2: #8c99ab;
  --ink-3: #637084;
  --brand: #e7aa55;
  --brand-2: #f5cb83;
  --good: #36d58f;
  --warn: #efad54;
  --bad: #ff7072;
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(900px 500px at 92% -12%, rgba(231,170,85,.10), transparent 62%),
    radial-gradient(700px 420px at -8% 10%, rgba(100,150,255,.055), transparent 60%),
    var(--bg);
  color: var(--ink);
  font: 14px/1.52 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

.app {
  display: flex;
  min-height: 100vh;
}

.side {
  width: 242px;
  flex: none;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  padding: 18px 13px;
  background: rgba(9, 13, 20, .94);
  border-right: 1px solid var(--line);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px 16px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--brand-2), #a86c24);
  color: #080b10;
  font-size: 12px;
  font-weight: 950;
  box-shadow: 0 10px 25px rgba(231,170,85,.14);
}

.brand-copy strong {
  display: block;
  font-size: 14px;
  letter-spacing: -.25px;
}

.brand-copy span {
  display: block;
  margin-top: 1px;
  color: var(--ink-2);
  font-size: 10px;
}

.owner {
  margin: 0 8px 15px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(231,170,85,.055), rgba(255,255,255,.012));
}

.owner strong {
  display: block;
  font-size: 11px;
}

.owner span {
  display: block;
  color: var(--ink-2);
  font-size: 9px;
  margin-top: 1px;
}

#nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
}

#nav button {
  position: relative;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 9px 12px 9px 14px;
  background: transparent;
  color: var(--ink-2);
  transition: background .18s ease, color .18s ease, transform .18s ease, border-color .18s ease;
}

#nav button:hover {
  background: rgba(255,255,255,.03);
  color: var(--ink);
  transform: translateX(2px);
}

#nav button.on {
  color: var(--ink);
  border-color: rgba(231,170,85,.16);
  background: linear-gradient(90deg, rgba(231,170,85,.14), rgba(231,170,85,.035));
}

#nav button.on::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 5px;
  background: var(--brand);
  box-shadow: 0 0 15px rgba(231,170,85,.3);
}

.side-foot {
  margin-top: auto;
  padding-top: 14px;
  display: grid;
  gap: 9px;
}

.range {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-2);
}

.range button {
  border: 0;
  border-radius: 7px;
  padding: 6px 3px;
  background: transparent;
  color: var(--ink-2);
  font-size: 10px;
  transition: background .18s ease, color .18s ease;
}

.range button.on {
  color: #0a0d12;
  background: var(--brand);
  font-weight: 800;
}

.signout {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  background: var(--panel-2);
  color: var(--ink-2);
  transition: color .18s ease, border-color .18s ease, transform .18s ease;
}

.signout:hover {
  color: var(--ink);
  border-color: #2b3b52;
  transform: translateY(-1px);
}

.main {
  flex: 1;
  min-width: 0;
  padding: 26px 28px 65px;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 12;
  margin: -26px -28px 22px;
  padding: 22px 28px 15px;
  background: linear-gradient(180deg, rgba(7,10,16,.98) 56%, rgba(7,10,16,.84), transparent);
  backdrop-filter: blur(10px);
}

.topline {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.kicker {
  color: var(--brand);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .17em;
}

.topbar h1 {
  margin: 4px 0;
  font-size: 27px;
  line-height: 1.1;
  letter-spacing: -.8px;
}

.subline {
  color: var(--ink-2);
  font-size: 10.5px;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.select {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 10px;
  background: var(--panel);
  color: var(--ink);
  outline: none;
}

.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(54,213,143,.18);
  border-radius: 999px;
  padding: 7px 9px;
  color: var(--good);
  background: rgba(54,213,143,.04);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .11em;
}

.live i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--good);
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(54,213,143,.4); }
  70% { box-shadow: 0 0 0 7px rgba(54,213,143,0); }
  100% { box-shadow: 0 0 0 0 rgba(54,213,143,0); }
}

.grid {
  display: grid;
  gap: 13px;
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.card {
  min-width: 0;
  padding: 17px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: linear-gradient(180deg, rgba(14,20,30,.97), rgba(10,15,23,.97));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.018);
  animation: cardIn .32s ease both;
  transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
}

.card:hover {
  transform: translateY(-2px);
  border-color: rgba(231,170,85,.15);
  box-shadow: 0 22px 65px rgba(0,0,0,.24);
}

@keyframes cardIn {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: none; }
}

.card h2 {
  margin: 0 0 12px;
  color: var(--ink-2);
  font-size: 9.5px;
  font-weight: 900;
  letter-spacing: .13em;
  text-transform: uppercase;
}

.big {
  font-size: 33px;
  line-height: 1;
  font-weight: 850;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--ink-2);
  font-size: 10px;
}

.kpi {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.kpi-icon {
  min-width: 35px;
  height: 35px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--brand);
  background: rgba(231,170,85,.065);
  font-size: 9px;
  font-weight: 900;
}

.good { color: var(--good); }
.bad { color: var(--bad); }
.gold { color: var(--brand); }

.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid rgba(255,255,255,.045);
}

.kv:first-child {
  border-top: 0;
}

.kv span {
  color: var(--ink-2);
  font-size: 10px;
}

.kv b {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rows {
  display: grid;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 45px;
  gap: 9px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid rgba(255,255,255,.045);
}

.row:first-child {
  border-top: 0;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
}

.bar-track {
  width: 110px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--panel-3);
}

.bar {
  display: block;
  min-width: 3px;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  transition: width .55s cubic-bezier(.2,.8,.2,1);
}

.n {
  text-align: right;
  font-size: 10.5px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
  color: var(--ink-2);
  font-size: 10px;
}

.chart-head b {
  color: var(--ink);
  font-size: 11px;
}

.chart-wrap {
  width: 100%;
}

.chart {
  width: 100%;
  height: 170px;
  display: block;
}

.chart .grid-line {
  stroke: var(--line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.chart .line {
  fill: none;
  stroke: var(--brand);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 700;
  stroke-dashoffset: 700;
  animation: draw .85s ease forwards;
}

.chart .dot {
  fill: var(--brand-2);
  opacity: 0;
  animation: dotIn .3s ease forwards;
}

@keyframes draw {
  to { stroke-dashoffset: 0; }
}

@keyframes dotIn {
  to { opacity: 1; }
}

.chart-axis {
  display: flex;
  justify-content: space-between;
  color: var(--ink-3);
  font-size: 8.5px;
  margin-top: 4px;
}

.hours {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 122px;
}

.hours i {
  flex: 1;
  min-width: 2px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--panel-3);
  transition: height .5s ease, background .2s ease;
}

.hours i.busy { background: #39537f; }

.hours i.peak {
  background: var(--brand);
  box-shadow: 0 0 16px rgba(231,170,85,.18);
}

.hours-axis {
  display: flex;
  justify-content: space-between;
  color: var(--ink-3);
  font-size: 8.5px;
  margin-top: 6px;
}

.step {
  margin-bottom: 13px;
}

.step:last-child {
  margin-bottom: 0;
}

.step-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
}

.step-top b {
  font-variant-numeric: tabular-nums;
}

.step-track {
  height: 7px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--panel-3);
}

.step-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  animation: grow .65s cubic-bezier(.2,.8,.2,1) both;
}

@keyframes grow {
  from { width: 0; }
}

.step-drop {
  margin-top: 3px;
  color: var(--bad);
  font-size: 9px;
}

.filter {
  width: 100%;
  margin-bottom: 10px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  outline: none;
  background: #090f17;
  color: var(--ink);
  font-size: 10.5px;
}

.filter:focus {
  border-color: rgba(231,170,85,.45);
}

.tbl-wrap {
  overflow: auto;
  max-height: 530px;
}

.tbl {
  min-width: 650px;
}

.tr {
  display: grid;
  gap: 11px;
  align-items: center;
  padding: 8px 4px;
  border-top: 1px solid rgba(255,255,255,.045);
  font-size: 10px;
}

.tr.th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--panel);
  color: var(--ink-2);
  border-top: 0;
  text-transform: uppercase;
  letter-spacing: .08em;
  font-size: 8.5px;
  font-weight: 800;
}

.tr span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tr.th span {
  cursor: pointer;
  user-select: none;
}

.tr.th span:hover {
  color: var(--ink);
}

.tr:not(.th):hover {
  background: rgba(255,255,255,.02);
}

.jrn {
  padding: 12px 0;
  border-top: 1px solid rgba(255,255,255,.045);
}

.jrn:first-child {
  border-top: 0;
}

.jrn-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 9px;
  margin-bottom: 7px;
}

.tag {
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--panel-3);
  color: var(--brand-2);
  font: 9px ui-monospace, SFMono-Regular, Menlo, monospace;
}

.hops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.hop {
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-2);
  color: #b8c3d0;
  font-size: 9.5px;
}

.arr {
  color: var(--ink-3);
}

.empty {
  padding: 23px 0;
  color: var(--ink-3);
  text-align: center;
  font-size: 10.5px;
}

.footer-brand {
  margin-top: 17px;
  color: var(--ink-3);
  text-align: center;
  font-size: 9px;
}

.footer-brand b {
  color: var(--brand);
}

@media (max-width: 1120px) {
  .side { width: 218px; }
}

@media (max-width: 840px) {
  .app {
    display: block;
  }

  .side {
    position: sticky;
    top: 0;
    width: 100%;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 9px;
  }

  .brand {
    padding: 4px 7px 8px;
  }

  .owner {
    display: none;
  }

  #nav {
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
  }

  #nav button {
    width: auto;
    flex: none;
    white-space: nowrap;
    font-size: 10.5px;
    padding: 8px 10px;
  }

  .side-foot {
    display: flex;
    align-items: center;
    margin-top: 7px;
    padding-top: 0;
  }

  .range {
    flex: 1;
  }

  .signout {
    width: auto;
  }

  .main {
    padding: 17px 12px 45px;
  }

  .topbar {
    margin: -17px -12px 17px;
    padding: 16px 12px 13px;
  }

  .topline {
    align-items: flex-start;
    flex-direction: column;
  }

  .top-actions {
    width: 100%;
  }

  .select {
    flex: 1;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .card {
    grid-column: auto !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const LOGIN_CSS = `
body {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 20px;
}

.login {
  width: min(410px, 100%);
  padding: 34px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(14,20,30,.98), rgba(8,13,20,.98));
  box-shadow: 0 28px 90px rgba(0,0,0,.35);
  animation: cardIn .45s ease both;
}

.login-mark {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  margin-bottom: 25px;
  border-radius: 17px;
  background: linear-gradient(135deg, var(--brand-2), #a86a22);
  color: #080b10;
  font-size: 14px;
  font-weight: 950;
}

.login h1 {
  margin: 5px 0;
  font-size: 29px;
  letter-spacing: -.8px;
}

.login p {
  margin: 5px 0 26px;
  color: var(--ink-2);
  font-size: 12px;
}

.login label {
  display: block;
  margin-bottom: 7px;
  color: #c1ccd8;
  font-size: 9px;
  font-weight: 850;
  letter-spacing: .08em;
}

.login input {
  width: 100%;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 10px;
  outline: none;
  background: #090e15;
  color: var(--ink);
}

.login input:focus {
  border-color: rgba(231,170,85,.5);
}

.login button {
  width: 100%;
  margin-top: 12px;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: var(--brand);
  color: #080b10;
  font-weight: 850;
}

.login .err {
  min-height: 19px;
  margin-top: 8px;
  color: var(--bad);
  font-size: 10px;
}

.login .owner {
  display: block;
  margin: 23px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 9px;
}

.login .owner b {
  color: var(--brand);
}
`;

export function adminLogin(nonce, error = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>ST Tracker Control Center</title>
<style nonce="${nonce}">${SHELL_CSS}${LOGIN_CSS}</style>
</head>
<body>
<form class="login" id="f" autocomplete="off">
  <div class="login-mark">ST</div>
  <div class="kicker">PRIVATE CONTROL CENTER</div>
  <h1>ST Tracker</h1>
  <p>Analytics, operations and product intelligence.</p>

  <label for="p">ADMIN PASSWORD</label>
  <input id="p" type="password" autocomplete="current-password" required>

  <div class="err" id="e">${esc(error)}</div>

  <button type="submit">Sign in</button>

  <div class="owner">
    Designed &amp; Engineered by <b>Devam Namera</b><br>
    Founder &amp; Lead Developer
  </div>
</form>

<script nonce="${nonce}">
const form = document.getElementById('f');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const input = document.getElementById('p');
  const err = document.getElementById('e');

  err.textContent = '';

  try {
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });

    if (response.ok) {
      location.replace('/admin');
      return;
    }

    document.documentElement.innerHTML = await response.text();
  } catch {
    err.textContent = 'Unable to connect to the server.';
  }
});
</script>
</body>
</html>`;
}

export function adminPage(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>ST Tracker Control Center</title>
<style nonce="${nonce}">${SHELL_CSS}</style>
</head>
<body>

<div class="app">

<aside class="side">
  <div class="brand">
    <div class="brand-mark">ST</div>
    <div class="brand-copy">
      <strong>ST Tracker</strong>
      <span>Control Center</span>
    </div>
  </div>

  <div class="owner">
    <strong>Devam Namera</strong>
    <span>Founder &amp; Lead Developer</span>
  </div>

  <nav id="nav">
    <button data-view="overview" class="on">Overview</button>
    <button data-view="people">Users &amp; Devices</button>
    <button data-view="behaviour">Behaviour</button>
    <button data-view="buses">Buses &amp; Routes</button>
    <button data-view="community">Rider Reports</button>
    <button data-view="sessions">Sessions</button>
    <button data-view="health">System Health</button>
  </nav>

  <div class="side-foot">
    <div class="range" id="range">
      <button data-days="1" class="on">1D</button>
      <button data-days="7">7D</button>
      <button data-days="30">30D</button>
      <button data-days="90">90D</button>
    </div>

    <button id="out" class="signout">Sign out</button>
  </div>
</aside>

<main class="main">

<header class="topbar">
  <div class="topline">
    <div>
      <div class="kicker">ST TRACKER CONTROL CENTER</div>
      <h1 id="title">Overview</h1>
      <div id="stamp" class="subline">Loading analytics…</div>
    </div>

    <div class="top-actions">
      <select id="days-select" class="select">
        <option value="1">Today</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </select>

      <span class="live"><i></i>LIVE</span>
    </div>
  </div>
</header>

<div id="view"></div>

<div class="footer-brand">
  Designed &amp; Engineered by <b>Devam Namera</b>
  · Founder &amp; Lead Developer
  · ST Tracker
</div>

</main>
</div>

<script nonce="${nonce}">

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmt = (v) => new Intl.NumberFormat('en-IN').format(Number(v || 0));

const OCCUPANCY = {
  1: 'Many seats',
  2: 'Some seats',
  3: 'Standing',
  4: 'Crowded',
  5: 'Cannot board',
};

let days = 1;
let view = 'overview';
let data = null;

const card = (title, inner) =>
  '<div class="card">' +
    '<h2>' + esc(title) + '</h2>' +
    inner +
  '</div>';

const kv = (key, value) =>
  '<div class="kv">' +
    '<span>' + esc(key) + '</span>' +
    '<b>' + esc(value) + '</b>' +
  '</div>';

const big = (value, sub = '') =>
  '<div class="big">' + esc(value) + '</div>' +
  (sub ? '<div class="muted">' + esc(sub) + '</div>' : '');

const grid = (cards) =>
  '<div class="grid">' + cards.filter(Boolean).join('') + '</div>';

const wide = (content) =>
  '<div class="grid">' + content.replace ? content : content + '</div>';

const clockRows = (rows) =>
  (rows || []).map((r) => ({
    key: String(r.hour ?? r.key ?? '').padStart(2, '0'),
    n: Number(r.n || 0),
  }));

function bars(rows, label = (r) => r.key) {
  if (!rows || !rows.length) {
    return '<div class="empty">No data in this range.</div>';
  }

  const max = Math.max(...rows.map((r) => Number(r.n || 0)), 1);

  return '<div class="rows">' +
    rows.map((r) => {
      const value = Number(r.n || 0);
      const width = Math.max(3, Math.round((value / max) * 100));

      return '<div class="row">' +
        '<span class="name">' + esc(label(r)) + '</span>' +
        '<span class="bar-track">' +
          '<span class="bar" style="width:' + width + '%"></span>' +
        '</span>' +
        '<span class="n">' + fmt(value) + '</span>' +
      '</div>';
    }).join('') +
  '</div>';
}

function line(rows, pick, label) {
  const source = rows || [];
  const values = source.map(pick).map((v) => Number(v || 0));

  if (values.length < 2) {
    return '<div class="chart-head">' +
      '<span>' + esc(label) + '</span>' +
      '<b>' + fmt(values[0] || 0) + '</b>' +
    '</div>' +
    '<div class="empty">A trend needs at least two data points.</div>';
  }

  const max = Math.max(...values, 1);
  const width = 640;
  const height = 160;

  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - 8 - (v / max) * (height - 16);
  const points = values.map((v, i) => x(i) + ',' + y(v)).join(' ');
  const total = values.reduce((a, b) => a + b, 0);

  const gridLines = [.25, .5, .75].map((q) =>
    '<line class="grid-line" x1="0" y1="' + y(max * q) +
      '" x2="' + width + '" y2="' + y(max * q) + '"></line>'
  ).join('');

  const dots = values.map((v, i) =>
    '<circle class="dot" cx="' + x(i) + '" cy="' + y(v) + '" r="2.4"></circle>'
  ).join('');

  return '<div class="chart-head">' +
    '<span>' + esc(label) + ' · ' + fmt(total) + ' total</span>' +
    '<b>peak ' + fmt(max) + '</b>' +
  '</div>' +
  '<div class="chart-wrap">' +
    '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
      gridLines +
      '<polyline class="line" points="' + points + '"></polyline>' +
      dots +
    '</svg>' +
    '<div class="chart-axis">' +
      '<span>' + esc(source[0].day) + '</span>' +
      '<span>' + esc(source[Math.floor(source.length / 2)].day) + '</span>' +
      '<span>' + esc(source[source.length - 1].day) + '</span>' +
    '</div>' +
  '</div>';
}

function hours(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">No hourly data yet.</div>';
  }

  const map = Object.fromEntries(
    rows.map((r) => [
      String(r.hour ?? r.key).padStart(2, '0'),
      Number(r.n || 0),
    ])
  );

  const max = Math.max(...Object.values(map), 1);

  let peakKey = '00';
  let peakValue = 0;

  for (let h = 0; h < 24; h += 1) {
    const key = String(h).padStart(2, '0');
    const value = map[key] || 0;

    if (value > peakValue) {
      peakValue = value;
      peakKey = key;
    }
  }

  let out =
    '<div class="chart-head">' +
      '<span>Events by hour · IST</span>' +
      '<b>Peak ' + peakKey + ':00</b>' +
    '</div>' +
    '<div class="hours">';

  for (let h = 0; h < 24; h += 1) {
    const key = String(h).padStart(2, '0');
    const value = map[key] || 0;
    const height = Math.max(3, Math.round((value / max) * 120));
    const cls = value === max && value > 0
      ? 'peak'
      : value > max * .4
        ? 'busy'
        : '';

    out += '<i class="' + cls + '" style="height:' + height +
      'px" title="' + esc(key + ':00 · ' + value) + '"></i>';
  }

  return out +
    '</div>' +
    '<div class="hours-axis">' +
      '<span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>' +
    '</div>';
}

function funnel(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">No funnel data yet.</div>';
  }

  const top = Number(rows[0].devices || 0) || 1;

  return rows.map((r, i) => {
    const devices = Number(r.devices || 0);
    const pct = Math.max(0, Math.min(100, Math.round((devices / top) * 100)));
    const previous = i ? Number(rows[i - 1].devices || 0) : devices;
    const drop = i ? Math.max(0, previous - devices) : 0;

    return '<div class="step">' +
      '<div class="step-top">' +
        '<span>' + esc(r.label) + '</span>' +
        '<b>' + fmt(devices) + '</b>' +
      '</div>' +
      '<div class="step-track">' +
        '<i style="width:' + pct + '%"></i>' +
      '</div>' +
      (drop ? '<div class="step-drop">−' + fmt(drop) + ' from previous step</div>' : '') +
    '</div>';
  }).join('');
}

const PREFIXES = [
  'screen:', 'act:', 'onboard:', 'set:', 'app:', 'entry:',
  'err:', 'miss:', 'perf:', 'net:', 'dwell:'
];

function pretty(name) {
  let value = String(name ?? '');

  for (const prefix of PREFIXES) {
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }

  return value.replace(/-/g, ' ');
}

function table(headers, rows, id) {
  if (!rows || !rows.length) {
    return '<div class="empty">Nothing recorded in this range.</div>';
  }

  const count = headers.length;

  return '<input class="filter" data-filter="' + esc(id) +
    '" placeholder="Search this table…">' +
    '<div class="tbl-wrap">' +
      '<div class="tbl" id="t-' + esc(id) + '">' +
        '<div class="tr th" style="grid-template-columns:repeat(' +
          count + ',minmax(120px,1fr))">' +
          headers.map((h, i) =>
            '<span data-sort="' + i + '">' + esc(h) + '</span>'
          ).join('') +
        '</div>' +
        rows.map((row) =>
          '<div class="tr" data-k="' +
            esc(row.join(' ').toLowerCase()) +
            '" style="grid-template-columns:repeat(' +
              count + ',minmax(120px,1fr))">' +
            row.map((cell) =>
              '<span>' + esc(cell) + '</span>'
            ).join('') +
          '</div>'
        ).join('') +
      '</div>' +
    '</div>';
}

function journeys(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">No journey data yet.</div>';
  }

  return rows.map((s) => {
    const started = s.started_at
      ? new Date(s.started_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '--:--';

    const duration = s.durationSec ??
      Math.max(
        0,
        Math.round(
          ((s.last_at || s.started_at || 0) - (s.started_at || 0)) / 1000
        )
      );

    const path = (s.path || []).map((event) =>
      '<span class="hop">' +
        esc(pretty(event.name)) +
        (event.detail ? ' · ' + esc(event.detail) : '') +
      '</span>'
    ).join('<span class="arr">›</span>');

    return '<div class="jrn">' +
      '<div class="jrn-head">' +
        '<span class="tag">' + esc(s.device || 'session') + '</span>' +
        '<span class="muted">' +
          esc(started) + ' · ' +
          fmt(duration) + 's · ' +
          esc(s.platform || 'unknown') +
          (s.standalone ? ' · PWA' : '') +
        '</span>' +
      '</div>' +
      '<div class="hops">' +
        (path || '<span class="muted">No recorded steps</span>') +
      '</div>' +
    '</div>';
  }).join('');
}

function overview() {
  const p = data.people || {};
  const r = p.retention || {};

  const api = data.traffic || {};
  const buses = data.buses || {};
  const routes = data.routes || {};

  const requests = api.requestsToday ?? api.requests ?? 0;
  const searches =
    Number(buses.lookupsToday || 0) +
    Number(routes.searchesToday || 0);

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Live users',
        '<div class="kpi">' +
          '<div>' + big(data.tracker?.watching || 0, 'Currently watched') + '</div>' +
          '<div class="kpi-icon">LIVE</div>' +
        '</div>', 3),

      card('Users / devices',
        '<div class="kpi">' +
          '<div>' + big(p.devices || 0, 'Unique devices') + '</div>' +
          '<div class="kpi-icon">USR</div>' +
        '</div>', 3),

      card('Sessions',
        '<div class="kpi">' +
          '<div>' + big(p.sessions || 0, 'Visits in range') + '</div>' +
          '<div class="kpi-icon">SES</div>' +
        '</div>', 3),

      card('API requests',
        '<div class="kpi">' +
          '<div>' + big(requests, 'Requests today') + '</div>' +
          '<div class="kpi-icon">API</div>' +
        '</div>', 3),

      card('Search activity',
        '<div class="kpi">' +
          '<div>' + big(searches, 'Bus + route searches') + '</div>' +
          '<div class="kpi-icon">SRCH</div>' +
        '</div>', 3),

      card('Returning users',
        '<div class="kpi">' +
          '<div>' + big((r.returningPct || 0) + '%',
            fmt(r.returning || 0) + ' returning devices') + '</div>' +
          '<div class="kpi-icon">RET</div>' +
        '</div>', 3),

      card('Daily usage',
        line(p.daily || [], (x) => x.devices, 'Devices') +
        line(p.daily || [], (x) => x.sessions, 'Sessions'), 6),

      card('When ST Tracker is used',
        hours(p.hours || []), 6),

      card('Popular buses',
        bars(buses.topPlates || []), 6),

      card('Popular routes',
        bars(routes.topRoutes || []), 6),

      card('Traffic endpoints',
        bars(api.byEndpoint || []), 6),

      card('Platform mix',
        bars((p.platforms || []).map((x) => ({
          key: x.key,
          n: x.devices ?? x.n,
        }))), 6),

    '</div>';
}

function people() {
  const p = data.people || {};

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Devices',
        bars((p.platforms || []).map((r) => ({
          key: r.key,
          n: r.devices ?? r.n,
        }))), 4),

      card('How people arrive',
        bars((p.entries || []).map((r) => ({
          key: pretty(r.key),
          n: r.n,
        }))), 4),

      card('Where sessions start',
        bars((p.firstScreens || []).map((r) => ({
          key: pretty(r.key),
          n: r.n,
        }))), 4),

      card('Retention cohorts',
        bars((p.cohorts || []).map((r) => ({
          key: r.day,
          n: r.returned || 0,
        }))), 4),

      card('Network & performance',
        bars((p.eventCounts || []).filter((r) =>
          /^(net:|perf:)/.test(r.key)
        )), 4),

      card('PWA vs browser',
        bars((p.eventCounts || []).filter((r) =>
          /^app:/.test(r.key)
        )), 4),

      card('Daily growth',
        line(p.daily || [], (x) => x.devices, 'Devices') +
        line(p.daily || [], (x) => x.sessions, 'Sessions'), 12),

    '</div>';
}

function behaviour() {
  const p = data.people || {};
  const events = p.eventCounts || [];

  const group = (prefix) => events
    .filter((e) => String(e.key).startsWith(prefix))
    .map((e) => ({
      key: pretty(e.key),
      n: e.n,
    }));

  const errors = [
    ...group('err:'),
    ...group('miss:'),
  ];

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Screens opened',
        bars(group('screen:').filter((r) =>
          !['small', 'large'].includes(r.key)
        )), 4),

      card('User actions',
        bars(group('act:')), 4),

      card('Onboarding',
        bars(group('onboard:')), 4),

      card('Settings',
        bars(group('set:')), 4),

      card('Errors & misses',
        errors.length
          ? bars(errors)
          : '<div class="empty">No failures recorded.</div>', 6),

      card('Onboarding funnel',
        funnel(p.funnels?.onboarding || []), 6),

      card('Alert funnel',
        funnel(p.funnels?.alerts || []), 6),

      wide(
        card('All events',
          table(
            ['Event', 'Count', 'Devices'],
            events.map((r) => [
              r.key,
              r.n,
              r.devices != null ? r.devices : '—',
            ]),
            'events'
          )
        )
      ),

    '</div>';
}

function buses() {
  const p = data.people || {};
  const h = data.harvest || data.runtime?.harvest || {};

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Most tracked buses',
        bars(data.buses?.topPlates || []), 6),

      card('Most searched routes',
        bars(data.routes?.topRoutes || []), 6),

      card('Timetable harvest',
        kv('Harvest runs', h.runs || 0) +
        kv('Services read', h.trips || 0) +
        kv('Arrival times', h.arrivals || 0) +
        kv('Stored arrivals', data.community?.arrivals || 0) +
        kv('Harvest errors', h.errors || 0), 6),

      card('Current watching',
        big(data.buses?.watchedNow || data.tracker?.watching || 0,
          'Live bus trackers'), 6),

      wide(
        card('Bus lookups',
          table(
            ['Bus', 'Lookups', 'Devices', 'Sessions'],
            (p.busHistory || []).map((r) => [
              r.plate,
              r.lookups,
              r.devices,
              r.sessions,
            ]),
            'bushistory'
          )
        )
      ),

      wide(
        card('Regular bus usage',
          table(
            ['Device', 'Bus', 'Lookups', 'Days'],
            (p.regulars || []).map((r) => [
              r.device,
              r.plate,
              r.n,
              r.days,
            ]),
            'regulars'
          )
        )
      ),

    '</div>';
}

function community() {
  const c = data.community || {};
  const push = data.push || {};

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Occupancy reports',
        bars((c.occupancy || []).map((r) => ({
          key: OCCUPANCY[r.level] || r.level,
          n: r.n,
        }))), 6),

      card('Replacement reports',
        (c.replacements || []).length
          ? '<div class="rows">' +
              c.replacements.map((r) =>
                '<div class="row">' +
                  '<span class="name">' +
                    esc(r.plate) + ' → ' + esc(r.replacement) +
                  '</span>' +
                  '<span></span>' +
                  '<span class="n">' + fmt(r.n) + '</span>' +
                '</div>'
              ).join('') +
            '</div>'
          : '<div class="empty">No replacement reports.</div>', 6),

      card('Push delivery',
        kv('Subscriptions', c.subscriptions || 0) +
        kv('Pending', c.pendingAlerts || 0) +
        kv('Sent', push.sent || 0) +
        kv('Failed', push.failed || 0) +
        kv('Expired', push.expired || 0), 4),

      card('Push success',
        big(
          push.sent && push.failed
            ? Math.round((push.sent / (push.sent + push.failed)) * 100) + '%'
            : '—',
          'Delivery success rate'
        ), 4),

      card('Community data',
        kv('Rider reports', c.reports || 0) +
        kv('Arrivals', c.arrivals || 0), 4),

    '</div>';
}

function sessions() {
  const rows = (data.people?.sessionList || []).map((r) => [
    r.device,
    r.day,
    r.started_at
      ? new Date(r.started_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—',
    Math.round(
      ((r.last_at || r.started_at || 0) - (r.started_at || 0)) / 1000
    ) + 's',
    r.events,
    r.platform,
    r.standalone ? 'PWA' : 'Browser',
    pretty(r.entry || ''),
  ]);

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      wide(
        card('All sessions',
          table(
            ['Device', 'Day', 'Started', 'Duration', 'Events', 'Platform', 'Mode', 'Entry'],
            rows,
            'sessions'
          )
        )
      ),

      wide(
        card('Recent journeys',
          journeys(data.people?.recent || [])
        )
      ),

    '</div>';
}

function health() {
  const server = data.server || {};
  const tracker = data.tracker || {};
  const push = data.push || {};
  const harvest = data.harvest || {};

  document.getElementById('view').innerHTML =
    '<div class="grid">' +

      card('Server',
        kv('Node', server.node || '—') +
        kv('Version', server.version || '—') +
        kv('Memory', server.memoryMb ? server.memoryMb + ' MB' : '—') +
        kv('Uptime', server.uptimeSec
          ? Math.floor(server.uptimeSec / 3600) + 'h'
          : '—'), 4),

      card('Tracker',
        kv('Watching', tracker.watching || 0) +
        kv('Live fixes', tracker.withFixes || 0) +
        kv('Polls/sec', tracker.pollsPerSecond || 0) +
        kv('Upstream errors', tracker.errors || 0), 4),

      card('Notifications',
        kv('Subscriptions', push.subscriptions || data.community?.subscriptions || 0) +
        kv('Pending', push.pendingAlerts || data.community?.pendingAlerts || 0) +
        kv('Sent', push.sent || 0) +
        kv('Failed', push.failed || 0), 4),

      card('Harvest',
        kv('Runs', harvest.runs || 0) +
        kv('Services', harvest.trips || 0) +
        kv('Arrivals', harvest.arrivals || 0) +
        kv('Errors', harvest.errors || 0), 4),

      wide(
        card('GSRTC upstream',
          data.uptime?.length
            ? data.uptime.map((u) =>
                kv(
                  u.name,
                  fmt(u.calls || 0) + ' calls' +
                  (u.medianMs != null
                    ? ' · ' + fmt(u.medianMs) + ' ms'
                    : '') +
                  (u.dataErrors
                    ? ' · ' + fmt(u.dataErrors) + ' errors'
                    : '')
                )
              ).join('')
            : '<div class="empty">No upstream calls recorded since restart.</div>'
        )
      ),

      card('Probe',
        kv('Checks', data.probe?.checks || 0) +
        kv('Interval', data.probe?.everySec
          ? data.probe.everySec + 's'
          : '—') +
        kv('Daily target', data.probe?.perDay || 0), 4),

      card('Search health',
        kv('Bus searches', data.buses?.lookupsToday || 0) +
        kv('Route searches', data.routes?.searchesToday || 0) +
        kv('Live watches', data.buses?.watchedNow || data.tracker?.watching || 0), 4),

      card('Status',
        '<div class="kpi">' +
          '<div>' +
            '<div class="big good">HEALTHY</div>' +
            '<div class="muted">ST Tracker server operational</div>' +
          '</div>' +
          '<div class="kpi-icon">OK</div>' +
        '</div>', 4),

    '</div>';
}

const VIEWS = {
  overview,
  people,
  behaviour,
  buses,
  community,
  sessions,
  health,
};

async function load() {
  const stamp = document.getElementById('stamp');

  try {
    stamp.textContent = 'Refreshing analytics…';

    const response = await fetch(
      '/admin/stats?days=' + encodeURIComponent(days),
      { credentials: 'same-origin' }
    );

    if (response.status === 401) {
      location.replace('/admin');
      return;
    }

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    data = await response.json();

    const range = data.range || {};

    stamp.textContent =
      (range.days === 1
        ? range.to || 'Today'
        : (range.from || '') + ' → ' + (range.to || '')) +
      ' · Auto refresh every 20s';

    document.getElementById('title').textContent =
      document.querySelector('#nav button.on')?.textContent || 'Overview';

    (VIEWS[view] || VIEWS.overview)();
  } catch (error) {
    console.error(error);

    document.getElementById('view').innerHTML =
      card(
        'Dashboard unavailable',
        '<div class="empty">Unable to load analytics right now.</div>'
      );

    stamp.textContent = 'Connection error';
  }
}

document.getElementById('nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;

  view = button.dataset.view;

  document.querySelectorAll('#nav button').forEach((item) => {
    item.classList.toggle('on', item === button);
  });

  load();
});

document.getElementById('range').addEventListener('click', (event) => {
  const button = event.target.closest('[data-days]');
  if (!button) return;

  days = Number(button.dataset.days) || 1;

  document.querySelectorAll('#range button').forEach((item) => {
    item.classList.toggle('on', item === button);
  });

  document.getElementById('days-select').value = String(days);

  load();
});

document.getElementById('days-select').addEventListener('change', (event) => {
  days = Number(event.target.value) || 1;

  document.querySelectorAll('#range button').forEach((item) => {
    item.classList.toggle(
      'on',
      Number(item.dataset.days) === days
    );
  });

  load();
});

document.addEventListener('input', (event) => {
  const id = event.target.dataset.filter;
  if (!id) return;

  const query = event.target.value.trim().toLowerCase();

  document.querySelectorAll(
    '#t-' + CSS.escape(id) + ' .tr[data-k]'
  ).forEach((row) => {
    row.style.display = row.dataset.k.includes(query) ? '' : 'none';
  });
});

document.addEventListener('click', (event) => {
  const head = event.target.closest('.tr.th span[data-sort]');
  if (!head) return;

  const root = head.closest('.tbl');
  const column = Number(head.dataset.sort);
  const reverse = root.dataset.sort === String(column);

  root.dataset.sort = reverse ? '' : String(column);

  const rows = [...root.querySelectorAll('.tr[data-k]')];

  rows.sort((a, b) => {
    const x = a.children[column]?.textContent.trim() || '';
    const y = b.children[column]?.textContent.trim() || '';

    const nx = Number(x.replace(/,/g, ''));
    const ny = Number(y.replace(/,/g, ''));

    const compare =
      !Number.isNaN(nx) && !Number.isNaN(ny)
        ? nx - ny
        : x.localeCompare(y);

    return reverse ? -compare : compare;
  });

  rows.forEach((row) => root.appendChild(row));
});

document.getElementById('out').addEventListener('click', async () => {
  try {
    await fetch('/admin/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } finally {
    location.replace('/admin');
  }
});

load();
setInterval(load, 20000);

</script>
</body>
</html>`;
}

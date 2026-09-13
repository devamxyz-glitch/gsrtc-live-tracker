import { randomUUID } from 'node:crypto';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

const OCCUPANCY = {
  1: 'Many seats',
  2: 'Some seats',
  3: 'Standing',
  4: 'Crowded',
  5: 'Cannot board',
};

const SHELL_CSS = `
:root{
  color-scheme:dark;
  --bg:#070707;
  --panel:#0d0d0e;
  --panel2:#111112;
  --line:#242427;
  --muted:#85858c;
  --text:#f5f5f7;
  --soft:#c7c7cc;
  --gold:#d6ae4d;
  --gold2:#f1d57c;
  --green:#5ad18b;
  --red:#ff6b6b;
  --blue:#73a7ff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{min-height:100vh}
button,input{font:inherit}
button{cursor:pointer}
a{color:inherit}
.shell{display:grid;grid-template-columns:236px 1fr;min-height:100vh}
.side{border-right:1px solid var(--line);background:#090909;padding:22px 14px;position:sticky;top:0;height:100vh}
.brand{padding:8px 10px 26px;font-size:18px;font-weight:700;letter-spacing:-.02em}
.brand span{display:block;color:var(--gold);font-size:11px;margin-top:5px;letter-spacing:.08em;text-transform:uppercase}
.nav{display:grid;gap:4px}
.nav button{
  border:0;background:transparent;color:#9d9da4;text-align:left;padding:10px 12px;border-radius:9px
}
.nav button:hover{background:#121214;color:#fff}
.nav button.on{background:#151514;color:#fff;box-shadow:inset 2px 0 var(--gold)}
.side-bottom{position:absolute;left:14px;right:14px;bottom:18px}
.owner{border-top:1px solid var(--line);padding:14px 10px 0;color:#777;font-size:11px;line-height:1.55}
.owner strong{display:block;color:#d6d6d9;font-size:12px}
.main{min-width:0;padding:28px 32px 40px}
.top{
  display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:24px
}
.kicker{font-size:11px;color:var(--gold);font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{margin:4px 0 6px;font-size:28px;letter-spacing:-.04em}
.subtitle{color:var(--muted);font-size:13px}
.live{
  display:inline-flex;align-items:center;gap:7px;border:1px solid #304b38;background:#0d1711;
  color:#8ee0ad;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:700
}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 14px #5ad18b88}
.toolbar{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px}
.toolbar button{
  background:#0d0d0f;color:#9a9aa1;border:1px solid var(--line);padding:7px 11px;border-radius:8px
}
.toolbar button.on,.toolbar button:hover{color:#fff;border-color:#46464a;background:#151517}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}
.card{
  grid-column:span 4;background:linear-gradient(180deg,#111112,#0c0c0d);
  border:1px solid var(--line);border-radius:12px;padding:17px;min-width:0
}
.card.wide{grid-column:span 8}
.card.full{grid-column:1/-1}
.card h2{margin:0 0 14px;font-size:12px;font-weight:650;color:#c6c6ca;letter-spacing:.01em}
.metric{font-size:31px;font-weight:760;letter-spacing:-.05em}
.metric small{font-size:12px;font-weight:500;color:var(--muted);letter-spacing:0}
.gold{color:var(--gold2)}
.muted{color:var(--muted)}
.good{color:var(--green)}
.bad{color:var(--red)}
.blue{color:var(--blue)}
.rowlist{display:grid;gap:8px}
.r{
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;
  padding:9px 0;border-bottom:1px solid #19191b
}
.r:last-child{border-bottom:0}
.rk{min-width:0}
.rk strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rk span{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.rn{font-variant-numeric:tabular-nums;font-weight:700}
.bar-wrap{height:5px;background:#1a1a1c;border-radius:999px;margin-top:6px;overflow:hidden}
.bar{height:100%;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:999px}
.searchbox{
  width:100%;background:#0a0a0b;border:1px solid var(--line);color:#fff;
  border-radius:8px;padding:9px 10px;margin-bottom:9px;outline:none
}
.searchbox:focus{border-color:#505055}
.live-feed{display:grid;gap:0}
.feed{
  display:grid;grid-template-columns:62px 52px minmax(0,1fr) auto;gap:9px;
  padding:8px 0;border-bottom:1px solid #18181a;font-size:11px;align-items:center
}
.feed:last-child{border-bottom:0}
.feed .method{color:var(--gold)}
.feed .time{color:#777}
.feed .endpoint{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed .age{color:#666;font-variant-numeric:tabular-nums}
.table{width:100%;border-collapse:collapse;font-size:12px}
.table th,.table td{text-align:left;padding:9px 8px;border-bottom:1px solid #19191b}
.table th{color:#777;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.empty{padding:24px 4px;color:#666;text-align:center;font-size:12px}
.footer{
  margin-top:26px;padding-top:16px;border-top:1px solid var(--line);
  color:#666;font-size:11px
}
.footer strong{color:#aaa}
@media(max-width:1000px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  .nav{display:flex;overflow:auto}
  .nav button{white-space:nowrap}
  .side-bottom{position:static;margin-top:14px}
  .main{padding:20px 16px 32px}
  .card,.card.wide{grid-column:span 6}
}
@media(max-width:650px){
  .top{align-items:flex-start}
  h1{font-size:23px}
  .grid{grid-template-columns:1fr}
  .card,.card.wide,.card.full{grid-column:1/-1}
  .feed{grid-template-columns:54px 42px minmax(0,1fr) auto}
}
`;

const LOGIN_CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#070707;color:#f5f5f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
.login{
  width:min(420px,100%);background:#0d0d0e;border:1px solid #242427;border-radius:16px;
  padding:28px;box-shadow:0 30px 100px #000
}
.kicker{color:#d6ae4d;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:25px;letter-spacing:-.04em;margin:7px 0}
p{color:#85858c;font-size:13px;line-height:1.5}
label{display:block;color:#9e9ea5;font-size:11px;margin:22px 0 7px}
input{
  width:100%;padding:12px;border-radius:9px;border:1px solid #29292c;background:#09090a;
  color:#fff;outline:none
}
input:focus{border-color:#d6ae4d}
button{
  width:100%;margin-top:12px;padding:12px;border:0;border-radius:9px;
  background:linear-gradient(180deg,#e1bd61,#bb9134);color:#0a0803;font-weight:750
}
.err{margin-top:10px;color:#ff7777;font-size:12px}
.owner{margin-top:24px;padding-top:16px;border-top:1px solid #222;color:#666;font-size:11px;line-height:1.55}
.owner strong{color:#bdbdc1}
`;


function card(title, inner, cls = '') {
  return `<section class="card ${cls}"><h2>${esc(title)}</h2>${inner}</section>`;
}

function big(value, sub = '') {
  return `<div class="metric">${esc(value)}</div><div class="muted" style="margin-top:5px">${esc(sub)}</div>`;
}

function kv(label, value, cls = '') {
  return `<div class="r"><div class="rk"><strong>${esc(label)}</strong></div><div class="rn ${cls}">${esc(value)}</div></div>`;
}

function pretty(v) {
  return String(v ?? '')
    .replace(/^screen:/, '')
    .replace(/^act:/, '')
    .replace(/^entry:/, '')
    .replace(/^set:/, '')
    .replace(/^onboard:/, '')
    .replace(/^perf:/, '')
    .replace(/^net:/, '')
    .replace(/^err:/, 'error ')
    .replace(/^miss:/, 'miss ')
    .replace(/-/g, ' ');
}

function bars(rows = [], max = null) {
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) return `<div class="empty">No data yet</div>`;

  const ceiling = max || Math.max(...data.map((r) => Number(r.n || r.devices || r.lookups || 0)), 1);

  return `<div class="rowlist">${data.map((r) => {
    const n = Number(r.n || r.devices || r.lookups || 0);
    const label = r.key ?? r.plate ?? r.name ?? '';
    const pct = Math.max(3, Math.min(100, Math.round((n / ceiling) * 100)));
    return `<div class="r">
      <div class="rk">
        <strong>${esc(label)}</strong>
        <div class="bar-wrap"><div class="bar" style="width:${pct}%"></div></div>
      </div>
      <div class="rn">${fmt(n)}</div>
    </div>`;
  }).join('')}</div>`;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No data yet</div>`;
  return `<table class="table"><thead><tr>${
    headers.map((h) => `<th>${esc(h)}</th>`).join('')
  }</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

function line(rows, value, label) {
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) return `<div class="empty">${esc(label)}: no data</div>`;
  const max = Math.max(...data.map((r) => Number(value(r) || 0)), 1);
  return `<div class="rowlist">${data.map((r) => {
    const n = Number(value(r) || 0);
    const pct = Math.max(3, Math.min(100, Math.round((n / max) * 100)));
    return `<div class="r"><div class="rk"><strong>${esc(r.day || r.hour || '')}</strong><div class="bar-wrap"><div class="bar" style="width:${pct}%"></div></div></div><div class="rn">${fmt(n)}</div></div>`;
  }).join('')}</div>`;
}

function funnel(rows = []) {
  return bars((rows || []).map((r) => ({ key: r.label, n: r.devices })));
}

function hours(rows = []) {
  return bars((rows || []).map((r) => ({ key: String(r.key).padStart(2, '0') + ':00', n: r.n })));
}

function clockRows(rows) {
  return (rows || []).map((r) => ({ key: String(r.hour).padStart(2, '0'), n: r.n }));
}

function journeys(rows = []) {
  return bars((rows || []).map((r) => ({ key: r.plate, n: r.n || r.lookups })));
}

function grid(cards) {
  return `<div class="grid">${cards.filter(Boolean).join('')}</div>`;
}

function wide(content) {
  return content;
}

function recentFeed(rows = []) {
  if (!rows.length) return `<div class="empty">Waiting for live requests</div>`;
  return `<div class="live-feed">${
    rows.map((r) => `<div class="feed">
      <span class="time">${esc(r.agoSec)}s</span>
      <span class="method">${esc(r.method)}</span>
      <span class="endpoint">${esc('/api/' + (r.endpoint === 'root' ? '' : r.endpoint))}</span>
      <span class="age">ago</span>
    </div>`).join('')
  }</div>`;
}

function stationSearches(rows = []) {
  if (!rows.length) return `<div class="empty">No station searches recorded yet</div>`;
  return `<div class="rowlist">${
    rows.map((r) => `<div class="r">
      <div class="rk">
        <strong>${esc(r.key)}</strong>
        <span>station search</span>
        <div class="bar-wrap"><div class="bar" style="width:${Math.max(3, Math.min(100, (Number(r.n || 0) / Math.max(...rows.map(x => Number(x.n || 0)), 1)) * 100))}%"></div></div>
      </div>
      <div class="rn">${fmt(r.n)}</div>
    </div>`).join('')
  }</div>`;
}

export function adminLogin(nonce, error = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ST Tracker Admin</title>
<style nonce="${nonce}">${LOGIN_CSS}</style>
</head>
<body>
<div class="wrap">
  <main class="login">
    <div class="kicker">ST Tracker</div>
    <h1>Admin Console</h1>
    <p>Private owner dashboard for product usage, searches, requests and operations.</p>
    <form method="post" action="/admin/login" id="login-form">
      <label for="password">Admin password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Sign in</button>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
    </form>
    <div class="owner">
      <strong>Devam Namera</strong>
      Founder &amp; Lead Developer<br>
      ST Tracker
    </div>
  </main>
</div>
<script nonce="${nonce}">
const form = document.getElementById('login-form');
function big(value, sub = '') {
  return '<div class="metric">' + esc(value) +
    '</div><div class="muted" style="margin-top:5px">' + esc(sub) +
    '</div>';
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const res = await fetch('/admin/login', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({password}),
  });
  if (res.ok) location.replace('/admin');
  else location.replace('/admin?error=1');
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
<title>ST Tracker Admin</title>
<style nonce="${nonce}">${SHELL_CSS}</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand">
      ST Tracker
      <span>Admin Console</span>
    </div>

    <nav class="nav" id="nav">
      <button class="on" data-view="overview">Overview</button>
      <button data-view="searches">Searches</button>
      <button data-view="requests">Requests</button>
      <button data-view="buses">Buses &amp; Routes</button>
      <button data-view="devices">Devices</button>
      <button data-view="behaviour">Behaviour</button>
      <button data-view="community">Rider Reports</button>
      <button data-view="health">System Health</button>
    </nav>

    <div class="side-bottom">
      <div class="toolbar" id="range">
        <button class="on" data-days="1">1D</button>
        <button data-days="7">7D</button>
        <button data-days="30">30D</button>
        <button data-days="90">90D</button>
      </div>
      <button id="signout" style="width:100%;padding:9px;border-radius:8px;border:1px solid #242427;background:#0d0d0f;color:#aaa">Sign out</button>
      <div class="owner">
        <strong>Devam Namera</strong>
        Founder &amp; Lead Developer
      </div>
    </div>
  </aside>

  <main class="main">
    <div class="top">
      <div>
        <div class="kicker">Owner Analytics</div>
        <h1 id="title">Overview</h1>
        <div class="subtitle" id="stamp">Loading live data…</div>
      </div>
      <div class="live"><span class="dot"></span><span id="liveText">LIVE</span></div>
    </div>

    <div id="view"></div>

    <div class="footer">
      <strong>ST Tracker</strong> · Private analytics console ·
      Designed &amp; engineered by <strong>Devam Namera</strong>
    </div>
  </main>
</div>

<script nonce="${nonce}">
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
));

const OCCUPANCY = {1:'Many seats',2:'Some seats',3:'Standing',4:'Crowded',5:'Cannot board'};
const kv = (label, value, cls = '') =>
  '<div class="r"><div class="rk"><strong>' + esc(label) +
  '</strong></div><div class="rn ' + esc(cls) + '">' + esc(value) +
  '</div></div>';

let days = 1;
let view = 'overview';
let lastData = null;
let loadBusy = false;

const nav = document.getElementById('nav');
const range = document.getElementById('range');
const host = document.getElementById('view');

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

const safe = (v) => v == null ? 0 : v;

function big(value, sub = '') {
  return '<div class="metric">' + esc(value) +
    '</div><div class="muted" style="margin-top:5px">' + esc(sub) +
    '</div>';
}
const metric = (value, sub, cls='') =>
  '<div class="metric ' + cls + '">' + esc(value) + '</div><div class="muted" style="margin-top:5px">' + esc(sub) + '</div>';

const card = (title, body, cls='') =>
  '<section class="card ' + cls + '"><h2>' + esc(title) + '</h2>' + body + '</section>';

const barList = (rows, key='key') => {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return '<div class="empty">No data yet</div>';
  const vals = rows.map(r => Number(r.n ?? r.devices ?? r.lookups ?? 0));
  const max = Math.max(...vals, 1);
  return '<div class="rowlist">' + rows.map(r => {
    const n = Number(r.n ?? r.devices ?? r.lookups ?? 0);
    const name = r[key] ?? '';
    const pct = Math.max(3, Math.min(100, (n / max) * 100));
    return '<div class="r"><div class="rk"><strong>' + esc(name) +
      '</strong><div class="bar-wrap"><div class="bar" style="width:' + pct + '%"></div></div></div>' +
      '<div class="rn">' + fmt(n) + '</div></div>';
  }).join('') + '</div>';
};

const recent = (rows) => {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return '<div class="empty">No requests in the live window</div>';
  return '<div class="live-feed">' + rows.map(r =>
    '<div class="feed"><span class="time">' + esc(r.agoSec) + 's</span>' +
    '<span class="method">' + esc(r.method) + '</span>' +
    '<span class="endpoint">' + esc('/api/' + (r.endpoint === 'root' ? '' : r.endpoint)) + '</span>' +
    '<span class="age">ago</span></div>'
  ).join('') + '</div>';
};

const table = (headers, rows) => {
  if (!rows.length) return '<div class="empty">No data yet</div>';
  return '<table class="table"><thead><tr>' +
    headers.map(h => '<th>' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
};

function line(rows, fn, label='') {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return '<div class="empty">' + esc(label) + ': no data</div>';
  const max = Math.max(...rows.map(r => Number(fn(r) || 0)), 1);
  return '<div class="rowlist">' + rows.map(r => {
    const n = Number(fn(r) || 0);
    const pct = Math.max(3, Math.min(100, (n / max) * 100));
    return '<div class="r"><div class="rk"><strong>' + esc(r.day || r.hour || '') +
      '</strong><div class="bar-wrap"><div class="bar" style="width:' + pct + '%"></div></div></div>' +
      '<div class="rn">' + fmt(n) + '</div></div>';
  }).join('') + '</div>';
}

function funnel(rows) {
  return barList(rows, 'label');
}

function journeys(rows) {
  return barList(rows, 'plate');
}

function pretty(v) {
  return String(v ?? '').replace(/^[^:]+:/, '').replace(/-/g,' ');
}

function bars(rows) {
  return barList(rows);
}

function hours(rows) {
  return barList((rows || []).map(r => ({key:String(r.key ?? r.hour).padStart(2,'0') + ':00', n:r.n})));
}

function clockRows(rows) {
  return (rows || []).map(r => ({key:String(r.hour).padStart(2,'0'), n:r.n}));
}

function grid(cards) {
  return '<div class="grid">' + cards.filter(Boolean).join('') + '</div>';
}

function wide(content) {
  return content;
}

function stationRows(rows) {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return '<div class="empty">No station searches recorded yet</div>';
  const max = Math.max(...rows.map(r => Number(r.n || 0)), 1);
  return '<div class="rowlist">' + rows.map((r, i) => {
    const n = Number(r.n || 0);
    const pct = Math.max(3, Math.min(100, (n / max) * 100));
    return '<div class="r"><div class="rk"><strong>' +
      '<span style="color:#777;margin-right:7px">' + String(i+1).padStart(2,'0') + '</span>' +
      esc(r.key) +
      '</strong><div class="bar-wrap"><div class="bar" style="width:' + pct + '%"></div></div>' +
      '</div><div class="rn">' + fmt(n) + '</div></div>';
  }).join('') + '</div>';
}

async function load() {
  if (loadBusy) return;
  loadBusy = true;

  try {
    const res = await fetch('/admin/stats?days=' + days, {cache:'no-store'});
    if (res.status === 401) {
      location.replace('/admin');
      return;
    }

    const d = await res.json();
    lastData = d;

    const rangeText = d.range.days === 1
      ? d.range.to
      : d.range.from + ' to ' + d.range.to;

    document.getElementById('stamp').textContent =
      rangeText + ' · refresh ' + new Date().toLocaleTimeString('en-IN');

    const p = d.people || {};
    const t = d.traffic || {};
    const b = d.buses || {};
    const r = d.routes || {};
    const st = d.stations || {};
    const u = d.usage || {};
    const com = d.community || {};
    const liveNow = Number(t.lastMinute || 0);

    document.getElementById('liveText').textContent =
      liveNow ? liveNow + ' req/min' : 'LIVE';

    const views = {
      overview: () => grid([
        card('Requests today', metric(t.requests, 'API calls stored today', 'gold')),
        card('Live traffic', metric(t.lastMinute || 0, 'requests in the last 60 seconds', 'good')),
        card('5-minute traffic', metric(t.lastFiveMinutes || 0, 'requests in the last 5 minutes')),
        card('Station searches', metric(st.searchesToday || 0, 'station searches today')),
        card('Route searches', metric(r.searchesToday || 0, 'route searches today')),
        card('Bus tracking', metric(b.lookupsToday || 0, 'bus lookups today')),

        card('What people searched',
          '<div class="muted" style="margin-bottom:10px">Top stations by actual search query</div>' +
          stationRows(st.topStations || []), 'wide'),

        card('Live request stream',
          '<div class="muted" style="margin-bottom:10px">Latest API activity · 5 minute window</div>' +
          recent(t.recent || []), 'wide'),

        card('Most searched routes', barList(r.topRoutes || [])),
        card('Most tracked buses', barList(b.topPlates || [])),
        card('Devices', barList((p.platforms || []).map(x => ({key:x.key,n:x.devices})))),
        card('Popular screens', barList((u.events || []).filter(x => String(x.key).startsWith('screen:')).map(x => ({key:pretty(x.key),n:x.n}))))
      ]),

      searches: () => grid([
        card('Station searches today', metric(st.searchesToday || 0, 'actual /api/stations queries')),
        card('Route searches today', metric(r.searchesToday || 0, 'origin → destination searches')),
        card('Search detail', stationRows(st.topStations || []), 'full'),
        card('Route detail', barList(r.topRoutes || []), 'wide'),
      ]),

      requests: () => grid([
        card('Requests today', metric(t.requests || 0, 'persisted API requests')),
        card('Last minute', metric(t.lastMinute || 0, 'live request count', 'good')),
        card('Last 5 minutes', metric(t.lastFiveMinutes || 0, 'live request count')),
        card('Busiest endpoints', barList(t.byEndpoint || []), 'wide'),
        card('Live stream', recent(t.recent || []), 'full'),
        card('Daily traffic', line(t.dailyRequests || [], r => r.n, 'requests'), 'wide'),
      ]),

      buses: () => grid([
        card('Most tracked buses', barList(b.topPlates || []), 'wide'),
        card('Most searched routes', barList(r.topRoutes || [])),
        card('Busiest API endpoints', barList(t.byEndpoint || [])),
        card('Bus lookups', table(
          ['Bus', 'Lookups', 'Devices', 'Sessions'],
          (p.busHistory || []).map(x => [x.plate, x.lookups, x.devices, x.sessions])
        ), 'full'),
      ]),

      devices: () => grid([
        card('Unique devices', metric(p.devices || 0, 'aggregate devices in selected range')),
        card('Visits', metric(p.sessions || 0, 'sessions in selected range')),
        card('Average session', metric((p.avgSessionSec || 0) + 's', 'average duration')),
        card('Device platforms', barList((p.platforms || []).map(x => ({key:x.key,n:x.devices})), 'key'), 'wide'),
        card('How visitors arrived', barList((p.entries || []).map(x => ({key:pretty(x.key),n:x.n})), 'key'), 'wide'),
      ]),

      behaviour: () => grid([
        card('Most-used features', barList((p.eventCounts || []).slice(0,30))),
        card('Screens', barList((u.events || []).filter(x => String(x.key).startsWith('screen:')).map(x => ({key:pretty(x.key),n:x.n})), 'key')),
        card('Usage by hour', hours(clockRows(p.hours || [])), 'wide'),
        card('Onboarding funnel', funnel((p.funnels || {}).onboarding || []), 'wide'),
        card('Alert funnel', funnel((p.funnels || {}).alerts || []), 'wide'),
      ]),

      community: () => grid([
        card('Rider reports', metric(com.reports || 0, 'reports stored')),
        card('Arrivals observed', metric(com.arrivals || 0, 'arrival observations')),
        card('Occupancy today', barList(Object.entries(com.occupancy || {}).map(([key,n]) => ({key:OCCUPANCY[key] || key,n})), 'key')),
        card('Replacements', barList(com.replacements || [])),
      ]),

      health: () => grid([
        card('Server', table(
          ['Metric','Value'],
          [
            ['Version', d.server?.version || ''],
            ['Node', d.server?.node || ''],
            ['Memory', (d.server?.memoryMb || 0) + ' MB'],
            ['Cache entries', d.server?.cacheEntries || 0],
            ['Uptime', Math.floor((d.server?.uptimeSec || 0) / 3600) + 'h'],
          ]
        ), 'wide'),
        card('Tracker',
          kv('Watching', d.tracker?.watching || 0) +
          kv('Live fixes', d.tracker?.withFix || 0) +
          kv('Polls/sec', d.tracker?.pollsPerSec || 0) +
          kv('Upstream errors', d.tracker?.errors || 0)),
        card('Probe',
          kv('Interval', (d.probe?.intervalSec || 0) + 's') +
          kv('Checks', d.probe?.checks || 0) +
          kv('Per day', d.probe?.perDay || 0)),
        card('GSRTC API',
          table(
            ['Area','Calls','Avg'],
            [
              ['Live bus positions', d.uptime?.vehicle?.calls || d.probe?.vehicle?.calls || 0, d.uptime?.vehicle?.avgMs || 0],
              ['Routes / stops', d.uptime?.stops?.calls || 0, d.uptime?.stops?.avgMs || 0],
              ['Timetables', d.uptime?.timetable?.calls || 0, d.uptime?.timetable?.avgMs || 0],
              ['Station search', d.uptime?.stations?.calls || 0, d.uptime?.stations?.avgMs || 0],
            ]
          ), 'full'),
      ]),
    };

    host.innerHTML = (views[view] || views.overview)();
  } catch (e) {
    host.innerHTML = '<div class="card full"><h2>Dashboard error</h2><div class="bad">' +
      esc(e?.message || e) + '</div></div>';
  } finally {
    loadBusy = false;
  }
}

nav.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;

  view = b.dataset.view;

  [...nav.querySelectorAll('button')].forEach(x =>
    x.classList.toggle('on', x === b)
  );

  load();
});

range.addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;

  days = Number(b.dataset.days) || 1;

  [...range.querySelectorAll('button')].forEach(x =>
    x.classList.toggle('on', x === b)
  );

  load();
});

document.getElementById('signout').addEventListener('click', async () => {
  await fetch('/admin/logout', {method:'POST'});
  location.replace('/admin');
});

load();
setInterval(load, 1000);
</script>
</body>
</html>`;
}












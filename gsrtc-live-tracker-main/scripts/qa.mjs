import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'https://tracker.shivrajsinh.in';

async function runQA() {
  console.log(`Starting comprehensive QA test suite against ${BASE}...\n`);
  const results = { passed: 0, failed: 0, warnings: 0, details: [] };

  function pass(name, msg = '') {
    results.passed++;
    console.log(`  ✓ ${name} ${msg ? `(${msg})` : ''}`);
    results.details.push({ status: 'PASS', name, msg });
  }

  function fail(name, err) {
    results.failed++;
    console.error(`  ✗ ${name}: ${err.message || err}`);
    results.details.push({ status: 'FAIL', name, err: String(err) });
  }

  // 1. Static Code Analysis & Translation Parity
  console.log('--- 1. Frontend & i18n Verification ---');
  try {
    const i18nModule = await import('../web/js/i18n.js');
    const { en, gu } = i18nModule.TABLES || {};
    if (!en || !gu) {
      fail('i18n tables', 'TABLES export missing');
    } else {
      const enKeys = Object.keys(en);
      const guKeys = Object.keys(gu);
      const missingInGu = enKeys.filter(k => !(k in gu));
      const missingInEn = guKeys.filter(k => !(k in en));

      if (missingInGu.length > 0) {
        fail('i18n parity (English -> Gujarati)', `Missing keys in Gujarati: ${missingInGu.join(', ')}`);
      } else {
        pass('i18n parity (English -> Gujarati)', `${enKeys.length} keys match`);
      }

      if (missingInEn.length > 0) {
        fail('i18n parity (Gujarati -> English)', `Missing keys in English: ${missingInEn.join(', ')}`);
      } else {
        pass('i18n parity (Gujarati -> English)', `${guKeys.length} keys match`);
      }
    }
  } catch (e) {
    fail('i18n module load', e);
  }

  // 2. Icons Integrity
  console.log('\n--- 2. SVG Icons Verification ---');
  try {
    const iconsModule = await import('../web/js/icons.js');
    const { icon } = iconsModule;
    const testIcons = [
      'bus', 'search', 'crosshair', 'phone', 'ticket', 'gear', 'clock', 'refresh',
      'sun', 'moon', 'monitor', 'right', 'down', 'up', 'swap', 'arrowRight', 'star',
      'alert', 'x', 'external', 'shield', 'copy', 'info', 'calendar', 'users', 'signpost',
      'home', 'pin', 'route', 'compass', 'bell', 'bellOff', 'share', 'plus', 'trash',
      'check', 'globe', 'type', 'navigation', 'gauge', 'filter', 'ruler', 'download',
      'layers', 'flag', 'play', 'pause', 'minus'
    ];
    let iconErrors = 0;
    for (const name of testIcons) {
      const svg = icon(name);
      if (!svg || !svg.includes('<svg') || !svg.includes('</svg>')) {
        fail(`Icon '${name}'`, 'Invalid or empty SVG returned');
        iconErrors++;
      }
    }
    if (iconErrors === 0) pass(`All ${testIcons.length} SVG icons render valid SVG markup`);
  } catch (e) {
    fail('icons module load', e);
  }

  // 3. Service Worker Precaching Integrity
  console.log('\n--- 3. PWA Service Worker Shell Cache Verification ---');
  try {
    const swContent = fs.readFileSync(path.resolve('./web/sw.js'), 'utf8');
    const match = swContent.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
    if (!match) {
      fail('sw.js SHELL_FILES', 'Could not parse SHELL_FILES from sw.js');
    } else {
      const files = match[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(s => s && s !== './');

      let missingFiles = 0;
      for (const file of files) {
        const fullPath = path.resolve('./web', file);
        if (!fs.existsSync(fullPath)) {
          fail(`Precache file '${file}'`, 'File does not exist on disk');
          missingFiles++;
        }
      }
      if (missingFiles === 0) pass(`All ${files.length} PWA precached files exist on disk`);
    }
  } catch (e) {
    fail('sw.js verification', e);
  }

  // 4. Production API Endpoints Verification
  console.log('\n--- 4. Live Production API Tests ---');
  async function testEndpoint(name, url, { expectedStatus = 200, validator } = {}) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ST-Tracker-QA/1.0' } });
      if (res.status !== expectedStatus) {
        fail(name, `Expected HTTP ${expectedStatus} but got ${res.status}`);
        return;
      }
      if (validator) {
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch {}
        validator(json || text, res);
      }
      pass(name, `HTTP ${res.status}`);
    } catch (e) {
      fail(name, e);
    }
  }

  await testEndpoint('Health Endpoint (/health)', `${BASE}/health`, {
    validator: (data) => {
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.version);
      assert.ok(typeof data.uptimeSeconds === 'number');
    }
  });

  await testEndpoint('API Health Endpoint (/api/health)', `${BASE}/api/health`, {
    validator: (data) => {
      assert.strictEqual(data.status, 'ok');
    }
  });

  await testEndpoint('Security Headers on Shell', `${BASE}/`, {
    validator: (_, res) => {
      assert.ok(res.headers.get('content-security-policy'), 'CSP header missing');
      assert.ok(res.headers.get('x-content-type-options'), 'X-Content-Type-Options missing');
      assert.ok(res.headers.get('x-frame-options'), 'X-Frame-Options missing');
      assert.ok(res.headers.get('referrer-policy'), 'Referrer-Policy missing');
    }
  });

  await testEndpoint('Manifest', `${BASE}/manifest.webmanifest`, {
    validator: (data) => {
      assert.ok(data.name);
      assert.ok(data.icons?.length >= 2);
    }
  });

  await testEndpoint('Stations Autocomplete Query (/api/stations/morbi)', `${BASE}/api/stations/morbi`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
      assert.ok(data[0].StationId && data[0].StationName);
    }
  });

  await testEndpoint('Service Types', `${BASE}/api/servicetypes`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 5);
    }
  });

  await testEndpoint('Nearby Stations (Morbi Coordinates: 22.8173, 70.8370)', `${BASE}/api/nearby?lat=22.8173&lng=70.8370`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
      const morbi = data.find(s => /morbi/i.test(s.StationName));
      assert.ok(morbi, 'Morbi station not found near Morbi coordinates');
    }
  });

  await testEndpoint('Timetable Query (Ahmedabad to Rajkot: 464 to 470)', `${BASE}/api/timetable?from=464&to=470&date=${new Date().toISOString().slice(0, 10)}`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0, 'No buses returned for Ahmedabad to Rajkot');
    }
  });

  await testEndpoint('Trip Code SOAP Endpoint', `${BASE}/api/tripcode/0`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
    }
  });

  await testEndpoint('Pickup Points SOAP Endpoint', `${BASE}/api/pickup-points?pnr=0`, {
    validator: (data) => {
      assert.ok(Array.isArray(data));
    }
  });

  // 5. Security & Boundary Fuzzing
  console.log('\n--- 5. Security & Error Handling Tests ---');

  await testEndpoint('Bad Plate Injection Refused (HTTP 400)', `${BASE}/api/vehicle/<script>alert(1)</script>`, {
    expectedStatus: 400
  });

  await testEndpoint('Bad Lat/Lng Refused (HTTP 400)', `${BASE}/api/nearby?lat=999&lng=999`, {
    expectedStatus: 400
  });

  try {
    const res = await fetch(`${BASE}/api/../../etc/passwd`, { headers: { 'User-Agent': 'ST-Tracker-QA/1.0' } });
    if (res.status === 403 || res.status === 404) {
      pass('Path Traversal Refused (HTTP 403/404)', `HTTP ${res.status}`);
    } else {
      fail('Path Traversal Refused', `Expected HTTP 403 or 404 but got ${res.status}`);
    }
  } catch (e) {
    fail('Path Traversal Refused', e);
  }

  await testEndpoint('Invalid PNR Format Refused (HTTP 400)', `${BASE}/api/pnr/INVALID!@#$PNR`, {
    expectedStatus: 400
  });

  await testEndpoint('Invalid Ticket Phone Refused (HTTP 400)', `${BASE}/api/ticket?pnr=G12345678&mobile=123`, {
    expectedStatus: 400
  });

  console.log(`\n========================================`);
  console.log(`QA Result: ${results.passed} Passed, ${results.failed} Failed, ${results.warnings} Warnings`);
  console.log(`========================================\n`);

  if (results.failed > 0) process.exit(1);
}

runQA().catch(e => {
  console.error('Fatal QA Error:', e);
  process.exit(1);
});

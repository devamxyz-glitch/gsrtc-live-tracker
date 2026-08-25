/**
 * Bumps every version stamp at once.
 *
 * There are four of them and no bundler to keep them together: package.json (reported by
 * /api/health), the service worker's cache name, and the ?v= on the stylesheet and entry module
 * in two HTML files. Doing that by hand meant they drifted — a QA pass found sw.js at 1.25.1
 * while package.json said 1.25.0 and index.html still asked for 1.25.0 assets, which is a stale
 * script served against fresh markup.
 *
 *   node scripts/release.mjs 1.26.0     # explicit
 *   node scripts/release.mjs patch      # or minor / major
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const pkg = JSON.parse(read('package.json'));
const current = pkg.version;
const arg = process.argv[2];

if (!arg) {
  console.error(`current: ${current}\nusage: node scripts/release.mjs <version|major|minor|patch>`);
  process.exit(1);
}

let next = arg;
if (['major', 'minor', 'patch'].includes(arg)) {
  const [maj, min, pat] = current.split('.').map(Number);
  next = arg === 'major' ? `${maj + 1}.0.0`
    : arg === 'minor' ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`not a version: ${next}`);
  process.exit(1);
}

// package.json
pkg.version = next;
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

// service worker cache name
const sw = read('web/sw.js');
const swNext = sw.replace(/const VERSION = 'v[\d.]+'/, `const VERSION = 'v${next}'`);
if (swNext === sw) { console.error('sw.js: VERSION not found'); process.exit(1); }
write('web/sw.js', swNext);

// asset query strings, in every HTML file that carries them
const touched = [];
for (const file of ['web/index.html', 'web/privacy.html']) {
  const before = read(file);
  const after = before
    .replace(/styles\.css\?v=[\d.]+/g, `styles.css?v=${next}`)
    .replace(/js\/app\.js\?v=[\d.]+/g, `js/app.js?v=${next}`);
  if (after !== before) { write(file, after); touched.push(file); }
}

// CLAUDE.md carries the version as handoff context, so it drifts too.
const md = read('CLAUDE.md');
write('CLAUDE.md', md.replace(/Current version: \*\*[\d.]+\*\*/, `Current version: **${next}**`));

console.log(`${current} -> ${next}`);
console.log(`  package.json, web/sw.js, CLAUDE.md, ${touched.join(', ')}`);

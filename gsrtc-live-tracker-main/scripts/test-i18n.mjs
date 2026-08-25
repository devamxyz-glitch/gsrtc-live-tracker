/**
 * Every visible string has a Gujarati translation.
 *
 * The app is bilingual by design and half its riders read Gujarati, but adding a string means
 * editing two objects hundreds of lines apart. Missing the second one is silent: `t()` falls
 * back to English, so the key still renders and only a Gujarati speaker ever sees the gap.
 *
 * This has already happened while adding a routes empty state, and it is not the kind of thing
 * anyone catches by reading a diff.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'web', 'js', 'i18n.js'), 'utf8');

/**
 * Top-level keys of a `const <name> = { … }` object literal.
 *
 * String literals are stripped before anything else is counted, because the values here are full
 * of both braces and colons — `inHours: 'in {h}h {m}m'` would otherwise corrupt the depth count
 * and invent keys out of the placeholders.
 */
function keysOf(name) {
  const start = src.search(new RegExp(`^const\\s+${name}\\s*=\\s*\\{`, 'm'));
  assert.notEqual(start, -1, `dictionary ${name} not found`);

  const lines = src.slice(src.indexOf('{', start)).split('\n');
  const keys = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      .replace(/\/\/.*$/, '');

    // Several keys share a line throughout this file, so match every one — not just the first.
    if (depth === 1) {
      for (const m of line.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/g)) keys.push(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth === 0) break;
  }
  return keys;
}

const en = keysOf('en');
const gu = keysOf('gu');

test('the dictionaries are not empty (the parser still works)', () => {
  assert.ok(en.length > 100, `only found ${en.length} English keys — the parser has drifted`);
});

test('every English string has a Gujarati translation', () => {
  const missing = en.filter((k) => !gu.includes(k)).sort();
  assert.deepEqual(missing, [],
    `no Gujarati for: ${missing.join(', ')}. t() falls back to English, so this renders fine `
    + 'and only a Gujarati reader ever notices.');
});

test('no Gujarati key has lost its English original', () => {
  const orphans = gu.filter((k) => !en.includes(k)).sort();
  assert.deepEqual(orphans, [], `Gujarati-only keys: ${orphans.join(', ')}`);
});

test('no key is defined twice in the same dictionary', () => {
  for (const [name, keys] of [['en', en], ['gu', gu]]) {
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `${name} defines ${dupes.join(', ')} more than once — the `
      + 'later one silently wins');
  }
});

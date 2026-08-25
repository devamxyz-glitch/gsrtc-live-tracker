/**
 * Catches calls to functions that do not exist.
 *
 * This has now shipped four times: `handleDeepLink`, `located`, `warmStations`, and four
 * helpers in the admin page. Every one had the same cause — a region of a file replaced by
 * position, taking an adjacent declaration with it while the call sites stayed. Every one
 * reached production, because the browser modules are never parsed by `node --check`, the tests
 * do not import them, and a `ReferenceError` inside `boot()` looks like nothing at all: the
 * page renders, and the features that were supposed to start simply do not.
 *
 * So this walks every browser module, collects what it declares and imports, and asserts that
 * everything it calls is one of those.
 *
 * **What it will not catch.** It is scope-blind: a name bound anywhere in a file counts as
 * available everywhere in it. That is deliberate — real scope analysis needs a parser — but it
 * means a call to a missing `located()` slips through while a parameter named `located` exists
 * elsewhere in the same file, which is precisely how that one shipped.
 *
 * **There is no automated backstop for those.** Nothing here runs a browser engine, so the only
 * thing that catches a scope-accurate boot failure is loading the deployed site and reading the
 * console — which is a release step, not a test. It is written down in CLAUDE.md because skipping
 * it once took the app down for thirteen hours across a morning commute, and the crash also
 * disabled the analytics that would have reported it. See `test-imports.mjs` for the other half:
 * an import of an export that no longer exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'web', 'js');

/** Globals and built-ins a browser module may call without declaring. */
const AMBIENT = new Set([
  // language + control flow that the regex will inevitably pick up
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'async', 'await',
  'do', 'else', 'try', 'new', 'delete', 'void', 'in', 'of', 'yield', 'import', 'super',
  // web platform
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'matchMedia', 'getComputedStyle', 'alert', 'confirm', 'prompt',
  'structuredClone', 'queueMicrotask', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'reportError',
  // globals used as constructors/namespaces (lowercase-first only matters for our regex)
  'console', 'document', 'window', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'crypto', 'performance', 'screen', 'caches', 'indexedDB',
]);

const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));

/** Names a module brings in: its own declarations plus everything it imports. */
function namesAvailable(src) {
  const names = new Set();

  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // Destructured consts: `const { a, b } = ...`
  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:const|let|var)\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) names.add(part.split(':').pop().trim());
  }
  // `import * as x`
  for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // `import x from` and `import { a, b as c } from`
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) names.add(part.split(/\s+as\s+/).pop().trim());
  }
  // Parameters, positional and destructured alike. Taken generously across the whole file:
  // the goal is finding names that exist *nowhere*, not enforcing scope.
  const paramLists = [
    ...[...src.matchAll(/\(([^)]*)\)\s*=>/g)].map((m) => m[1]),
    ...[...src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/^\s{2,}[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/gm)].map((m) => m[1]),
  ];
  for (const list of paramLists) {
    // Every identifier in the list counts, whether it arrived positionally or out of a
    // `{ fetcher, render }` — and a stray `(` from a nested call must not become part of one.
    for (const m of list.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
  }
  for (const m of src.matchAll(/\bcatch\s*\(([A-Za-z_$][\w$]*)\)/g)) names.add(m[1]);

  // Object method shorthand — `pushPlate(plate) { … }` in an object literal is a declaration,
  // and store.js is written almost entirely in that style.
  for (const m of src.matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) names.add(m[1]);

  return names;
}

/** Bare calls: `name(` not preceded by a dot, and not a method shorthand in an object. */
function callsMade(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // line comments, leaving URLs alone
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')    // template literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');

  const out = new Set();
  for (const m of stripped.matchAll(/(^|[^.\w$])\b([a-z_$][\w$]*)\s*\(/gm)) out.add(m[2]);
  return out;
}

for (const file of files) {
  test(`${file} calls nothing it does not have`, () => {
    const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    const have = namesAvailable(src);
    const missing = [...callsMade(src)]
      .filter((name) => !have.has(name) && !AMBIENT.has(name))
      .sort();

    assert.deepEqual(
      missing, [],
      `${file} calls ${missing.join(', ')} — declared nowhere and imported from nowhere. `
      + 'This is the failure mode where a refactor removes a function and leaves its callers: '
      + 'the page still loads and the feature silently never runs.',
    );
  });
}

/**
 * The admin dashboard is one inline script inside a template literal, so `node --check` sees a
 * string and validates nothing. Three separate refactors silently deleted helper functions that
 * were still being called — the page rendered a sidebar and an empty body, and only a browser
 * console said why.
 *
 * This parses the script out and checks it for real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { adminPage, adminLogin } from '../server/admin-page.mjs';

const scriptOf = (html) => {
  const open = html.indexOf('>', html.indexOf('<script'));
  return html.slice(open + 1, html.indexOf('</script>', open));
};

test('the dashboard script parses', () => {
  const code = scriptOf(adminPage('test-nonce'));
  assert.doesNotThrow(() => new vm.Script(code), 'the inline script must be valid JavaScript');
});

test('every function it calls is one it declares', () => {
  const code = scriptOf(adminPage('test-nonce'));

  const declared = new Set(
    [...code.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]),
  );

  // Helpers the views depend on. Each of these has been deleted by a refactor at least once,
  // while the call sites stayed — which is exactly the failure this test exists to catch.
  for (const name of ['line', 'funnel', 'journeys', 'pretty', 'hours', 'bars', 'table',
    'card', 'kv', 'grid', 'wide', 'big', 'clockRows', 'load']) {
    assert.ok(declared.has(name), `${name}() is called by the dashboard but no longer declared`);
  }

  // State the render depends on.
  for (const name of ['days', 'view']) {
    assert.ok(declared.has(name), `${name} is read by load() but never declared`);
  }
});

test('nothing is declared twice', () => {
  const code = scriptOf(adminPage('test-nonce'));
  const names = [...code.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  const seen = new Set();
  const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  // A duplicate `const` is a SyntaxError that kills the whole script at parse time, and the
  // page then renders its shell with an empty body — which looks like a data problem, not a
  // code one. That cost real debugging once already.
  assert.deepEqual(dupes, [], `declared more than once: ${dupes.join(', ')}`);
});

test('the login page carries its nonce', () => {
  const html = adminLogin('test-nonce', '');
  assert.match(html, /<style nonce="test-nonce">/);
  assert.match(html, /<script nonce="test-nonce">/);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
});

/**
 * Every named import resolves to something the target module actually exports.
 *
 * The browser modules are never loaded by the test suite and `node --check` only parses one file
 * at a time, so a name that no longer exists on the other side of an `import { … }` is invisible
 * until a rider opens the app — where it fails the whole module, not just the feature, because an
 * unresolved import is a load-time error.
 *
 * This is the sibling of `test-references.mjs`: that one catches a call to a function that is
 * declared nowhere, this one catches an import of an export that is gone. Between them they cover
 * the two ways a refactor that moves code leaves its callers behind.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'web', 'js');

const read = (f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8');
const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));

/** Every name a module makes available to importers. */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // `export { a, b as c }`
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.split(/\s+as\s+/);
      names.add((bits[1] || bits[0]).trim());
    }
  }
  if (/^export\s+default/m.test(src)) names.add('default');
  return names;
}

/** Named imports a module takes from its local siblings, as [specifier, [names]]. */
function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+)['"]/g)) {
    const names = m[1].split(',')
      .map((p) => p.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push([m[2], names]);
  }
  return out;
}

for (const file of files) {
  test(`${file} imports only what its siblings export`, () => {
    const src = read(file);
    const broken = [];

    for (const [spec, names] of importsOf(src)) {
      const target = spec.replace(/^\.\//, '').split('?')[0];
      if (!files.includes(target)) {
        broken.push(`${spec} — no such module`);
        continue;
      }
      const available = exportsOf(read(target));
      for (const name of names) {
        if (!available.has(name)) broken.push(`${name} from ${spec}`);
      }
    }

    assert.deepEqual(broken.sort(), [],
      `${file} imports names that are not exported: ${broken.join(', ')}. An unresolved import `
      + 'fails the entire module at load time, so the whole screen goes, not just the feature.');
  });
}

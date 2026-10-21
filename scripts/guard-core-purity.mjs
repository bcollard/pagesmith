#!/usr/bin/env node
/* Core-purity guard.
 *
 * src/core holds the settings schema, the scroll planner, the tile layout,
 * filename templating and the PDF writer. It is pure: no chrome.*, no DOM, no
 * storage, no network, no clock beyond what is passed in.
 *
 * That purity is what lets the stitching geometry -- where the page is
 * scrolled and where each capture lands in the output -- be tested in
 * milliseconds without a browser. Off-by-one errors in that geometry show up
 * as a duplicated or missing strip in the final image, which is easy to miss
 * by eye and cheap to catch with a unit test.
 *
 * The eslint config enforces the same rule at author time. This exists because
 * a lint rule can be disabled inline and a CI script that reads the file is
 * harder to wave through -- it also catches an import that reaches chrome.*
 * transitively through src/platform.
 */

import { existsSync } from 'node:fs';
import { join, dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, read, rel, scanJs, report } from './lib/scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = join(root, 'src', 'core');

const failures = [];
const notes = [];

if (!existsSync(coreDir)) {
  console.log('\n✓ core-purity guard: src/core does not exist yet, nothing to check\n');
  process.exit(0);
}

const BANNED = [
  { re: /\bchrome\s*\./, what: 'a chrome.* API' },
  { re: /\bbrowser\s*\./, what: 'a browser.* API' },
  { re: /\bglobalThis\s*\.\s*(chrome|browser)\b/, what: 'a browser API via globalThis' },
  { re: /\bfetch\s*\(/, what: 'fetch()' },
  { re: /\blocalStorage\b/, what: 'localStorage' },
  { re: /\bsessionStorage\b/, what: 'sessionStorage' },
  { re: /\bindexedDB\b/, what: 'indexedDB' },
  { re: /\bdocument\s*\./, what: 'the DOM' },
  { re: /\bwindow\s*\./, what: 'window' },
];

/* An import that crosses out of src/core defeats the point even if this file
   itself is clean. Only sibling core modules are allowed: core has no
   dependencies at all.

   Matched against comment-stripped source, not raw source. Prose contains the
   word "from" followed by a quoted phrase often enough that reading comments
   here produces false failures -- and a guard that cries wolf is a guard people
   learn to override. */
const IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;

const files = walk(coreDir).filter((f) => ['.ts', '.tsx'].includes(extname(f)));

for (const file of files) {
  const name = rel(file, root);
  if (/\.(test|spec)\.tsx?$/.test(file)) continue;

  const source = read(file);
  const { code, withoutComments } = scanJs(source);

  for (const { re, what } of BANNED) {
    if (re.test(code)) failures.push(`${name}: reaches ${what}`);
  }

  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(withoutComments)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      /* Resolve the specifier for real rather than pattern-matching the
         string: `../../platform/chrome` and `../core/../platform/chrome` are the
         same escape and only path resolution catches both. */
      const target = resolve(dirname(file), spec);
      if (relative(coreDir, target).startsWith('..')) {
        failures.push(`${name}: relative import escapes src/core -> ${spec}`);
      }
      continue;
    }
    failures.push(`${name}: imports "${spec}" -- src/core may only import itself`);
  }
}

notes.push(`checked ${files.length} file(s) under src/core`);
process.exit(report('core-purity guard', failures, notes));

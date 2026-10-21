#!/usr/bin/env node
/* Produces dist/chrome-granted: the built extension with <all_urls> declared
 * in host_permissions.
 *
 * Needed because Pagesmith's only page access is activeTab, which Chrome
 * grants when the user clicks the toolbar button or presses the shortcut.
 * Playwright can do neither -- the toolbar is browser UI, not page content --
 * so without this the end-to-end suite could never capture anything.
 *
 * Test-only. Never packaged: `scripts/pack.mjs` reads dist/chrome.
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'chrome');
const target = join(root, 'dist', 'chrome-granted');

if (!existsSync(join(source, 'manifest.json'))) {
  console.error('\n✗ no build at dist/chrome. Run `npm run build` first.\n');
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const manifestPath = join(target, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(manifestPath, JSON.stringify(manifest));

console.log(`✓ dist/chrome-granted — host_permissions: ${JSON.stringify(manifest.host_permissions)}`);

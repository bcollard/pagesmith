#!/usr/bin/env node
/* Produces the Chrome Web Store screenshots in assets/store/screenshots/.
 *
 * Everything shown is real: the built extension (dist/chrome-granted)
 * captures scripts/store-screenshots/demo.html, and the popup, viewer and
 * options pages are screenshotted as they render. Only the framing (captions,
 * layout) is composed, in a second browser at deviceScaleFactor 1, because
 * the store rejects anything that is not exactly 1280 x 800.
 *
 * Run with `npm run screenshots`, which builds first.
 */

// Callbacks passed to evaluate() run in the browser, not in Node.
/* global chrome, document, window, FileReader */

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dist', 'chrome-granted');
const demoPath = path.join(root, 'scripts', 'store-screenshots', 'demo.html');
const outDir = path.join(root, 'assets', 'store', 'screenshots');
// JPEG copies for the GitHub Pages site, where PNGs would be several times
// the download for no visible difference.
const siteDir = path.join(root, 'docs', 'img', 'screenshots');
const W = 1280;
const H = 800;

const png = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

async function shootExtension() {
  const server = createServer(async (_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(await readFile(demoPath));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // A readable fictional host instead of 127.0.0.1:port, since the viewer
  // shows the source address.
  const url = 'http://ridgeline-notes.example/walks/seven-days-on-the-coast-path';
  const port = server.address().port;

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    viewport: null,
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--lang=en-US',
      `--host-resolver-rules=MAP ridgeline-notes.example 127.0.0.1:${port}`,
      '--window-position=-32000,-32000',
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const ext = `chrome-extension://${new URL(worker.url()).host}`;

    const control = await context.newPage();
    await control.goto(`${ext}/options.html`);

    // The page being captured lives in a window of its own: captureVisibleTab
    // captures the active tab of a window.
    const demoOpened = context.waitForEvent('page', (p) => p.url() === url);
    const tabId = await control.evaluate(async (u) => {
      const win = await chrome.windows.create({ url: u, width: 1200, height: 860, focused: true });
      return win.tabs[0].id;
    }, url);
    const demo = await demoOpened;
    await demo.waitForLoadState('load');

    const viewerOpened = context.waitForEvent('page', {
      predicate: (p) => p.url().includes('/capture.html?id='),
      timeout: 90_000,
    });

    // The real popup, started the way the toolbar button starts it, and
    // photographed part-way through.
    // In a window of its own, as the real popup is: a tab in the demo's
    // window would be the one captureVisibleTab sees.
    const popupOpened = context.waitForEvent('page', (p) => p.url().includes('/popup.html'));
    await control.evaluate(async (u) => {
      await chrome.windows.create({ url: u, type: 'popup', width: 340, height: 400, focused: false });
    }, `${ext}/popup.html?tab=${tabId}`);
    const popup = await popupOpened;
    await popup.waitForFunction(() => {
      const v = Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'));
      return v >= 45 && v < 90;
    }, null, { timeout: 60_000, polling: 50 });
    const popupShot = await popup.locator('main').screenshot({ scale: 'css' });

    const viewer = await viewerOpened;
    await viewer.waitForSelector('#image img');
    const capture = await viewer.evaluate(async () => {
      const img = document.querySelector('#image img');
      await img.decode();
      const blob = await (await fetch(img.src)).blob();
      const data = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      return { data, width: img.naturalWidth, height: img.naturalHeight };
    });

    await demo.setViewportSize({ width: 1100, height: 700 });
    await demo.evaluate(() => window.scrollTo(0, 0));
    const demoShot = await demo.screenshot({ scale: 'css' });

    await viewer.setViewportSize({ width: W, height: H });
    await viewer.bringToFront();
    const viewerShot = await viewer.screenshot({ scale: 'css' });
    await viewer.emulateMedia({ colorScheme: 'dark' });
    const viewerDarkShot = await viewer.screenshot({ scale: 'css' });

    const options = await context.newPage();
    await options.setViewportSize({ width: W, height: H });
    await options.goto(`${ext}/options.html`);
    await options.waitForLoadState('load');
    const optionsShot = await options.screenshot({ scale: 'css' });

    return { popupShot, capture, demoShot, viewerShot, viewerDarkShot, optionsShot };
  } finally {
    await context.close();
    server.close();
  }
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #14161a;
         background: linear-gradient(160deg, #f3f7fc 0%, #dfe9f5 100%); }
  .caption { position: absolute; left: 64px; top: 44px; width: 560px; }
  .caption h1 { margin: 0 0 12px; font-size: 40px; line-height: 1.15; letter-spacing: -0.01em; }
  .caption p { margin: 0; font-size: 19px; color: #3d4652; }
  .caption .accent { color: #1d5fa8; }
  .shadow { box-shadow: 0 18px 50px rgba(20, 40, 70, 0.22), 0 2px 6px rgba(20, 40, 70, 0.12); }
`;

function stageHero({ demoShot, popupShot, capture }) {
  // The full capture, scaled to fit the right-hand column.
  const capH = 700;
  const capW = Math.round((capture.width / capture.height) * capH);
  return `
    <div class="caption">
      <h1>The whole page,<br><span class="accent">one image</span></h1>
      <p>Click once. Pagesmith scrolls the page and joins every screen into a single PNG, JPEG or PDF.</p>
    </div>
    <div style="position:absolute; left:64px; top:250px; width:820px; border-radius:10px; overflow:hidden; background:#fff" class="shadow">
      <div style="height:34px; background:#e8edf3; display:flex; align-items:center; gap:7px; padding:0 14px">
        <i style="width:11px;height:11px;border-radius:50%;background:#f26b5e"></i>
        <i style="width:11px;height:11px;border-radius:50%;background:#f6bd4f"></i>
        <i style="width:11px;height:11px;border-radius:50%;background:#5fc454"></i>
        <span style="margin-left:18px; flex:1; height:20px; border-radius:10px; background:#fff"></span>
      </div>
      <img src="${png(demoShot)}" style="display:block; width:820px">
    </div>
    <img src="${png(popupShot)}" style="position:absolute; left:600px; top:335px; width:300px; border-radius:8px; background:#fff" class="shadow">
    <div style="position:absolute; right:64px; top:50px; width:${capW}px; height:${capH}px; border-radius:6px; overflow:hidden; background:#fff" class="shadow">
      <img src="${capture.data}" style="display:block; width:${capW}px; height:${capH}px">
    </div>`;
}

function stageFramed(shot, title, text) {
  return `
    <div class="caption" style="width:1150px">
      <h1 style="font-size:34px; margin-bottom:6px">${title}</h1>
      <p>${text}</p>
    </div>
    <img src="${png(shot)}" style="position:absolute; left:64px; top:160px; width:1152px; border-radius:10px" class="shadow">`;
}

function stagePrivacy() {
  const row = (perm, why) => `
    <tr><td style="padding:14px 18px; font-family:ui-monospace,Menlo,monospace; font-size:17px; color:#1d5fa8; white-space:nowrap">${perm}</td>
        <td style="padding:14px 18px; font-size:17px">${why}</td></tr>`;
  const point = (title, text) => `
    <div style="background:#fff; border-radius:12px; padding:22px 24px" class="shadow">
      <div style="font-weight:700; font-size:20px; margin-bottom:6px">${title}</div>
      <div style="color:#3d4652; font-size:16px">${text}</div>
    </div>`;
  return `
    <div class="caption" style="width:1150px">
      <h1>Nothing leaves your browser</h1>
      <p>No account, no server, no network requests. Captures stay in the extension's storage on your computer.</p>
    </div>
    <div style="position:absolute; left:64px; top:210px; width:1152px; display:grid; grid-template-columns:repeat(3,1fr); gap:24px">
      ${point('No access to any site at install', 'Pagesmith only sees the tab you click its button on, until you leave the page.')}
      ${point('Open source, MIT licence', 'The code is published unminified, so anyone can read what ships.')}
      ${point('Verifiable releases', 'Each release rebuilds byte for byte from source and carries a signed provenance attestation.')}
    </div>
    <div style="position:absolute; left:64px; top:410px; width:1152px; background:#fff; border-radius:12px; overflow:hidden" class="shadow">
      <div style="padding:16px 18px 6px; font-weight:700; font-size:18px">Every permission it asks for</div>
      <table style="border-collapse:collapse; width:100%">
        ${row('activeTab', 'Capture the tab you invoked it on, and nothing else')}
        ${row('scripting', 'Scroll that page and hide floating elements while the capture runs')}
        ${row('storage', 'Remember your settings and the progress of a running capture')}
      </table>
    </div>`;
}

async function compose(shots) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const stages = [
      ['1-whole-page.png', stageHero(shots)],
      ['2-viewer.png', stageFramed(shots.viewerShot, 'Download, copy or save as PDF',
        'PNG, JPEG, PDF in A4, Letter or fit-to-content, or straight to the clipboard. Recent captures are kept so you can come back to them.')],
      ['3-dark-mode.png', stageFramed(shots.viewerDarkShot, 'Follows your system theme',
        'Light and dark mode, in English, French, German, Spanish and Japanese.')],
      ['4-options.png', stageFramed(shots.optionsShot, 'Set it up once',
        'Image format and quality, how floating headers are handled, file names, PDF paper size, and how many captures to keep.')],
      ['5-privacy.png', stagePrivacy()],
    ];
    for (const dir of [outDir, siteDir]) {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    }
    for (const [name, body] of stages) {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`);
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
      await page.screenshot({ path: path.join(outDir, name) });
      console.log(`wrote assets/store/screenshots/${name}`);
      const jpg = name.replace(/\.png$/, '.jpg');
      await page.screenshot({ path: path.join(siteDir, jpg), type: 'jpeg', quality: 85 });
      console.log(`wrote docs/img/screenshots/${jpg}`);
    }
  } finally {
    await browser.close();
  }
}

await compose(await shootExtension());

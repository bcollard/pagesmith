/* End-to-end: the real extension captures real pages in Chromium, and the
 * stitched output is checked pixel by pixel.
 *
 * Unit tests prove the geometry is right on paper. Only a browser proves the
 * agent's measurements, Chrome's scroll clamping, the device pixel ratio and
 * captureVisibleTab agree with it -- a disagreement shows up as a repeated or
 * missing strip at a seam, which is exactly what the samples below look for.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(here, '..', 'dist', 'chrome-granted');

type RGB = [number, number, number];

let context: BrowserContext;
let server: Server;
let origin: string;
let extensionId: string;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const name = path.basename(new URL(req.url ?? '/', 'http://x').pathname);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(await readFile(path.join(here, 'fixtures', name)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    // Real window sizes: captureVisibleTab captures the window, not
    // Playwright's emulated viewport.
    viewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(process.env['HEADED'] ? [] : ['--window-position=-32000,-32000']),
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(resolve));
});

/* Opens the fixture in a window of its own -- captureVisibleTab captures the
   active tab of a window, so the controlling extension page has to live
   elsewhere -- and starts a capture of it the way the popup does. */
async function capture(fixture: string): Promise<{ viewer: Page; fixture: Page }> {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);

  const fixturePage = context.waitForEvent('page', (p) => p.url().includes(fixture));
  const tabId = await control.evaluate(async (url) => {
    const win = await chrome.windows.create({ url, width: 1000, height: 800, focused: true });
    return win!.tabs![0]!.id!;
  }, `${origin}/${fixture}`);
  const page = await fixturePage;
  await page.waitForLoadState('load');

  const viewer = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/capture.html?id='),
    timeout: 60_000,
  });
  const response = await control.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'capture:start', tabId: id }),
    tabId,
  );
  expect(response).toEqual({ accepted: true });
  const v = await viewer;
  await v.waitForSelector('#image img');
  return { viewer: v, fixture: page };
}

/* Reads pixels from the stored image at the given CSS-pixel rows of the
   original page, scaled by the capture's device pixel ratio. */
async function sample(viewer: Page, x: number, ys: number[]) {
  return viewer.evaluate(
    async ({ x, ys }) => {
      const img = document.querySelector<HTMLImageElement>('#image img')!;
      await img.decode();
      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const container = document.getElementById('image')!;
      const scale = img.naturalWidth / parseFloat(container.style.width);
      const pixels = ys.map((y) => {
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
      return { width: img.naturalWidth, height: img.naturalHeight, scale, pixels };
    },
    { x, ys },
  );
}

const near = (actual: RGB, expected: RGB) => actual.every((c, i) => Math.abs(c - expected[i]!) <= 10);

function expectColor(actual: RGB | undefined, expected: RGB, label: string) {
  expect(actual && near(actual, expected), `${label}: got rgb(${actual?.join(', ')}), want rgb(${expected.join(', ')})`).toBe(true);
}

test('stitches a long page with one copy of fixed and sticky elements', async () => {
  const { viewer, fixture } = await capture('bands.html');
  const innerHeight = await fixture.evaluate(() => window.innerHeight);

  const bands: { top: number; color: RGB }[] = [
    { top: 0, color: [200, 0, 0] },
    { top: 500, color: [0, 200, 0] },
    { top: 1000, color: [0, 0, 200] },
    { top: 1500, color: [200, 200, 0] },
    { top: 2040, color: [0, 200, 200] },
    { top: 2540, color: [200, 0, 200] },
    { top: 3040, color: [100, 50, 0] },
    { top: 3540, color: [0, 100, 50] },
    { top: 4040, color: [50, 0, 100] },
    { top: 4540, color: [120, 120, 120] },
  ];
  const frameTops = [1, 2, 3, 4, 5].map((k) => k * innerHeight + 3).filter((y) => y < 5000);
  const ys = [10, 2020, ...bands.map((b) => b.top + 250), ...frameTops];
  const { height, scale, pixels } = await sample(viewer, 500, ys);

  expect(height).toBe(Math.round(5040 * scale));
  expectColor(pixels[0], [255, 0, 255], 'fixed header in the first frame');
  expectColor(pixels[1], [0, 255, 255], 'sticky bar in its flow position');
  bands.forEach((band, i) => expectColor(pixels[2 + i], band.color, `band at ${band.top}`));
  // The top of every later frame shows page content: no second header, no
  // second sticky bar.
  pixels.slice(2 + bands.length).forEach((p, i) => {
    expect(near(p as RGB, [255, 0, 255]), `header repeated at ${frameTops[i]}`).toBe(false);
    expect(near(p as RGB, [0, 255, 255]), `sticky repeated at ${frameTops[i]}`).toBe(false);
  });

  // The page is put back the way it was found.
  const restored = await fixture.evaluate(() => ({
    y: window.scrollY,
    marked: document.querySelectorAll('[data-pagesmith-sticky],[data-pagesmith-hidden],[data-pagesmith-scroller]').length,
  }));
  expect(restored).toEqual({ y: 0, marked: 0 });
});

test('captures an inner scrolling container in full', async () => {
  const { viewer } = await capture('app-shell.html');
  const rows: RGB[] = [
    [220, 30, 30],
    [30, 220, 30],
    [30, 30, 220],
    [220, 220, 30],
    [30, 220, 220],
    [220, 30, 220],
  ];
  const { height, scale, pixels } = await sample(
    viewer,
    100,
    rows.map((_, i) => i * 400 + 200),
  );
  expect(height).toBe(Math.round(2400 * scale));
  rows.forEach((color, i) => expectColor(pixels[i], color, `row ${i}`));
});

test('exports a PDF the viewer can produce without error', async () => {
  const { viewer } = await capture('bands.html');
  const download = viewer.waitForEvent('download');
  await viewer.click('#pdf');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^127\.0\.0\.1-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.pdf$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = Buffer.concat(chunks).toString('latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
});

test('stops instead of stitching another tab when the user switches tabs', async () => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  const fixturePage = context.waitForEvent('page', (p) => p.url().includes('bands.html'));
  const { tabId, windowId } = await control.evaluate(async (url) => {
    const win = await chrome.windows.create({ url, width: 1000, height: 800, focused: true });
    return { tabId: win!.tabs![0]!.id!, windowId: win!.id! };
  }, `${origin}/bands.html`);
  await (await fixturePage).waitForLoadState('load');

  await control.evaluate(
    async ({ tabId, windowId }) => {
      await chrome.runtime.sendMessage({ type: 'capture:start', tabId });
      // Let the first frame go through, then open another tab on top.
      await new Promise((r) => setTimeout(r, 300));
      await chrome.tabs.create({ windowId, url: 'about:blank', active: true });
    },
    { tabId, windowId },
  );

  const job = await control.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const check = async () => {
          const { job } = (await chrome.storage.session.get('job')) as { job?: { status: string } };
          if (job && job.status !== 'running') resolve(job);
          else setTimeout(check, 100);
        };
        void check();
      }),
  );
  expect(job).toMatchObject({ status: 'error', error: 'tab-switched', tabId });
});

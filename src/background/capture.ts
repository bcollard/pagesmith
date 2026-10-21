/* The capture loop, run in the service worker.
 *
 * Running it here rather than in the popup means closing the popup does not
 * cancel the capture: the popup is only a progress display. The worker stays
 * alive because it makes an extension API call at least every half second.
 *
 * Frames are drawn straight into OffscreenCanvas tiles as they arrive, so
 * memory holds the output plus one frame, never every frame at once. */

import {
  columnOffsets,
  measureScale,
  nextRowOffset,
  outputHeight,
  place,
  progress,
  splitAcrossTiles,
  tileGrid,
  type Rect,
  type Size,
} from '../core/geometry';
import { PAGE_CSS } from '../core/page-style';
import {
  isRestrictedUrl,
  isScriptBlockedButCapturable,
  type CaptureErrorCode,
  type PageMetrics,
  type PartialReason,
} from '../core/protocol';
import type { Settings } from '../core/settings';
import { putCapture, pruneCaptures, type StoredCapture, type StoredTile } from '../platform/captures';
import {
  captureVisibleTab,
  getTab,
  injectAgent,
  openViewer,
  sendToAgent,
  setBadge,
  setJob,
  sleep,
} from '../platform/chrome';
import { loadSettings } from '../platform/settings';

export class CaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/* Decoded without fetch(): fetching a data: URL works, but it would be the
   only network primitive in the bundle, and the egress guard is simpler and
   stronger when it can assert there are none. */
async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

class TileSet {
  private readonly canvases = new Map<number, OffscreenCanvas>();
  readonly tiles: Rect[];
  bottom = 0;

  constructor(readonly size: Size) {
    this.tiles = tileGrid(size);
  }

  /* Tiles are created on first use. The grid is laid out for the height
     limit, which is far taller than most pages; allocating it all up front
     would reserve memory for rows that are never drawn. */
  private canvas(index: number): OffscreenCanvas {
    let canvas = this.canvases.get(index);
    if (!canvas) {
      const t = this.tiles[index]!;
      canvas = new OffscreenCanvas(t.width, t.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, t.width, t.height);
      this.canvases.set(index, canvas);
    }
    return canvas;
  }

  draw(frame: ImageBitmap, crop: Rect, scroll: { x: number; y: number }, scale: number) {
    const p = place(crop, scroll, scale, { width: frame.width, height: frame.height }, this.size);
    if (!p) return;
    this.bottom = Math.max(this.bottom, p.dy + p.height);
    for (const { tile, placement: q } of splitAcrossTiles(p, this.tiles)) {
      this.canvas(tile)
        .getContext('2d')!
        .drawImage(frame, q.sx, q.sy, q.width, q.height, q.dx, q.dy, q.width, q.height);
    }
  }

  /* Encodes the tiles that hold drawn content, trimming the last row to the
     lowest pixel actually drawn. */
  async encode(): Promise<StoredTile[]> {
    const out: StoredTile[] = [];
    for (const [index, t] of this.tiles.entries()) {
      if (t.y >= this.bottom) continue;
      const height = Math.min(t.height, this.bottom - t.y);
      let canvas = this.canvas(index);
      if (height < t.height) {
        const trimmed = new OffscreenCanvas(t.width, height);
        trimmed.getContext('2d')!.drawImage(canvas, 0, 0);
        canvas = trimmed;
      }
      out.push({ x: t.x, y: t.y, width: t.width, height, blob: await canvas.convertToBlob({ type: 'image/png' }) });
    }
    return out;
  }
}

type Progress = (fraction: number) => Promise<void>;

async function captureFullPage(
  tab: chrome.tabs.Tab & { id: number },
  settings: Settings,
  onProgress: Progress,
): Promise<Omit<StoredCapture, 'id' | 'url' | 'title' | 'createdAt'>> {
  const target = { tabId: tab.id };
  await chrome.scripting.insertCSS({ target, css: PAGE_CSS });
  try {
    await injectAgent(tab.id);
    const metrics: PageMetrics = await sendToAgent(tab.id, {
      type: 'agent:prepare',
      preScroll: settings.preScroll,
      limit: settings.maxPageHeight,
    });

    try {
      return await scrollAndStitch(tab, metrics, settings, onProgress);
    } finally {
      await sendToAgent(tab.id, { type: 'agent:restore' }).catch(() => undefined);
    }
  } finally {
    await chrome.scripting.removeCSS({ target, css: PAGE_CSS }).catch(() => undefined);
  }
}

async function scrollAndStitch(
  tab: chrome.tabs.Tab & { id: number },
  metrics: PageMetrics,
  settings: Settings,
  onProgress: Progress,
) {
  const limit = settings.maxPageHeight;
  const columns = columnOffsets(metrics.extent.width, metrics.viewport.width);
  // A hard stop in case the page resists scrolling in a way the offset
  // checks below do not catch.
  const maxFrames = (Math.ceil(limit / Math.max(1, metrics.viewport.height)) + 2) * columns.length;

  let tiles: TileSet | null = null;
  let scale = 1;
  let extent = metrics.extent;
  let frames = 0;
  let row: number | null = 0;
  let lastRowY = -1;

  while (row !== null && frames < maxFrames) {
    let rowY = row;
    for (const x of columns) {
      const pos = await sendToAgent(tab.id, { type: 'agent:scroll', x, y: row });
      extent = pos.extent;
      rowY = pos.y;

      const hide = settings.fixedElements === 'always' || (settings.fixedElements === 'after-first' && frames > 0);
      if (hide) await sendToAgent(tab.id, { type: 'agent:hide-fixed' });
      if (settings.captureDelayMs > 0) await sleep(settings.captureDelayMs);

      const frame = await decodeDataUrl(await captureVisibleTab(tab.windowId));
      if (!tiles) {
        scale = measureScale(frame.width, metrics.window.width);
        tiles = new TileSet({
          width: Math.round(extent.width * scale),
          height: Math.round(limit * scale),
        });
      }
      tiles.draw(frame, metrics.crop, pos, scale);
      frame.close();
      frames++;
    }

    await onProgress(progress(rowY, metrics.viewport.height, extent.height, limit));
    // The page refused to move further down; stop rather than capture the
    // same row again.
    if (rowY <= lastRowY) break;
    lastRowY = rowY;
    row = nextRowOffset(rowY, extent.height, metrics.viewport.height, limit);
  }

  if (!tiles) throw new CaptureError('capture-failed', 'no frame was captured');
  const partial: PartialReason | null = extent.height > limit ? 'height-limit' : null;
  // The height the content actually reached, which can be less than the
  // grid when the page is shorter than the limit.
  tiles.bottom = Math.min(tiles.bottom, Math.round(outputHeight(extent.height, limit) * scale));
  const encoded = await tiles.encode();
  return { width: tiles.size.width, height: tiles.bottom, scale, partial, tiles: encoded };
}

/* For pages Chrome will not let any extension script, such as the Web Store:
   one frame of what is on screen is still better than an error. */
async function captureVisibleOnly(tab: chrome.tabs.Tab) {
  const frame = await decodeDataUrl(await captureVisibleTab(tab.windowId));
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  canvas.getContext('2d')!.drawImage(frame, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const scale = tab.width ? frame.width / tab.width : 1;
  frame.close();
  return {
    width: canvas.width,
    height: canvas.height,
    scale,
    partial: 'visible-only' as const,
    tiles: [{ x: 0, y: 0, width: canvas.width, height: canvas.height, blob }],
  };
}

let running = false;

export function isRunning(): boolean {
  return running;
}

export async function runCapture(tabId: number): Promise<void> {
  running = true;
  const startedAt = Date.now();
  try {
    await setJob({ status: 'running', tabId, progress: 0, startedAt });
    await setBadge(tabId, '…').catch(() => undefined);

    const tab = await getTab(tabId).catch(() => null);
    if (!tab || tab.id === undefined) throw new CaptureError('no-tab', 'the tab is gone');
    const withId = tab as chrome.tabs.Tab & { id: number };
    const settings = await loadSettings();

    const onProgress: Progress = async (fraction) => {
      await setJob({ status: 'running', tabId, progress: fraction, startedAt });
      await setBadge(tabId, `${Math.round(fraction * 100)}%`).catch(() => undefined);
    };

    let body;
    if (isScriptBlockedButCapturable(tab.url)) body = await captureVisibleOnly(tab);
    else if (isRestrictedUrl(tab.url)) throw new CaptureError('restricted-page', tab.url ?? 'no url');
    else body = await captureFullPage(withId, settings, onProgress);

    const capture: StoredCapture = {
      id: crypto.randomUUID(),
      url: tab.url ?? '',
      title: tab.title ?? '',
      createdAt: Date.now(),
      ...body,
    };
    await putCapture(capture);
    await pruneCaptures(settings.keepCaptures);
    await setJob({ status: 'done', tabId, captureId: capture.id, partial: capture.partial });
    await setBadge(tabId, '').catch(() => undefined);
    await openViewer(capture.id, tab);
  } catch (err) {
    const code: CaptureErrorCode = err instanceof CaptureError ? err.code : 'capture-failed';
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[pagesmith] capture failed:', err);
    await setJob({ status: 'error', tabId, error: code, detail });
    await setBadge(tabId, '!').catch(() => undefined);
  } finally {
    running = false;
  }
}

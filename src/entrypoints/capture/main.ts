/* The capture viewer: shows one capture, exports it, and lists recent ones.
 *
 * Downloads go through an <a download> link on a blob: URL. That needs no
 * `downloads` permission, always shows Chrome's own download UI, and keeps
 * the permission list at activeTab, scripting and storage. */

import { partName, renderFilename } from '../../core/filename';
import { buildPdf, paginate, type PdfPage } from '../../core/pdf';
import type { Settings } from '../../core/settings';
import { deleteCapture, getCapture, listCaptures, type StoredCapture } from '../../platform/captures';
import { loadSettings } from '../../platform/settings';
import { applyI18n, t } from '../../ui/i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

applyI18n();

function toast(message: string) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2500);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked later rather than immediately: Chrome reads the URL
  // asynchronously after the click, and an early revoke cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function toJpeg(blob: Blob, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

async function makePdf(capture: StoredCapture, settings: Settings): Promise<Blob> {
  const pages: PdfPage[] = [];
  // Tiles are stored row by row, so their order is page order.
  for (const tile of capture.tiles) {
    const bitmap = await createImageBitmap(tile.blob);
    for (const slice of paginate(tile.width, tile.height, settings.pdfPaper)) {
      const canvas = new OffscreenCanvas(tile.width, slice.sliceHeight);
      canvas.getContext('2d')!.drawImage(bitmap, 0, slice.sliceY, tile.width, slice.sliceHeight, 0, 0, tile.width, slice.sliceHeight);
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: settings.jpegQuality });
      pages.push({
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        width: tile.width,
        height: slice.sliceHeight,
        pageWidth: slice.pageWidth,
        pageHeight: slice.pageHeight,
        drawHeight: slice.drawHeight,
      });
    }
    bitmap.close();
  }
  const bytes = buildPdf(pages, capture.title || capture.url);
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}

function renderImage(capture: StoredCapture) {
  const container = $('image');
  container.replaceChildren();
  // Actual size is CSS size: the output divided by the device pixel ratio it
  // was captured at, so a Retina capture is not shown twice as large.
  const cssWidth = Math.round(capture.width / capture.scale);
  container.style.width = `${cssWidth}px`;
  container.style.aspectRatio = `${capture.width} / ${capture.height}`;
  for (const tile of capture.tiles) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(tile.blob);
    img.alt = '';
    img.style.left = `${(tile.x / capture.width) * 100}%`;
    img.style.top = `${(tile.y / capture.height) * 100}%`;
    img.style.width = `${(tile.width / capture.width) * 100}%`;
    img.style.height = `${(tile.height / capture.height) * 100}%`;
    container.append(img);
  }
  container.hidden = false;
}

async function renderList(currentId: string | null) {
  const captures = await listCaptures();
  const list = $('list');
  list.replaceChildren();
  $('empty').hidden = captures.length > 0;
  const format = new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  for (const c of captures) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `?id=${encodeURIComponent(c.id)}`;
    if (c.id === currentId) a.setAttribute('aria-current', 'page');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.title || c.url;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = format.format(c.createdAt);
    a.append(name, when);
    li.append(a);
    list.append(li);
  }
}

async function showCapture(id: string) {
  const [capture, settings] = await Promise.all([getCapture(id), loadSettings()]);
  if (!capture) {
    const notice = $('notice');
    notice.textContent = t('viewerNotFound');
    notice.hidden = false;
    return;
  }

  document.title = `${capture.title || capture.url} – Pagesmith`;
  $('title').textContent = capture.title || capture.url;
  const source = $<HTMLAnchorElement>('source');
  source.textContent = capture.url;
  // Only web URLs become links; anything else is shown as text.
  if (/^https?:/i.test(capture.url)) source.href = capture.url;
  $('details').textContent = ` · ${t('viewerSize', [String(capture.width), String(capture.height)])}`;
  $('actions').hidden = false;

  const notices: string[] = [];
  if (capture.partial === 'visible-only') notices.push(t('viewerPartialVisible'));
  if (capture.partial === 'height-limit') notices.push(t('viewerPartialLimit'));
  if (capture.tiles.length > 1) notices.push(t('viewerParts', String(capture.tiles.length)));
  if (notices.length) {
    const notice = $('notice');
    notice.textContent = notices.join(' ');
    notice.hidden = false;
  }

  renderImage(capture);

  const base = renderFilename(settings.filenameTemplate, {
    url: capture.url,
    title: capture.title,
    date: new Date(capture.createdAt),
  });

  const zoom = $<HTMLButtonElement>('zoom');
  zoom.addEventListener('click', () => {
    const fit = $('image').classList.toggle('fit');
    zoom.textContent = t(fit ? 'viewerActual' : 'viewerFit');
  });

  $('download').addEventListener('click', async () => {
    const ext = settings.format === 'jpeg' ? 'jpg' : 'png';
    for (const [i, tile] of capture.tiles.entries()) {
      const blob = settings.format === 'jpeg' ? await toJpeg(tile.blob, settings.jpegQuality) : tile.blob;
      saveBlob(blob, partName(base, i, capture.tiles.length, ext));
    }
  });

  const pdf = $<HTMLButtonElement>('pdf');
  pdf.addEventListener('click', async () => {
    pdf.disabled = true;
    try {
      saveBlob(await makePdf(capture, settings), `${base}.pdf`);
    } finally {
      pdf.disabled = false;
    }
  });

  // The clipboard holds one image. A multi-part capture has no single image
  // to put there, so the button is disabled and says why.
  const copy = $<HTMLButtonElement>('copy');
  if (capture.tiles.length > 1) {
    copy.disabled = true;
    copy.title = t('viewerCopyMulti');
  }
  copy.addEventListener('click', async () => {
    const tile = capture.tiles[0];
    if (!tile) return;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': tile.blob })]);
    toast(t('viewerCopied'));
  });

  $('delete').addEventListener('click', async () => {
    await deleteCapture(capture.id);
    location.search = '';
  });
}

async function main() {
  const id = new URLSearchParams(location.search).get('id');
  if (id) await showCapture(id);
  await renderList(id);
}

void main();

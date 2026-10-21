/* Scroll planning and stitching geometry.
 *
 * Everything here is in one of two units, and mixing them up is the classic
 * full-page-capture bug (a strip duplicated or missing at every seam):
 *
 *   - CSS pixels: what the page agent measures and scrolls in.
 *   - device pixels: what captureVisibleTab returns, i.e. CSS pixels times
 *     devicePixelRatio times the tab's zoom. The ratio is measured from the
 *     first capture rather than trusted from window.devicePixelRatio, because
 *     the two disagree whenever the tab is zoomed.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* Horizontal scroll offsets that cover `extent` in steps of `viewport`. The
   last step is pulled back so it ends exactly at the right edge rather than
   asking the browser to scroll past it; the overlap is drawn twice with the
   same pixels, which is harmless. */
export function columnOffsets(extentWidth: number, viewportWidth: number): number[] {
  if (viewportWidth <= 0) return [0];
  const last = Math.max(0, extentWidth - viewportWidth);
  const offsets: number[] = [];
  for (let x = 0; x < last; x += viewportWidth) offsets.push(x);
  offsets.push(last);
  return offsets;
}

/* The next vertical scroll offset, or null when the page is covered.
 *
 * Planned one row at a time rather than up front because pages grow while
 * they are being scrolled: lazy-loaded images expand, infinite feeds append.
 * The caller re-measures the extent after every scroll and passes it in.
 * `limit` caps the output for pages that would otherwise never end. */
export function nextRowOffset(
  current: number,
  extentHeight: number,
  viewportHeight: number,
  limit: number,
): number | null {
  if (viewportHeight <= 0) return null;
  const bottom = Math.min(extentHeight, limit);
  if (current + viewportHeight >= bottom) return null;
  const next = Math.min(current + viewportHeight, Math.max(0, bottom - viewportHeight));
  return next > current ? next : null;
}

/* The output height in CSS pixels for a page that is `extentHeight` tall. */
export function outputHeight(extentHeight: number, limit: number): number {
  return Math.max(1, Math.min(extentHeight, limit));
}

/* Fraction complete, for the progress bar. */
export function progress(offset: number, viewportHeight: number, extentHeight: number, limit: number): number {
  const total = outputHeight(extentHeight, limit);
  return Math.max(0, Math.min(1, (offset + viewportHeight) / total));
}

/* Device pixels per CSS pixel, from the first capture's actual width. */
export function measureScale(capturedWidth: number, viewportWidth: number): number {
  if (viewportWidth <= 0 || capturedWidth <= 0) return 1;
  return capturedWidth / viewportWidth;
}

/* One drawImage call: copy `source` from the captured frame to `dest` in
   output space. Both rects are in device pixels and always the same size. */
export interface Placement {
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/* Where one captured frame lands in the output.
 *
 *   crop    the part of the frame that shows the scroll target, in CSS px
 *           relative to the viewport -- the whole viewport for a page that
 *           scrolls the window, the element's box for an inner scroller
 *   scroll  where the target actually ended up scrolled, in CSS px. Never the
 *           offset that was asked for: the browser clamps at the edges, and
 *           drawing at the requested offset is what produces a repeated strip
 *           at the bottom of the image
 *   frame   the captured image size in device px
 *   output  the full output size in device px
 *
 * Positions are rounded once, in output space, so adjacent frames meet on
 * the same pixel row. Rounding source and destination separately can leave
 * a one-pixel seam at fractional ratios such as 1.25 or 1.5. */
export function place(crop: Rect, scroll: { x: number; y: number }, scale: number, frame: Size, output: Size): Placement | null {
  const dx = Math.round(scroll.x * scale);
  const dy = Math.round(scroll.y * scale);
  const sx = Math.round(crop.x * scale);
  const sy = Math.round(crop.y * scale);

  const width = Math.min(Math.round(crop.width * scale), frame.width - sx, output.width - dx);
  const height = Math.min(Math.round(crop.height * scale), frame.height - sy, output.height - dy);
  if (width <= 0 || height <= 0) return null;
  return { sx, sy, dx, dy, width, height };
}

/* Chrome's canvas limits, with headroom. The hard ceilings are 32,767 px per
   side and 268,435,456 px of area, but GPU-backed canvases fail well below the
   side limit on some drivers, and a failed canvas does not throw: it silently
   draws nothing and encodes as a blank image. 16,384 is the size every
   backend in current Chrome accepts. */
export const MAX_TILE_SIDE = 16384;

/* The output is split into a grid of tiles no larger than `maxSide`. Each tile
   becomes one image file, so a page 50,000 device px tall downloads as four
   PNGs rather than as one that Chrome cannot encode. */
export function tileGrid(output: Size, maxSide = MAX_TILE_SIDE): Rect[] {
  const tiles: Rect[] = [];
  for (let y = 0; y < output.height; y += maxSide) {
    for (let x = 0; x < output.width; x += maxSide) {
      tiles.push({
        x,
        y,
        width: Math.min(maxSide, output.width - x),
        height: Math.min(maxSide, output.height - y),
      });
    }
  }
  return tiles;
}

/* Splits one placement across the tiles it overlaps. A frame that straddles a
   tile boundary is drawn into both tiles, each receiving only its part. */
export function splitAcrossTiles(p: Placement, tiles: readonly Rect[]): { tile: number; placement: Placement }[] {
  const out: { tile: number; placement: Placement }[] = [];
  tiles.forEach((t, tile) => {
    const left = Math.max(p.dx, t.x);
    const top = Math.max(p.dy, t.y);
    const right = Math.min(p.dx + p.width, t.x + t.width);
    const bottom = Math.min(p.dy + p.height, t.y + t.height);
    if (right <= left || bottom <= top) return;
    out.push({
      tile,
      placement: {
        sx: p.sx + (left - p.dx),
        sy: p.sy + (top - p.dy),
        dx: left - t.x,
        dy: top - t.y,
        width: right - left,
        height: bottom - top,
      },
    });
  });
  return out;
}

/* The Pagesmith mark, defined once.
 *
 * A tall white page with a folded corner, cut into three stacked strips, on a
 * blue rounded tile. The strips are what the extension does: a page captured
 * one viewport at a time and joined into one image. Both the SVG (docs site,
 * README) and every PNG (extension icons, Web Store assets) are generated from
 * the geometry below, so the vector and the raster cannot drift apart.
 *
 * Coordinates are in a 0..100 space, origin top-left. Every shape is a closed
 * polygon of straight runs: at 16x16 the gaps between strips are about one
 * pixel, and curves would blur them away.
 */

export const PALETTE = {
  tile: '#1D5FA8',
  glyph: '#FFFFFF',
  // Used only by the promo tiles and og:image, never by the icon itself.
  tileDark: '#164A83',
  ink: '#14161A',
  paper: '#F3F7FC',
};

/* Fraction of the canvas the tile's corner radius occupies. Chrome renders
   the toolbar icon without a mask, so the tile provides its own shape. */
export const TILE_RADIUS = 0.2;

/* Inset of the glyph within the tile, as a fraction of the tile. */
export const GLYPH_INSET = 0.14;

/* The page spans x 20..80: a portrait page reads as "document" at any size,
   and a square one reads as a photo. The gaps are 9 units tall so they stay
   at least one pixel at 16px, where the glyph box is about 11px. */
const LEFT = 20;
const RIGHT = 80;
const FOLD = 18;
const GAP_1 = [33, 42];
const GAP_2 = [63, 72];

export const STRIPS = [
  // Top strip carries the folded corner.
  [
    [LEFT, 0],
    [RIGHT - FOLD, 0],
    [RIGHT, FOLD],
    [RIGHT, GAP_1[0]],
    [LEFT, GAP_1[0]],
  ],
  [
    [LEFT, GAP_1[1]],
    [RIGHT, GAP_1[1]],
    [RIGHT, GAP_2[0]],
    [LEFT, GAP_2[0]],
  ],
  [
    [LEFT, GAP_2[1]],
    [RIGHT, GAP_2[1]],
    [RIGHT, 100],
    [LEFT, 100],
  ],
];

function pathOf(points) {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ') + ' Z';
}

export function svg({ size = 128, tile = PALETTE.tile, glyph = PALETTE.glyph, rounded = true } = {}) {
  const r = rounded ? (TILE_RADIUS * 100).toFixed(1) : '0';
  const inset = GLYPH_INSET * 100;
  const span = 100 - inset * 2;
  const paths = STRIPS.map((s) => `    <path d="${pathOf(s)}" fill="${glyph}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Pagesmith">
  <title>Pagesmith</title>
  <rect width="100" height="100" rx="${r}" ry="${r}" fill="${tile}"/>
  <g transform="translate(${inset} ${inset}) scale(${(span / 100).toFixed(6)})">
${paths}
  </g>
</svg>
`;
}

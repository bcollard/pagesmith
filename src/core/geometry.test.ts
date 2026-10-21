import {
  MAX_TILE_SIDE,
  columnOffsets,
  measureScale,
  nextRowOffset,
  outputHeight,
  place,
  progress,
  splitAcrossTiles,
  tileGrid,
  type Placement,
} from './geometry';

describe('columnOffsets', () => {
  it('is a single column when the page is no wider than the viewport', () => {
    expect(columnOffsets(1280, 1280)).toEqual([0]);
    expect(columnOffsets(800, 1280)).toEqual([0]);
  });

  it('pulls the last column back to end at the right edge', () => {
    expect(columnOffsets(3000, 1280)).toEqual([0, 1280, 1720]);
  });

  it('does not repeat an offset when the width is an exact multiple', () => {
    expect(columnOffsets(2560, 1280)).toEqual([0, 1280]);
  });

  it('degrades to one column for a zero-width viewport', () => {
    expect(columnOffsets(1000, 0)).toEqual([0]);
  });
});

describe('nextRowOffset', () => {
  it('steps one viewport at a time', () => {
    expect(nextRowOffset(0, 5000, 800, 40000)).toBe(800);
    expect(nextRowOffset(800, 5000, 800, 40000)).toBe(1600);
  });

  it('pulls the last row back so it ends at the bottom of the page', () => {
    expect(nextRowOffset(3200, 4500, 800, 40000)).toBe(3700);
  });

  it('stops once the bottom has been reached', () => {
    expect(nextRowOffset(3700, 4500, 800, 40000)).toBeNull();
  });

  it('stops immediately for a page that fits the viewport', () => {
    expect(nextRowOffset(0, 600, 800, 40000)).toBeNull();
  });

  it('keeps going when the page grows while it is scrolled', () => {
    expect(nextRowOffset(3700, 4500, 800, 40000)).toBeNull();
    expect(nextRowOffset(3700, 9000, 800, 40000)).toBe(4500);
  });

  it('stops at the height limit on an endless page', () => {
    expect(nextRowOffset(9200, 1_000_000, 800, 10000)).toBeNull();
    expect(nextRowOffset(8800, 1_000_000, 800, 10000)).toBe(9200);
  });

  it('never returns an offset that does not move forward', () => {
    expect(nextRowOffset(500, 1000, 800, 40000)).toBeNull();
    expect(nextRowOffset(0, 1000, 0, 40000)).toBeNull();
  });
});

describe('outputHeight and progress', () => {
  it('caps the output at the limit', () => {
    expect(outputHeight(5000, 40000)).toBe(5000);
    expect(outputHeight(90000, 40000)).toBe(40000);
    expect(outputHeight(0, 40000)).toBe(1);
  });

  it('reports the covered fraction, clamped to 0..1', () => {
    expect(progress(0, 800, 4000, 40000)).toBeCloseTo(0.2);
    expect(progress(3200, 800, 4000, 40000)).toBe(1);
    expect(progress(5000, 800, 4000, 40000)).toBe(1);
  });
});

describe('measureScale', () => {
  it('is the captured width over the viewport width', () => {
    expect(measureScale(2560, 1280)).toBe(2);
    // A zoomed tab: devicePixelRatio says 2, the frame says otherwise.
    expect(measureScale(1600, 1280)).toBe(1.25);
  });

  it('falls back to 1 for nonsense input', () => {
    expect(measureScale(0, 1280)).toBe(1);
    expect(measureScale(1280, 0)).toBe(1);
  });
});

describe('place', () => {
  const output = { width: 2560, height: 20000 };
  const frame = { width: 2560, height: 1600 };
  const crop = { x: 0, y: 0, width: 1280, height: 800 };

  it('draws a window frame at its scroll position', () => {
    expect(place(crop, { x: 0, y: 800 }, 2, frame, output)).toEqual({
      sx: 0,
      sy: 0,
      dx: 0,
      dy: 1600,
      width: 2560,
      height: 1600,
    });
  });

  it('uses the element box for an inner scroller', () => {
    const inner = { x: 240, y: 64, width: 800, height: 600 };
    expect(place(inner, { x: 0, y: 600 }, 2, frame, { width: 1600, height: 9000 })).toEqual({
      sx: 480,
      sy: 128,
      dx: 0,
      dy: 1200,
      width: 1600,
      height: 1200,
    });
  });

  it('clips at the bottom of the output', () => {
    const p = place(crop, { x: 0, y: 9600 }, 2, frame, output)!;
    expect(p.dy + p.height).toBe(output.height);
  });

  it('returns null when nothing of the frame lands in the output', () => {
    expect(place(crop, { x: 0, y: 10000 }, 2, frame, output)).toBeNull();
  });

  it('meets the previous frame on the same row at fractional ratios', () => {
    const scale = 1.25;
    const f = { width: 1600, height: 1000 };
    const out = { width: 1600, height: 100000 };
    let previousBottom = 0;
    for (let y = 0; y < 8000; y += 800) {
      const p = place(crop, { x: 0, y }, scale, f, out)!;
      expect(p.dy).toBeLessThanOrEqual(previousBottom);
      previousBottom = p.dy + p.height;
    }
  });
});

describe('tileGrid', () => {
  it('is a single tile for an ordinary page', () => {
    expect(tileGrid({ width: 2560, height: 9000 })).toEqual([{ x: 0, y: 0, width: 2560, height: 9000 }]);
  });

  it('splits a tall page into stacked tiles no taller than the limit', () => {
    const tiles = tileGrid({ width: 2560, height: 40000 });
    expect(tiles.map((t) => [t.y, t.height])).toEqual([
      [0, MAX_TILE_SIDE],
      [MAX_TILE_SIDE, MAX_TILE_SIDE],
      [MAX_TILE_SIDE * 2, 40000 - MAX_TILE_SIDE * 2],
    ]);
  });

  it('splits horizontally too', () => {
    const tiles = tileGrid({ width: 20, height: 10 }, 8);
    expect(tiles).toHaveLength(6);
    expect(tiles[2]).toEqual({ x: 16, y: 0, width: 4, height: 8 });
  });
});

describe('splitAcrossTiles', () => {
  const tiles = tileGrid({ width: 100, height: 300 }, 100);

  it('keeps a frame inside one tile whole', () => {
    const p: Placement = { sx: 0, sy: 0, dx: 0, dy: 110, width: 100, height: 50 };
    expect(splitAcrossTiles(p, tiles)).toEqual([{ tile: 1, placement: { ...p, dy: 10 } }]);
  });

  it('divides a frame that straddles a boundary', () => {
    const p: Placement = { sx: 0, sy: 20, dx: 0, dy: 80, width: 100, height: 50 };
    expect(splitAcrossTiles(p, tiles)).toEqual([
      { tile: 0, placement: { sx: 0, sy: 20, dx: 0, dy: 80, width: 100, height: 20 } },
      { tile: 1, placement: { sx: 0, sy: 40, dx: 0, dy: 0, width: 100, height: 30 } },
    ]);
  });

  it('accounts for every row exactly once', () => {
    const p: Placement = { sx: 0, sy: 0, dx: 0, dy: 50, width: 100, height: 200 };
    const parts = splitAcrossTiles(p, tiles);
    expect(parts.reduce((n, part) => n + part.placement.height, 0)).toBe(200);
  });
});

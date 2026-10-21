import { MAX_PAGE_UNITS, buildPdf, paginate, pdfTextString } from './pdf';

const decode = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('paginate', () => {
  it('slices a tall image into A4 pages of equal size', () => {
    const pages = paginate(1000, 3000, 'a4');
    const sliceMax = Math.floor(841.89 / (595.28 / 1000));
    expect(pages).toHaveLength(Math.ceil(3000 / sliceMax));
    expect(pages.every((p) => p.pageWidth === 595.28 && p.pageHeight === 841.89)).toBe(true);
    expect(pages.reduce((n, p) => n + p.sliceHeight, 0)).toBe(3000);
    expect(pages.at(-1)!.drawHeight).toBeLessThan(841.89);
  });

  it('uses Letter dimensions', () => {
    expect(paginate(612, 100, 'letter')[0]).toMatchObject({ pageWidth: 612, pageHeight: 792, drawHeight: 100 });
  });

  it('fits a page to its content and splits only at the PDF size limit', () => {
    const single = paginate(1280, 4000, 'fit');
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ pageWidth: 960, pageHeight: 3000, drawHeight: 3000 });

    const tall = paginate(1280, 40000, 'fit');
    expect(tall.length).toBeGreaterThan(1);
    expect(Math.max(...tall.map((p) => p.pageHeight))).toBeLessThanOrEqual(MAX_PAGE_UNITS);
  });

  it('scales very wide images down to the page limit', () => {
    const [page] = paginate(40000, 100, 'fit');
    expect(page!.pageWidth).toBeCloseTo(MAX_PAGE_UNITS);
  });

  it('returns nothing for an empty image', () => {
    expect(paginate(0, 100, 'a4')).toEqual([]);
  });
});

describe('pdfTextString', () => {
  it('encodes as UTF-16BE hex with a byte-order mark', () => {
    expect(pdfTextString('A(é)')).toBe('<FEFF0041002800E90029>');
  });
});

describe('buildPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const page = { jpeg, width: 10, height: 20, pageWidth: 100, pageHeight: 200, drawHeight: 150 };

  it('produces a structurally valid file', () => {
    const pdf = buildPdf([page, page], 'Title');
    const text = decode(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Filter /DCTDecode /Length 4');
    // Image anchored to the top of the page.
    expect(text).toContain('q 100 0 0 150 0 50 cm /Im0 Do Q');
  });

  it('writes an xref table whose offsets point at the objects', () => {
    const pdf = buildPdf([page], 'x');
    const text = decode(pdf);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, i) => {
      expect(text.startsWith(`${i + 1} 0 obj\n`, offset)).toBe(true);
    });
  });

  it('embeds the JPEG bytes unchanged', () => {
    const pdf = buildPdf([page]);
    const at = decode(pdf).indexOf('stream\n\xff\xd8');
    expect(at).toBeGreaterThan(0);
  });
});

/* A minimal PDF writer: one JPEG image per page, nothing else.
 *
 * Written here instead of pulling in a PDF library because the job is small
 * and fixed. PDF can embed a JPEG byte-for-byte (the DCTDecode filter), so a
 * page is an image object, a four-operator content stream and a page
 * dictionary. A general-purpose library would add a few hundred KB of
 * unreviewed code to an extension whose bundle is meant to be read.
 */

export type Paper = 'a4' | 'letter' | 'fit';

/* Points (1/72 in). */
const PAPER_SIZES: Record<Exclude<Paper, 'fit'>, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/* PDF 1.x limits a page side to 14,400 units (200 inches). Acrobat refuses to
   open larger pages, and other viewers clamp them inconsistently. */
export const MAX_PAGE_UNITS = 14400;

/* One device pixel at 96 dpi, in points. */
const PX_TO_PT = 72 / 96;

export interface PageSlice {
  /* Rows of the source image this page shows, in image px. */
  sliceY: number;
  sliceHeight: number;
  /* Page size and the height the slice is drawn at, in points. */
  pageWidth: number;
  pageHeight: number;
  drawHeight: number;
}

/* Cuts an image into page-sized horizontal slices.
 *
 * Paper sizes scale the image to the page width and keep every page the same
 * size, so the last page has blank space under it and the document prints
 * cleanly. "fit" keeps the image at 96 dpi and makes each page exactly as tall
 * as its slice, splitting only where the PDF page limit forces it. */
export function paginate(imageWidth: number, imageHeight: number, paper: Paper): PageSlice[] {
  if (imageWidth <= 0 || imageHeight <= 0) return [];

  let pageWidth: number;
  let pageHeight: number | null;
  let scale: number;
  if (paper === 'fit') {
    scale = Math.min(PX_TO_PT, MAX_PAGE_UNITS / imageWidth);
    pageWidth = imageWidth * scale;
    pageHeight = null;
  } else {
    const size = PAPER_SIZES[paper];
    pageWidth = size.width;
    pageHeight = size.height;
    scale = size.width / imageWidth;
  }

  const sliceMax = Math.max(1, Math.floor((pageHeight ?? MAX_PAGE_UNITS) / scale));
  const pages: PageSlice[] = [];
  for (let y = 0; y < imageHeight; y += sliceMax) {
    const sliceHeight = Math.min(sliceMax, imageHeight - y);
    const drawHeight = sliceHeight * scale;
    pages.push({ sliceY: y, sliceHeight, pageWidth, pageHeight: pageHeight ?? drawHeight, drawHeight });
  }
  return pages;
}

export interface PdfPage {
  jpeg: Uint8Array;
  /* Pixel size of the JPEG. */
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  drawHeight: number;
}

const num = (n: number) => {
  const s = n.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

/* Text strings as UTF-16BE hex with a byte-order mark: the only encoding that
   carries an arbitrary page title without escaping rules for parentheses,
   backslashes and non-Latin scripts. */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

export function buildPdf(pages: readonly PdfPage[], title = ''): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    body();
    write('\nendobj\n');
  };

  // Object ids: 1 catalog, 2 page tree, 3 info, then three per page.
  const pageIds = pages.map((_, i) => 4 + i * 3);

  // The binary comment marks the file as binary for transfer tools that
  // sniff the first lines, as the PDF specification recommends.
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  object(1, () => write('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () =>
    write(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`),
  );
  object(3, () => write(`<< /Title ${pdfTextString(title)} /Producer ${pdfTextString('Pagesmith')} >>`));

  pages.forEach((page, i) => {
    const pageId = pageIds[i]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const y = page.pageHeight - page.drawHeight;
    const content = `q ${num(page.pageWidth)} 0 0 ${num(page.drawHeight)} 0 ${num(y)} cm /Im0 Do Q`;

    object(pageId, () =>
      write(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.pageWidth)} ${num(page.pageHeight)}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    object(contentId, () => {
      write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    object(imageId, () => {
      write(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      write(page.jpeg);
      write('\nendstream');
    });
  });

  const objectCount = 4 + pages.length * 3;
  const xref = length;
  write(`xref\n0 ${objectCount}\n0000000000 65535 f \n`);
  for (let id = 1; id < objectCount; id++) {
    write(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

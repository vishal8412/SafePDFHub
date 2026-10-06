import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export function normalizePdfFontName(name: string): string {
  return name.replace(/^\//, '').replace(/^[A-Z]{6}\+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Page resources can inherit fonts or place them inside nested Form XObjects.
 * Keep the exact face name: Medium, Italic and Bold are different programs. */
export interface PdfFontMetrics { ascent: number; descent: number; }

export function collectPageFontPrograms(pdf: PDFDocument, pageIndex: number, metrics?: Map<string, PdfFontMetrics>): Map<string, Uint8Array> {
  const programs = new Map<string, Uint8Array>();
  const visited = new Set<PDFDict>();
  const visit = (resources: PDFDict | undefined): void => {
    if (!resources || visited.has(resources)) return;
    visited.add(resources);
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      try {
        const font = pdf.context.lookup(ref, PDFDict);
        const children = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
        const base = children ? children.lookup(0, PDFDict) : font;
        const descriptor = base.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
        const name = String(font.get(PDFName.of('BaseFont')) ?? descriptor?.get(PDFName.of('FontName')) ?? '');
        const ascent = descriptor?.lookupMaybe(PDFName.of('Ascent'), PDFNumber)?.asNumber();
        const descent = descriptor?.lookupMaybe(PDFName.of('Descent'), PDFNumber)?.asNumber();
        if (typeof ascent === 'number' && typeof descent === 'number' && ascent > 0 && descent <= 0) {
          // PDF descriptors use thousandths of text space, independent of the
          // embedded program's unitsPerEm (notably stripped Chromium subsets).
          metrics?.set(normalizePdfFontName(name), {ascent: ascent / 1000, descent: descent / 1000});
        }
        for (const key of ['FontFile2', 'FontFile3', 'FontFile']) {
          const stream = pdf.context.lookup(descriptor?.get(PDFName.of(key)));
          if (stream instanceof PDFRawStream) {
            programs.set(normalizePdfFontName(name), decodePDFRawStream(stream).decode());
            break;
          }
        }
      } catch { /* An unsupported font must not discard other usable faces. */ }
    }
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      const stream = pdf.context.lookup(ref);
      if (stream instanceof PDFRawStream && String(stream.dict.get(PDFName.of('Subtype'))) === '/Form') {
        visit(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict));
      }
    }
  };
  visit(pdf.getPage(pageIndex).node.Resources());
  return programs;
}

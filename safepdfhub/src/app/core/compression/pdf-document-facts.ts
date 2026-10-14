import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

export interface PdfDocumentFacts {
  pages: Array<{ width: number; height: number; rotation: number }>;
  metadata: Array<string | undefined>;
}

/** Immutable File identity ties facts to the exact source read by our worker. */
const sourceFacts = new WeakMap<File, PdfDocumentFacts>();
export function rememberSourceFacts(file: File, facts: PdfDocumentFacts): void { sourceFacts.set(file, facts); }
export function sourceFactsFor(file: File): PdfDocumentFacts | undefined { return sourceFacts.get(file); }

export function captureDocumentFacts(pdf: PDFDocument): PdfDocumentFacts {
  return {
    pages: pdf.getPages().map(page => ({ width: page.getWidth(), height: page.getHeight(),
      rotation: ((page.getRotation().angle % 360) + 360) % 360 })),
    metadata: [pdf.getTitle(), pdf.getAuthor(), pdf.getSubject(), pdf.getCreator(), pdf.getProducer(),
      pdf.getKeywords(), metadataDate(pdf, 'CreationDate'), metadataDate(pdf, 'ModDate')],
  };
}

/** Scanner PDFs often contain empty or non-standard dates. Preserve their raw value. */
function metadataDate(pdf: PDFDocument, key: 'CreationDate' | 'ModDate'): string {
  try {
    const date = key === 'CreationDate' ? pdf.getCreationDate() : pdf.getModificationDate();
    return date?.toISOString() ?? '';
  } catch {
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
    return info instanceof PDFDict ? 'raw:' + String(info.get(PDFName.of(key)) ?? '') : '';
  }
}

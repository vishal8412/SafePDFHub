import { PDFDocument } from 'pdf-lib';

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
      pdf.getKeywords(), pdf.getCreationDate()?.toISOString() ?? '', pdf.getModificationDate()?.toISOString() ?? ''],
  };
}

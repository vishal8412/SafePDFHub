import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export interface StudioPdfDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  pageCount: number;
  /** File currently used for Studio export. Protected sources are decrypted locally first. */
  file: File;
  /** Original user-selected file, retained only for in-memory security actions. */
  sourceFile?: File;
  sourceWasProtected?: boolean;
  pdf: PDFDocumentProxy;
}
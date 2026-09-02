import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export interface StudioPdfDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  pageCount: number;
  file: File;
  pdf: PDFDocumentProxy;
}
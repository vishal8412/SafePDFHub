/**
 * V2.6 full-document certification result.
 *
 * Unlike the V2.5 sampled semantic guard, this result represents a complete
 * page-by-page semantic comparison of a candidate against the source PDF.
 */
export type PdfFinalIntegrityStatus = 'passed' | 'rejected';

export interface PdfFinalIntegrityPageResult {
  pageNumber: number;
  textMatched: boolean;
  annotationsMatched: boolean;
  sourceTextLength: number;
  candidateTextLength: number;
  sourceAnnotationCount: number;
  candidateAnnotationCount: number;
  passed: boolean;
}

export interface PdfFinalIntegrityResult {
  status: PdfFinalIntegrityStatus;
  pagesChecked: number;
  totalPages: number;
  metadataMatched: boolean;
  pageGeometryMatched: boolean;
  pageCountMatched: boolean;
  pages: PdfFinalIntegrityPageResult[];
  durationMs: number;
  reason: string | null;
}

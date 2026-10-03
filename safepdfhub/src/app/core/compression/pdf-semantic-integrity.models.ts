export type PdfSemanticIntegrityStatus = 'passed' | 'rejected' | 'skipped';

export interface PdfSemanticPageResult {
  pageNumber: number;
  sourceTextLength: number;
  candidateTextLength: number;
  sourceAnnotationCount: number;
  candidateAnnotationCount: number;
  sourceAnnotationSignature: string;
  candidateAnnotationSignature: string;
  textMatched: boolean;
  annotationsMatched: boolean;
  passed: boolean;
}

export interface PdfSemanticIntegrityResult {
  status: PdfSemanticIntegrityStatus;
  sampledPages: number[];
  pages: PdfSemanticPageResult[];
  metadataMatched: boolean;
  pageGeometryMatched: boolean;
  pageCountMatched: boolean;
  reason: string | null;
}

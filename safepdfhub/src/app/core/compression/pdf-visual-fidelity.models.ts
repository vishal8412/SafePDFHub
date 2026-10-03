export type PdfVisualFidelityStatus = 'passed' | 'rejected' | 'skipped';

export interface PdfVisualFidelityPageResult {
  pageNumber: number;
  meanAbsoluteError: number;
  changedPixelRatio: number;
  passed: boolean;
}

export interface PdfVisualFidelityResult {
  status: PdfVisualFidelityStatus;
  sampledPages: number[];
  pages: PdfVisualFidelityPageResult[];
  maxMeanAbsoluteError: number;
  maxChangedPixelRatio: number;
  meanAbsoluteError: number;
  thresholdMeanAbsoluteError: number;
  thresholdChangedPixelRatio: number;
  reason: string | null;
}

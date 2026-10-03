export type PdfContentType =
  | 'text'
  | 'scanned'
  | 'mixed';

export interface PdfAnalysis {
  type: PdfContentType;
  avgTextDensity: number;
  largePages: boolean;
  imageHeavy: boolean;
  imageRatio: number;
  imageCount: number;
  vectorOperatorCount: number;
  pagesAnalyzed: number;
}

export interface PdfFileAnalysis {
  type: PdfContentType;
  analysis: PdfAnalysis;
  pages: number;
  /** V2.1 forensic object/resource intelligence. Optional for backwards compatibility. */
  forensic?: import('./pdf-forensic.models').PdfForensicAnalysis;
}

export interface PageAnalysis {
  type: PdfContentType;
  textDensity: number;
  imageCount: number;
  vectorOperatorCount: number;
  estimatedImageArea: number;
  estimatedPhotoPage: boolean;
  shouldRasterize: boolean;
}

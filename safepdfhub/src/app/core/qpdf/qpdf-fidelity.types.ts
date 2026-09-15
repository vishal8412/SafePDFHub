export interface QpdfPageGeometry {
  width: number;
  height: number;
}

export interface QpdfOutputValidation {
  parseable: boolean;
  pageCount: number | null;
  pageGeometries: QpdfPageGeometry[];
  outputBytes: number;
  errorMessage?: string;
}

export interface QpdfSmokeComparison {
  pageCountMatch: boolean;
  pageGeometryMatch: boolean;
  qpdfOutputParseable: boolean;
  pdfLibOutputParseable: boolean;
  inputPageCount: number;
  qpdfPageCount: number | null;
  pdfLibPageCount: number | null;
}

export interface QpdfSmokeResult {
  status: 'passed' | 'failed';
  inputFileCount: number;
  inputBytes: number;
  inputPageCount: number;
  qpdfDurationMs: number | null;
  qpdfOutput: QpdfOutputValidation;
  pdfLibOutput: QpdfOutputValidation;
  comparison: QpdfSmokeComparison;
  errorMessage?: string;
}

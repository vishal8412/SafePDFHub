export type QpdfBenchmarkComplexity =
  | 'text-light'
  | 'font-heavy'
  | 'image-heavy'
  | 'scanned'
  | 'encrypted'
  | 'malformed'
  | 'mixed'
  | 'unknown';

export interface QpdfFidelityInspection {
  parseable: boolean;
  pageCount: number | null;
  pageGeometries: QpdfBenchmarkPageGeometry[];
  annotationCount: number | null;
  linkAnnotationCount: number | null;
  widgetAnnotationCount: number | null;
  outlineItemCount: number | null;
  fieldObjectCount: number | null;
  firstPageRenderSignature: string | null;
  errorMessage?: string;
}

export interface QpdfBenchmarkPageGeometry {
  width: number;
  height: number;
}

export interface QpdfBenchmarkMemoryTelemetry {
  supported: boolean;
  beforeBytes: number | null;
  peakBytes: number | null;
  afterBytes: number | null;
  deltaBytes: number | null;
}

export interface QpdfBenchmarkLongTaskTelemetry {
  supported: boolean;
  count: number;
  maxDurationMs: number | null;
}

export interface QpdfBenchmarkRun {
  engine: 'qpdf-wasm' | 'pdf-lib-worker';
  success: boolean;
  elapsedMs: number;
  throughputMiBPerSecond: number;
  pagesPerSecond: number | null;
  maxMainThreadGapMs: number;
  memory?: QpdfBenchmarkMemoryTelemetry;
  longTasks?: QpdfBenchmarkLongTaskTelemetry;
  outputBytes: number | null;
  outputPages: number | null;
  fidelity: QpdfFidelityInspection | null;
  errorMessage?: string;
}

export interface QpdfBenchmarkResult {
  inputFidelity: QpdfFidelityInspection | null;
  status: 'completed' | 'cancelled';
  complexity: QpdfBenchmarkComplexity;
  inputFileCount: number;
  inputBytes: number;
  inputPages: number | null;
  inputPageCountError?: string;
  qpdf: QpdfBenchmarkRun;
  pdfLibWorker: QpdfBenchmarkRun;
  qpdfPageCountPreserved: boolean | null;
  pdfLibPageCountPreserved: boolean | null;
  qpdfPageGeometryPreserved: boolean | null;
  pdfLibPageGeometryPreserved: boolean | null;
  qpdfAnnotationsPreserved: boolean | null;
  pdfLibAnnotationsPreserved: boolean | null;
  qpdfLinksPreserved: boolean | null;
  pdfLibLinksPreserved: boolean | null;
  qpdfWidgetsPreserved: boolean | null;
  pdfLibWidgetsPreserved: boolean | null;
  qpdfOutlinesPreserved: boolean | null;
  pdfLibOutlinesPreserved: boolean | null;
  qpdfFieldsPreserved: boolean | null;
  pdfLibFieldsPreserved: boolean | null;
  pageCountMatch: boolean | null;
  pageGeometryMatch: boolean | null;
  annotationsMatch: boolean | null;
  linksMatch: boolean | null;
  widgetsMatch: boolean | null;
  outlinesMatch: boolean | null;
  fieldsMatch: boolean | null;
  firstPageRenderMatch: boolean | null;
  outputSizeMatch: boolean | null;
  qpdfSpeedup: number | null;
  qpdfMainThreadGapReduction: number | null;
  errorMessage?: string;
}

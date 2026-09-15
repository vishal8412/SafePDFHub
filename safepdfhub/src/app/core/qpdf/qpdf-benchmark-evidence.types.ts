import type { QpdfBenchmarkComplexity, QpdfBenchmarkResult } from './qpdf-benchmark.types';

export type QpdfEvidenceDeviceClass =
  | 'mobile'
  | 'tablet'
  | 'desktop-standard'
  | 'desktop-high-end'
  | 'unknown';

export interface QpdfBenchmarkEvidenceRecord {
  id: string;
  recordedAt: string;
  deviceClass: QpdfEvidenceDeviceClass;
  deviceMemoryGiB: number | null;
  hardwareConcurrency: number | null;
  complexity: QpdfBenchmarkComplexity;
  inputFileCount: number;
  inputBytes: number;
  inputPages: number | null;
  qpdfSuccess: boolean;
  pdfLibWorkerSuccess: boolean;
  qpdfElapsedMs: number;
  pdfLibWorkerElapsedMs: number;
  qpdfSpeedup: number | null;
  qpdfMainThreadGapReduction: number | null;
  pageCountMatch: boolean | null;
  pageGeometryMatch: boolean | null;
  annotationsMatch: boolean | null;
  linksMatch: boolean | null;
  widgetsMatch: boolean | null;
  outlinesMatch: boolean | null;
  fieldsMatch: boolean | null;
  firstPageRenderMatch: boolean | null;
  report: QpdfBenchmarkResult;
}

export interface QpdfBenchmarkEvidenceSummary {
  recordCount: number;
  successfulRecordCount: number;
  complexityClasses: QpdfBenchmarkComplexity[];
  deviceClasses: QpdfEvidenceDeviceClass[];
  totalInputBytes: number;
  totalInputPages: number;
  note: string;
  memoryTelemetryRecordCount: number;
  longTaskTelemetryRecordCount: number;
  maxObservedQpdfLongTaskMs: number | null;
  maxObservedPdfLibLongTaskMs: number | null;
}

export interface QpdfBenchmarkEvidenceExport {
  schemaVersion: 1;
  exportedAt: string;
  records: QpdfBenchmarkEvidenceRecord[];
}

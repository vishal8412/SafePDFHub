import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord, QpdfEvidenceDeviceClass } from './qpdf-benchmark-evidence.types';

export type QpdfProductionGateStatus =
  | 'insufficient-evidence'
  | 'review-required'
  | 'blocked-by-failures'
  | 'fallback-review-ready'
  | 'primary-review-ready';

export interface QpdfProductionGateCriteria {
  minimumRecordsForFallbackReview: number;
  minimumDeviceClassesForFallbackReview: number;
  minimumComplexityClassesForFallbackReview: number;
  minimumRecordsForPrimaryReview: number;
  minimumDeviceClassesForPrimaryReview: number;
  minimumComplexityClassesForPrimaryReview: number;
  minimumMedianSpeedupForPrimaryReview: number;
  maximumAllowedQpdfMainThreadGapMs: number;
}

export interface QpdfProductionGateResult {
  status: QpdfProductionGateStatus;
  title: string;
  summary: string;
  criteria: QpdfProductionGateCriteria;
  recordCount: number;
  successfulRecordCount: number;
  failedQpdfRecordCount: number;
  failedPdfLibRecordCount: number;
  deviceClasses: QpdfEvidenceDeviceClass[];
  complexityClasses: QpdfBenchmarkComplexity[];
  medianQpdfSpeedup: number | null;
  medianQpdfMainThreadGapMs: number | null;
  medianPdfLibMainThreadGapMs: number | null;
  hardFidelityMismatchCount: number;
  missingAdvancedFidelityCount: number;
  memoryTelemetryRecordCount: number;
  longTaskTelemetryRecordCount: number;
  maxObservedQpdfLongTaskMs: number | null;
  maxObservedPdfLibLongTaskMs: number | null;
  blockers: string[];
  nextActions: string[];
}

export interface QpdfProductionGateEvaluationInput {
  records: readonly QpdfBenchmarkEvidenceRecord[];
}

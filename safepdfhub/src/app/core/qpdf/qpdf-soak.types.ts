import type { QpdfBenchmarkComplexity, QpdfBenchmarkResult } from './qpdf-benchmark.types';

export type QpdfSoakStatus = 'completed' | 'cancelled' | 'failed';

export interface QpdfSoakIterationSummary {
  iteration: number;
  qpdfSuccess: boolean;
  pdfLibWorkerSuccess: boolean;
  qpdfElapsedMs: number;
  pdfLibWorkerElapsedMs: number;
  qpdfSpeedup: number | null;
  qpdfMainThreadGapMs: number;
  pdfLibMainThreadGapMs: number;
  pageCountMatch: boolean | null;
  pageGeometryMatch: boolean | null;
  hardFidelityPass: boolean;
  qpdfMemoryDeltaBytes: number | null;
  pdfLibMemoryDeltaBytes: number | null;
  qpdfLongTaskMaxMs: number | null;
  pdfLibLongTaskMaxMs: number | null;
}

export interface QpdfSoakResult {
  status: QpdfSoakStatus;
  complexity: QpdfBenchmarkComplexity;
  requestedIterations: number;
  completedIterations: number;
  inputFileCount: number;
  inputBytes: number;
  inputPages: number | null;
  totalElapsedMs: number;
  qpdfSuccessCount: number;
  pdfLibWorkerSuccessCount: number;
  pairedSuccessCount: number;
  qpdfFailureCount: number;
  pdfLibWorkerFailureCount: number;
  fidelityMismatchCount: number;
  qpdfMedianElapsedMs: number | null;
  qpdfMedianSpeedup: number | null;
  qpdfFirstIterationElapsedMs: number | null;
  qpdfLastIterationElapsedMs: number | null;
  qpdfElapsedDriftRatio: number | null;
  qpdfMedianMainThreadGapMs: number | null;
  qpdfMaxMainThreadGapMs: number | null;
  qpdfMaxLongTaskMs: number | null;
  pdfLibMaxLongTaskMs: number | null;
  qpdfMemoryDeltaTrendBytes: number | null;
  pdfLibMemoryDeltaTrendBytes: number | null;
  iterations: QpdfSoakIterationSummary[];
  reports: QpdfBenchmarkResult[];
  stopReason?: string;
}

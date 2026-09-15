import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord } from './qpdf-benchmark-evidence.types';

export type QpdfRegressionStatus =
  | 'baseline-not-set'
  | 'no-new-evidence'
  | 'insufficient-comparison'
  | 'regression-detected'
  | 'stable'
  | 'improved';

export interface QpdfRegressionThresholds {
  minimumBaselineRecords: number;
  minimumCurrentRecords: number;
  maximumPositiveQpdfFailureRate: number;
  maximumFidelityMismatchRate: number;
  maximumMedianElapsedRegressionRatio: number;
  maximumMedianSpeedupRegressionRatio: number;
  maximumMedianMainThreadGapRegressionRatio: number;
  maximumLongTaskRegressionRatio: number;
  minimumComparableRecordsPerClass: number;
  memoryDeltaAdvisoryAbsoluteBytes: number;
}

export interface QpdfRegressionBaseline {
  schemaVersion: 1;
  capturedAt: string;
  recordIds: string[];
  recordCount: number;
  note: string;
}

export interface QpdfRegressionMetricComparison {
  name: string;
  baseline: number | null;
  current: number | null;
  changeRatio: number | null;
  thresholdRatio: number | null;
  direction: 'lower-is-better' | 'higher-is-better' | 'informational';
  status: 'pass' | 'regression' | 'improved' | 'insufficient' | 'informational';
}

export interface QpdfRegressionClassComparison {
  complexity: QpdfBenchmarkComplexity;
  baselineCount: number;
  currentCount: number;
  comparable: boolean;
  qpdfMedianElapsedMs: QpdfRegressionMetricComparison;
  qpdfMedianSpeedup: QpdfRegressionMetricComparison;
  qpdfMedianMainThreadGapMs: QpdfRegressionMetricComparison;
}

export interface QpdfRegressionAnalysis {
  status: QpdfRegressionStatus;
  title: string;
  summary: string;
  thresholds: QpdfRegressionThresholds;
  baseline: QpdfRegressionBaseline | null;
  baselineRecordCount: number;
  currentRecordCount: number;
  positiveBaselineRecordCount: number;
  positiveCurrentRecordCount: number;
  positiveQpdfFailureRateBaseline: number | null;
  positiveQpdfFailureRateCurrent: number | null;
  fidelityMismatchRateBaseline: number | null;
  fidelityMismatchRateCurrent: number | null;
  metrics: QpdfRegressionMetricComparison[];
  classComparisons: QpdfRegressionClassComparison[];
  regressions: string[];
  improvements: string[];
  advisories: string[];
  nextActions: string[];
}

export interface QpdfRegressionEvaluationInput {
  records: readonly QpdfBenchmarkEvidenceRecord[];
  baseline: QpdfRegressionBaseline | null;
}

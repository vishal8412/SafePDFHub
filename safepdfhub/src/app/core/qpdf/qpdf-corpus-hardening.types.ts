import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord, QpdfEvidenceDeviceClass } from './qpdf-benchmark-evidence.types';

export type QpdfCorpusHardeningStatus =
  | 'not-ready'
  | 'review-ready'
  | 'blocked';

export type QpdfCorpusHardeningRequirementKind =
  | 'positive-class'
  | 'negative-class'
  | 'device'
  | 'size-band'
  | 'page-band'
  | 'repeatability'
  | 'fidelity'
  | 'regression';

export interface QpdfCorpusHardeningRequirement {
  id: string;
  kind: QpdfCorpusHardeningRequirementKind;
  label: string;
  description: string;
  target: number;
  observed: number;
  covered: boolean;
  blocking: boolean;
  nextAction?: string;
}

export interface QpdfCorpusBandCoverage {
  id: string;
  label: string;
  observed: number;
  target: number;
  covered: boolean;
}

export interface QpdfCorpusWorkloadSignature {
  complexity: QpdfBenchmarkComplexity;
  inputFileCount: number;
  inputBytes: number;
  inputPages: number | null;
  repeatedRuns: number;
}

export interface QpdfCorpusHardeningResult {
  status: QpdfCorpusHardeningStatus;
  title: string;
  summary: string;
  totalRecords: number;
  positiveRecords: number;
  negativeRecords: number;
  positiveSuccessRate: number | null;
  positiveHardFidelityPassRate: number | null;
  requirements: QpdfCorpusHardeningRequirement[];
  workloadSignatures: QpdfCorpusWorkloadSignature[];
  repeatedWorkloadCount: number;
  largeWorkloadRecordCount: number;
  highPageCountRecordCount: number;
  veryHighPageCountRecordCount: number;
  sizeBandCoverage: QpdfCorpusBandCoverage[];
  pageBandCoverage: QpdfCorpusBandCoverage[];
  qpdfFailureCountOnPositiveCases: number;
  negativeCaseFailureCount: number;
  negativeCaseSuccessCount: number;
  advancedFidelityCompleteCount: number;
  nextActions: string[];
  privacyNote: string;
}

export interface QpdfCorpusHardeningEvaluationInput {
  records: readonly QpdfBenchmarkEvidenceRecord[];
}

export interface QpdfCorpusHardeningExport {
  schemaVersion: 1;
  exportedAt: string;
  result: QpdfCorpusHardeningResult;
  workloadSignatures: QpdfCorpusWorkloadSignature[];
  recordIds: string[];
  note: string;
}

export type QpdfCorpusHardeningDeviceClass = QpdfEvidenceDeviceClass;

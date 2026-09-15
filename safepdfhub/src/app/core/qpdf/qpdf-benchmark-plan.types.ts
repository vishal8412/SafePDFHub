import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord, QpdfEvidenceDeviceClass } from './qpdf-benchmark-evidence.types';

export type QpdfBenchmarkPlanPriority = 'required' | 'recommended';

export interface QpdfBenchmarkPlanItem {
  id: string;
  label: string;
  description: string;
  complexity: QpdfBenchmarkComplexity;
  minimumRuns: number;
  priority: QpdfBenchmarkPlanPriority;
}

export interface QpdfBenchmarkPlanDeviceItem {
  deviceClass: QpdfEvidenceDeviceClass;
  label: string;
  minimumRuns: number;
  priority: QpdfBenchmarkPlanPriority;
}

export interface QpdfBenchmarkPlanResult {
  totalRecordTarget: number;
  totalRecordCount: number;
  requiredRecordCount: number;
  requiredRecordTarget: number;
  coveragePercent: number;
  items: QpdfBenchmarkPlanCoverage[];
  devices: QpdfBenchmarkPlanDeviceCoverage[];
  nextActions: string[];
  note: string;
}

export interface QpdfBenchmarkPlanCoverage extends QpdfBenchmarkPlanItem {
  observedRuns: number;
  remainingRuns: number;
  covered: boolean;
}

export interface QpdfBenchmarkPlanDeviceCoverage extends QpdfBenchmarkPlanDeviceItem {
  observedRuns: number;
  remainingRuns: number;
  covered: boolean;
}

export interface QpdfBenchmarkPlanEvaluationInput {
  records: readonly QpdfBenchmarkEvidenceRecord[];
}

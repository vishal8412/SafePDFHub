export type MergeBenchmarkExecutionMode = 'main' | 'worker';
export type MergeBenchmarkComplexity =
  | 'text-light'
  | 'font-heavy'
  | 'image-heavy'
  | 'scanned'
  | 'encrypted'
  | 'malformed'
  | 'mixed'
  | 'unknown';

export interface MergeBenchmarkCase {
  id: string;
  label: string;
  files: File[];
  pageCounts?: readonly number[];
  complexity?: MergeBenchmarkComplexity;
}

export interface MergeBenchmarkRun {
  caseId: string;
  caseLabel: string;
  executionMode: MergeBenchmarkExecutionMode;
  inputBytes: number;
  inputPages: number | null;
  outputBytes: number | null;
  outputPages: number | null;
  elapsedMs: number;
  throughputMiBPerSecond: number;
  pagesPerSecond: number | null;
  maxMainThreadGapMs: number;
  workerSupported: boolean;
  success: boolean;
  errorMessage?: string;
  complexity: MergeBenchmarkComplexity;
}

export interface MergeBenchmarkComparison {
  caseId: string;
  caseLabel: string;
  main?: MergeBenchmarkRun;
  worker?: MergeBenchmarkRun;
  workerSpeedup?: number;
  workerMainThreadGapReduction?: number;
  outputEquivalent?: boolean;
}

export interface MergeBenchmarkReport {
  startedAt: string;
  completedAt: string;
  userAgent: string;
  deviceMemoryGiB: number | null;
  hardwareConcurrency: number | null;
  currentBudget: {
    maxFileBytes: number;
    maxTotalBytes: number;
    maxFiles: number;
    maxPages: number;
  };
  comparisons: MergeBenchmarkComparison[];
  capacityPromotionEligible: boolean;
  capacityDecision: 'retain-current-ceiling' | 'insufficient-evidence';
  decisionReason: string;
}

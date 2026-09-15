export type DeviceMemoryClass = 'unknown' | '2gb' | '4gb' | '8gb' | '16gb' | '32gb-plus';
export type DeviceFormFactor = 'mobile' | 'tablet' | 'desktop' | 'unknown';
export type ProcessingCapacityTier = 'conservative' | 'standard' | 'high' | 'maximum';
export type WorkloadRisk = 'safe' | 'large' | 'high-risk' | 'blocked';

export interface ProcessingBudget {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxPages: number;
  largeWorkloadBytes: number;
  largeWorkloadPages: number;
}

export interface LocalProcessingCapability {
  memoryClass: DeviceMemoryClass;
  memoryGiB: number | null;
  hardwareConcurrency: number | null;
  formFactor: DeviceFormFactor;
  tier: ProcessingCapacityTier;
  browserSupportsDeviceMemory: boolean;
  benchmarkPending: boolean;
  budget: ProcessingBudget;
}

export interface PdfWorkload {
  fileCount: number;
  totalBytes: number;
  maxFileBytes: number;
  totalPages: number | null;
  maxPages: number | null;
  knownPageCount: boolean;
}

export interface WorkloadAssessment {
  risk: WorkloadRisk;
  score: number;
  reasons: string[];
  workload: PdfWorkload;
  budget: ProcessingBudget;
}

export interface FileValidationResult {
  valid: boolean;
  code: 'ok' | 'invalid-type' | 'duplicate' | 'file-too-large' | 'total-too-large' | 'too-many-files';
  message?: string;
}

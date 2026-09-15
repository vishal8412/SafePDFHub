export type QpdfControlledFallbackOutcome =
  | 'qpdf-success'
  | 'pdf-lib-fallback'
  | 'failed'
  | 'cancelled';

export interface QpdfControlledFallbackPilotOptions {
  /** Must be explicitly true. This service is intentionally opt-in. */
  enabled: boolean;
  /** Preserve the current production Worker engine as the fallback. */
  usePdfLibWorkerFallback?: boolean;
  onProgress?: (progress: number, message: string) => void;
}

export interface QpdfControlledFallbackPilotResult {
  outcome: QpdfControlledFallbackOutcome;
  qpdfAttempted: boolean;
  qpdfSucceeded: boolean;
  fallbackUsed: boolean;
  inputFileCount: number;
  inputBytes: number;
  inputPageCount: number;
  outputBytes: number | null;
  outputPageCount: number | null;
  hardFidelityPassed: boolean | null;
  qpdfFailureReason?: string;
  fallbackFailureReason?: string;
  elapsedMs: number;
}

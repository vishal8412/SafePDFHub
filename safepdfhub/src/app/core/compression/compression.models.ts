import { CompressionExecutionTelemetry } from './compression-telemetry.models';

export interface CompressionResult {
  processingNote?: string;
  targetBytes?: number;
  targetMet?: boolean;
  /** The file selected for the user after candidate comparison. */
  file: File;
  /** Authoritative input size in bytes. */
  originalSize: number;
  /** Authoritative selected-output size in bytes. */
  finalSize: number;
  /** Actual byte reduction. Never derived from the planner estimate. */
  reductionBytes: number;
  /** Actual percentage reduction, rounded to the nearest whole percent. */
  reduction: number;
  /** Human-readable processing duration. */
  duration: string;
  /** Processing duration in milliseconds. */
  durationMs: number;
  /** Compression policy used for this execution. */
  strategy: 'safe' | 'smart' | 'strong';
  /** True when the source File itself was retained because no smaller valid candidate won. */
  returnedOriginal: boolean;
  /** Total pages known from the cached PDF analysis. */
  pagesTotal: number;
  /** V2.8 execution telemetry; contains sizes/timings only, never PDF bytes. */
  telemetry?: CompressionExecutionTelemetry;
}

export interface CompressionEstimate {
  /** Planner-only estimate. This is never the serialized output size. */
  estimatedReduction: number;
  /** Planner-only estimated final size in MiB. */
  estimatedFinalSize: number;
}

export interface CompressionAnalysis {
  avgTextDensity: number;
  largePages: boolean;
  imageHeavy: boolean;
  imageRatio: number;
  imageCount: number;
  vectorOperatorCount: number;
  pagesAnalyzed: number;
}

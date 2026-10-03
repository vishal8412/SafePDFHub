import type { PdfQpdfAttemptDecision, PdfStructuralCandidateDiagnostic } from './pdf-structural-optimization.models';
export type CompressionCandidateStage = 'structural' | 'image' | 'strategy';

export type CompressionCandidateCertification =
  | 'passed'
  | 'rejected'
  | 'duplicate-skipped'
  | 'not-certified';

export interface CompressionCandidateTelemetry {
  stage: CompressionCandidateStage;
  label: string;
  inputBytes: number;
  outputBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  generated: boolean;
  structurallyValid: boolean | null;
  certification: CompressionCandidateCertification;
  /** Privacy-safe final-integrity certification reason; never contains PDF content. */
  certificationReason?: string | null;
  /** Privacy-safe final-integrity certification counters for the candidate. */
  certificationPagesChecked?: number;
  certificationTotalPages?: number;
  durationMs: number;
  /** SHA-256 candidate identity; never contains PDF bytes. */
  candidateFingerprint?: string;
  /** SHA-256 identity of the candidate this stage consumed; never contains PDF bytes. */
  parentFingerprint?: string;
}

export interface CompressionCertificationTelemetry {
  candidatesConsidered: number;
  uniqueCandidatesCertified: number;
  cacheHits: number;
  duplicateCandidatesSkipped: number;
  durationMs: number;
}

export type CompressionFinalDecision = 'certified-candidate' | 'original-fallback';

export interface CompressionStructuralStageLifecycle {
  entered: boolean;
  completed: boolean;
  decisionReason: PdfQpdfAttemptDecision['reason'];
}

export interface CompressionExecutionTelemetry {
  version: 1;
  originalBytes: number;
  finalBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  totalDurationMs: number;
  returnedOriginal: boolean;
  selectedStage: CompressionCandidateStage | null;
  selectedLabel: string | null;
  finalDecision: CompressionFinalDecision;
  finalDecisionReason: string | null;
  structuralStage: CompressionStructuralStageLifecycle;
  candidates: CompressionCandidateTelemetry[];
  certification: CompressionCertificationTelemetry;
  /** Privacy-safe structural candidate diagnostics; never contains PDF bytes or raw qpdf stderr. */
  structuralDiagnostics?: PdfStructuralCandidateDiagnostic[];
  /** Explicit reason for whether the structural qpdf stage was attempted or skipped. */
  structuralQpdfAttemptDecision?: PdfQpdfAttemptDecision;
}

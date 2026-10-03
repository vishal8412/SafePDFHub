import { PdfSemanticIntegrityResult } from './pdf-semantic-integrity.models';

export type PdfStructuralFailureReason =
  | 'QPDF_EXECUTION_FAILED'
  | 'QPDF_RUNNER_CREATE_FAILED'
  | 'QPDF_RUN_FAILED'
  | 'QPDF_MEMORY_EXHAUSTED'
  | 'QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD'
  | 'QPDF_NO_OUTPUT'
  | 'PARSE_FAILED'
  | 'PAGE_COUNT_MISMATCH'
  | 'PAGE_GEOMETRY_MISMATCH'
  | 'PAGE_ROTATION_MISMATCH'
  | 'SEMANTIC_INTEGRITY_FAILED'
  | 'CANDIDATE_NOT_SMALLER'
  | 'EMPTY_OUTPUT'
  | 'CANCELLED'
  | 'UNKNOWN';

export type PdfQpdfResourceSignalStatus = 'measured' | 'measured-zero' | 'unavailable';

export type PdfQpdfAttemptDecisionState = 'attempted' | 'guard-blocked' | 'not-attempted';

export type PdfQpdfAttemptDecisionReason =
  | 'QPDF_ATTEMPTED'
  | 'RESOURCE_GUARD_BLOCKED'
  | 'NO_STRUCTURAL_CANDIDATES_SELECTED'
  | 'STRUCTURAL_STAGE_NOT_ENTERED'
  | 'ALREADY_COMPRESSED_FAST_PATH';

export interface PdfQpdfAttemptDecision {
  scope: 'structural';
  state: PdfQpdfAttemptDecisionState;
  reason: PdfQpdfAttemptDecisionReason;
  attemptedKinds: PdfStructuralCandidateKind[];
  skippedKinds: PdfStructuralCandidateKind[];
}

export interface PdfQpdfResourceSignals {
  fileBytes: number;
  pages: number;
  streamBytes: number;
  imageBytes: number;
  objectCount: number;
}

/**
 * Provenance for the privacy-safe resource-guard inputs.
 *
 * A numeric zero is never used to imply that a signal was unavailable: a
 * measured zero is represented explicitly as `measured-zero`.
 */
export interface PdfQpdfResourceSignalProvenance {
  source: 'forensic-analyzer' | 'input-metadata';
  partial: boolean | null;
  fileBytes: PdfQpdfResourceSignalStatus;
  pages: PdfQpdfResourceSignalStatus;
  streamBytes: PdfQpdfResourceSignalStatus;
  imageBytes: PdfQpdfResourceSignalStatus;
  objectCount: PdfQpdfResourceSignalStatus;
}

export interface PdfStructuralCandidateDiagnostic {
  kind: PdfStructuralCandidateKind;
  status: 'generated' | 'rejected' | 'failed';
  reason?: PdfStructuralFailureReason;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  qpdfExitCode?: number | null;
  qpdfOk?: boolean;
  qpdfErrorCount?: number;
  qpdfWarningCount?: number;
  runtimeErrorPhase?: 'runner-create' | 'runner-run' | 'runner-destroy';
  runtimeErrorName?: string;
  runtimeErrorMessage?: string;
  resourceRisk?: 'low' | 'elevated' | 'high' | 'unknown';
  optimizationProfile?: 'standard' | 'conservative';
  guardMessage?: string | null;
  /** Privacy-safe inputs used by the qpdf resource guard; never contains PDF content. */
  resourceSignals?: PdfQpdfResourceSignals;
  /** Provenance for every resource signal; never contains PDF content. */
  resourceSignalProvenance?: PdfQpdfResourceSignalProvenance;
}

export type PdfStructuralCandidateKind =
  | 'baseline'
  | 'resource-prune'
  | 'content-coalesce'
  | 'resource-prune-and-coalesce'
  | 'image-resource';

export interface PdfStructuralCandidate {
  kind: PdfStructuralCandidateKind;
  file: File;
  inputBytes: number;
  outputBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  valid: boolean;
  semanticIntegrity: PdfSemanticIntegrityResult | null;
  durationMs: number;
}

export interface PdfStructuralOptimizationResult {
  inputBytes: number;
  selected: PdfStructuralCandidate | null;
  candidates: PdfStructuralCandidate[];
  attemptedKinds: PdfStructuralCandidateKind[];
  skippedKinds: PdfStructuralCandidateKind[];
  forensicDriven: boolean;
  qpdfAttemptDecision?: PdfQpdfAttemptDecision;
  diagnostics: PdfStructuralCandidateDiagnostic[];
}

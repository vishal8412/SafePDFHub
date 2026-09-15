export type QpdfProductionPilotBlockReason =
  | 'disabled'
  | 'kill-switch'
  | 'approval-required'
  | 'rollout-not-selected'
  | 'capacity-exceeded';

export interface QpdfProductionPilotConfig {
  /** Hard safety switch. Production default is disabled. */
  enabled: boolean;
  /** When true, no qpdf pilot attempt is permitted. */
  killSwitch: boolean;
  /** Percentage of eligible sessions allowed into the pilot. */
  rolloutPercent: number;
  /** Human approval must be explicitly recorded before enabling. */
  humanApprovalRecorded: boolean;
  /** Maximum input bytes permitted for a pilot attempt. */
  maxTotalBytes: number;
  /** Maximum number of input PDFs permitted for a pilot attempt. */
  maxFiles: number;
}

export interface QpdfProductionPilotEligibility {
  allowed: boolean;
  reason?: QpdfProductionPilotBlockReason;
  sessionBucket: number;
  config: QpdfProductionPilotConfig;
}

export type QpdfProductionPilotEventOutcome =
  | 'qpdf-success'
  | 'pdf-lib-fallback'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface QpdfProductionPilotTelemetryEvent {
  schemaVersion: 1;
  recordedAt: string;
  outcome: QpdfProductionPilotEventOutcome;
  inputFileCount: number;
  inputBytes: number;
  inputPageCount: number | null;
  qpdfAttempted: boolean;
  qpdfSucceeded: boolean;
  fallbackUsed: boolean;
  hardFidelityPassed: boolean | null;
  elapsedMs: number | null;
  failureCode?: string;
  note?: string;
}

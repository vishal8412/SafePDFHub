import type {
  QpdfProductionPilotBlockReason,
  QpdfProductionPilotConfig,
  QpdfProductionPilotTelemetryEvent
} from './qpdf-production-pilot.types';

export interface QpdfProductionPilotObservabilitySnapshot {
  schemaVersion: 1;
  generatedAt: string;
  totalEvents: number;
  qpdfSuccessCount: number;
  fallbackCount: number;
  failedCount: number;
  cancelledCount: number;
  blockedCount: number;
  qpdfAttemptCount: number;
  qpdfSuccessRate: number | null;
  fallbackRateAmongAttempts: number | null;
  hardFidelityFailureCount: number;
  failureCodes: Record<string, number>;
  lastEventAt: string | null;
}

export type QpdfProductionPilotKillSwitchCheckId =
  | 'default-fail-closed'
  | 'kill-switch-dominates'
  | 'approval-required'
  | 'capacity-envelope'
  | 'rollout-zero-blocks';

export interface QpdfProductionPilotKillSwitchCheck {
  id: QpdfProductionPilotKillSwitchCheckId;
  label: string;
  passed: boolean;
  expected: string;
  observed: string;
}

export interface QpdfProductionPilotKillSwitchValidation {
  schemaVersion: 1;
  generatedAt: string;
  passed: boolean;
  checks: QpdfProductionPilotKillSwitchCheck[];
  baselineConfig: QpdfProductionPilotConfig;
  safetyNote: string;
}

export interface QpdfProductionPilotControlProbe {
  allowed: boolean;
  reason?: QpdfProductionPilotBlockReason;
  sessionBucket: number;
}

export interface QpdfProductionPilotObservabilityExport {
  schemaVersion: 1;
  exportedAt: string;
  snapshot: QpdfProductionPilotObservabilitySnapshot;
  killSwitchValidation: QpdfProductionPilotKillSwitchValidation;
  config: QpdfProductionPilotConfig;
  events: QpdfProductionPilotTelemetryEvent[];
  privacyNote: string;
}

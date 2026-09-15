import type { QpdfProductionPilotConfig } from './qpdf-production-pilot.types';

export type QpdfProductionRoutingValidationScenario =
  | 'default-blocked'
  | 'kill-switch-blocked'
  | 'capacity-blocked'
  | 'eligible-qpdf'
  | 'qpdf-failure-fallback';

export type QpdfProductionRoutingObservedOutcome =
  | 'pdf-lib-worker'
  | 'qpdf-success'
  | 'pdf-lib-fallback'
  | 'cancelled'
  | 'failed';

export interface QpdfProductionRoutingValidationResult {
  schemaVersion: 1;
  scenario: QpdfProductionRoutingValidationScenario;
  label: string;
  passed: boolean;
  expected: string;
  observed: string;
  eligibilityAllowed: boolean;
  eligibilityReason: string | null;
  qpdfAttempted: boolean;
  fallbackUsed: boolean;
  outcome: QpdfProductionRoutingObservedOutcome;
  elapsedMs: number | null;
  note?: string;
}

export interface QpdfProductionRoutingValidationReport {
  schemaVersion: 1;
  generatedAt: string;
  passed: boolean;
  results: QpdfProductionRoutingValidationResult[];
  config: QpdfProductionPilotConfig;
  safetyNote: string;
}

import type { QpdfFinalDecisionResult } from './qpdf-final-decision.types';
import type { QpdfProductionPilotConfig } from './qpdf-production-pilot.types';

export type QpdfPhase0dFinalStatus =
  | 'prototype-only'
  | 'blocked'
  | 'fallback-candidate'
  | 'primary-experiment-candidate';

export interface QpdfPhase0dGuardCheck {
  id: string;
  label: string;
  passed: boolean;
  observed: string;
  required: string;
}

export interface QpdfPhase0dFinalReport {
  schemaVersion: 1;
  generatedAt: string;
  status: QpdfPhase0dFinalStatus;
  title: string;
  summary: string;
  decisionStatus: QpdfFinalDecisionResult['status'];
  evidenceRecordCount: number;
  productionPilotConfig: QpdfProductionPilotConfig;
  guards: QpdfPhase0dGuardCheck[];
  productionChangesAuthorized: false;
  capacityChangesAuthorized: false;
  privacyBoundaryChangesAuthorized: false;
  humanApprovalRequired: true;
  nextStep: string;
}

export interface QpdfPhase0dFinalExport {
  schemaVersion: 1;
  exportedAt: string;
  report: QpdfPhase0dFinalReport;
  note: string;
}

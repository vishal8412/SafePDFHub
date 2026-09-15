import type { QpdfProductionGateResult } from './qpdf-production-gate.types';
import type { QpdfCorpusHardeningResult } from './qpdf-corpus-hardening.types';

export type QpdfFinalDecisionStatus =
  | 'prototype-only'
  | 'blocked'
  | 'fallback-pilot-candidate'
  | 'primary-experiment-candidate';

export interface QpdfFinalDecisionCriterion {
  id: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  observed: string;
  required: string;
  action?: string;
}

export interface QpdfFinalDecisionResult {
  status: QpdfFinalDecisionStatus;
  title: string;
  summary: string;
  recommendedProductionRole: 'prototype' | 'controlled-fallback-pilot' | 'primary-engine-experiment';
  criteria: QpdfFinalDecisionCriterion[];
  blockers: string[];
  nextActions: string[];
  productionChangesAuthorized: false;
  capacityChangesAuthorized: false;
  privacyBoundaryChangesAuthorized: false;
  requiresHumanApproval: true;
  evidenceRecordCount: number;
  productionGate: QpdfProductionGateResult['status'];
  corpusHardening: QpdfCorpusHardeningResult['status'];
  privacyNote: string;
}

export interface QpdfFinalDecisionEvaluationInput {
  productionGate: QpdfProductionGateResult;
  corpusHardening: QpdfCorpusHardeningResult;
}

export interface QpdfFinalDecisionExport {
  schemaVersion: 1;
  exportedAt: string;
  decision: QpdfFinalDecisionResult;
  note: string;
}

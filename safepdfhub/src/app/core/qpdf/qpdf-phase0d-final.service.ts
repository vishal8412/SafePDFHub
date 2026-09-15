import { Injectable } from '@angular/core';
import type { QpdfFinalDecisionResult } from './qpdf-final-decision.types';
import type { QpdfProductionPilotConfig } from './qpdf-production-pilot.types';
import type {
  QpdfPhase0dFinalExport,
  QpdfPhase0dFinalReport,
  QpdfPhase0dFinalStatus
} from './qpdf-phase0d-final.types';

@Injectable({ providedIn: 'root' })
export class QpdfPhase0dFinalService {
  evaluate(
    decision: QpdfFinalDecisionResult,
    pilotConfig: QpdfProductionPilotConfig
  ): QpdfPhase0dFinalReport {
    const guards = [
      {
        id: 'pilot-disabled-by-default',
        label: 'qpdf pilot is disabled by default',
        passed: pilotConfig.enabled === false,
        observed: pilotConfig.enabled ? 'enabled' : 'disabled',
        required: 'disabled'
      },
      {
        id: 'kill-switch-on-by-default',
        label: 'qpdf kill switch is active by default',
        passed: pilotConfig.killSwitch === true,
        observed: pilotConfig.killSwitch ? 'ON' : 'OFF',
        required: 'ON'
      },
      {
        id: 'zero-rollout-by-default',
        label: 'qpdf rollout is zero by default',
        passed: pilotConfig.rolloutPercent === 0,
        observed: `${pilotConfig.rolloutPercent}%`,
        required: '0%'
      },
      {
        id: 'human-approval-required',
        label: 'Human approval is not pre-authorized',
        passed: pilotConfig.humanApprovalRecorded === false,
        observed: pilotConfig.humanApprovalRecorded ? 'recorded' : 'not recorded',
        required: 'not recorded'
      },
      {
        id: 'production-changes-locked',
        label: 'Final decision cannot authorize production engine changes',
        passed: decision.productionChangesAuthorized === false,
        observed: decision.productionChangesAuthorized ? 'authorized' : 'locked',
        required: 'locked'
      },
      {
        id: 'capacity-changes-locked',
        label: 'Final decision cannot authorize capacity changes',
        passed: decision.capacityChangesAuthorized === false,
        observed: decision.capacityChangesAuthorized ? 'authorized' : 'locked',
        required: 'locked'
      },
      {
        id: 'privacy-boundary-locked',
        label: 'Final decision cannot authorize a privacy-boundary change',
        passed: decision.privacyBoundaryChangesAuthorized === false,
        observed: decision.privacyBoundaryChangesAuthorized ? 'authorized' : 'locked',
        required: 'locked'
      },
      {
        id: 'human-review-required',
        label: 'Human approval remains required',
        passed: decision.requiresHumanApproval === true,
        observed: decision.requiresHumanApproval ? 'required' : 'not required',
        required: 'required'
      }
    ];

    const status = this.mapStatus(decision.status);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status,
      title: 'Phase 0D consolidated engineering status',
      summary: decision.summary,
      decisionStatus: decision.status,
      evidenceRecordCount: decision.evidenceRecordCount,
      productionPilotConfig: { ...pilotConfig },
      guards,
      productionChangesAuthorized: false,
      capacityChangesAuthorized: false,
      privacyBoundaryChangesAuthorized: false,
      humanApprovalRequired: true,
      nextStep: this.nextStepFor(status)
    };
  }

  exportJson(report: QpdfPhase0dFinalReport): void {
    if (typeof window === 'undefined') return;

    const payload: QpdfPhase0dFinalExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      report,
      note: 'SafePDFHub Phase 0D consolidated engineering status. Metadata only; no PDF bytes or document content are included.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-phase0d-final-status-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private mapStatus(status: QpdfFinalDecisionResult['status']): QpdfPhase0dFinalStatus {
    switch (status) {
      case 'blocked':
        return 'blocked';
      case 'fallback-pilot-candidate':
        return 'fallback-candidate';
      case 'primary-experiment-candidate':
        return 'primary-experiment-candidate';
      default:
        return 'prototype-only';
    }
  }

  private nextStepFor(status: QpdfPhase0dFinalStatus): string {
    switch (status) {
      case 'blocked':
        return 'Resolve every blocking reliability or fidelity issue before any qpdf production use.';
      case 'fallback-candidate':
        return 'Only after human approval, use a tightly controlled, reversible fallback pilot with pdf-lib Worker retained as the safe fallback.';
      case 'primary-experiment-candidate':
        return 'Only after human approval, consider a reversible primary-engine experiment; do not automatically switch production.';
      default:
        return 'Continue evidence collection. Keep qpdf outside the production path.';
    }
  }

  private fileDateStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

import { Injectable } from '@angular/core';
import type {
  QpdfFinalDecisionCriterion,
  QpdfFinalDecisionEvaluationInput,
  QpdfFinalDecisionExport,
  QpdfFinalDecisionResult,
  QpdfFinalDecisionStatus
} from './qpdf-final-decision.types';

@Injectable({ providedIn: 'root' })
export class QpdfFinalDecisionService {
  evaluate(input: QpdfFinalDecisionEvaluationInput): QpdfFinalDecisionResult {
    const gate = input.productionGate;
    const corpus = input.corpusHardening;
    const criteria: QpdfFinalDecisionCriterion[] = [];
    const blockers: string[] = [];
    const nextActions: string[] = [];

    const corpusReady = corpus.status === 'review-ready';
    const noPositiveFailures = corpus.qpdfFailureCountOnPositiveCases === 0 && gate.failedQpdfRecordCount === 0;
    const noHardFidelityMismatch = corpus.positiveHardFidelityPassRate === null
      ? false
      : corpus.positiveHardFidelityPassRate === 1 && gate.hardFidelityMismatchCount === 0;
    const advancedFidelityComplete = corpus.positiveRecords > 0 &&
      corpus.advancedFidelityCompleteCount === corpus.positiveRecords &&
      gate.missingAdvancedFidelityCount === 0;
    const fallbackGateReady = gate.status === 'fallback-review-ready' || gate.status === 'primary-review-ready';
    const primaryGateReady = gate.status === 'primary-review-ready';

    criteria.push({
      id: 'corpus',
      label: 'Final corpus hardening',
      passed: corpusReady,
      blocking: true,
      observed: corpus.status,
      required: 'review-ready',
      action: corpusReady ? undefined : 'Complete the Phase 0D.14 corpus before any production-role decision.'
    });

    criteria.push({
      id: 'positive-failures',
      label: 'Positive-workload qpdf reliability',
      passed: noPositiveFailures,
      blocking: true,
      observed: `${corpus.qpdfFailureCountOnPositiveCases} corpus failure(s); ${gate.failedQpdfRecordCount} gate failure(s)`,
      required: '0 positive qpdf failures',
      action: noPositiveFailures ? undefined : 'Reproduce and resolve every positive-workload qpdf failure.'
    });

    criteria.push({
      id: 'fidelity',
      label: 'Hard fidelity',
      passed: noHardFidelityMismatch,
      blocking: true,
      observed: corpus.positiveHardFidelityPassRate === null
        ? 'No positive fidelity evidence'
        : `${(corpus.positiveHardFidelityPassRate * 100).toFixed(1)}% pass; ${gate.hardFidelityMismatchCount} mismatch(es)`,
      required: '100% positive hard-fidelity pass',
      action: noHardFidelityMismatch ? undefined : 'Investigate every page, geometry, annotation, link, widget, outline, field, and render mismatch.'
    });

    criteria.push({
      id: 'advanced-fidelity',
      label: 'Advanced fidelity evidence',
      passed: advancedFidelityComplete,
      blocking: true,
      observed: `${corpus.advancedFidelityCompleteCount} / ${corpus.positiveRecords} positive records complete`,
      required: 'All positive records complete',
      action: advancedFidelityComplete ? undefined : 'Collect complete advanced fidelity evidence before production review.'
    });

    criteria.push({
      id: 'fallback-gate',
      label: 'Fallback quantitative gate',
      passed: fallbackGateReady,
      blocking: true,
      observed: gate.status,
      required: 'fallback-review-ready or better',
      action: fallbackGateReady ? undefined : 'Meet the Phase 0D.9 fallback-review evidence thresholds.'
    });

    criteria.push({
      id: 'primary-gate',
      label: 'Primary-engine quantitative gate',
      passed: primaryGateReady,
      blocking: false,
      observed: gate.status,
      required: 'primary-review-ready',
      action: primaryGateReady ? undefined : 'Do not treat qpdf as a primary-engine candidate yet.'
    });

    if (!corpusReady) {
      blockers.push('Final corpus hardening is not review-ready.');
    }
    if (!noPositiveFailures) {
      blockers.push('Positive-workload qpdf failures remain unresolved.');
    }
    if (!noHardFidelityMismatch) {
      blockers.push('Hard fidelity evidence is not clean across the positive corpus.');
    }
    if (!advancedFidelityComplete) {
      blockers.push('Advanced fidelity evidence is incomplete.');
    }
    if (!fallbackGateReady) {
      blockers.push('The quantitative fallback gate is not review-ready.');
    }

    if (gate.failedPdfLibRecordCount > 0) {
      nextActions.push(`Review ${gate.failedPdfLibRecordCount} pdf-lib Worker failure(s) as comparator evidence; do not hide comparator instability.`);
    }

    if (corpus.negativeCaseSuccessCount > 0) {
      nextActions.push('Review every encrypted/malformed success individually before defining production failure semantics.');
    }

    nextActions.push('Keep qpdf behind an explicit feature flag or internal pilot until human approval is recorded.');
    nextActions.push('For any fallback pilot, preserve pdf-lib Worker as the safe fallback and define observable qpdf failure/cancellation behavior.');
    nextActions.push('Do not raise public file-size, total-size, or page-count limits based on this decision.');
    nextActions.push('Do not move PDF processing to SafePDFHub servers; the browser-only privacy boundary remains mandatory.');

    let status: QpdfFinalDecisionStatus;
    let title: string;
    let summary: string;
    let recommendedProductionRole: QpdfFinalDecisionResult['recommendedProductionRole'];

    if (blockers.length > 0) {
      status = blockers.some(blocker => blocker.includes('failure') || blocker.includes('fidelity'))
        ? 'blocked'
        : 'prototype-only';
      title = status === 'blocked'
        ? 'Do not promote qpdf — production decision blocked'
        : 'Keep qpdf as prototype — evidence is insufficient';
      summary = status === 'blocked'
        ? 'The current evidence contains a production-blocking reliability or fidelity issue. qpdf should remain outside the production merge path until the affected cases are reproduced and resolved.'
        : 'The final corpus or quantitative gate is not complete. The correct engineering decision is to keep qpdf as a prototype and continue evidence collection.';
      recommendedProductionRole = 'prototype';
    } else if (primaryGateReady) {
      status = 'primary-experiment-candidate';
      title = 'qpdf is a candidate for a controlled primary-engine experiment';
      summary = 'The final corpus and primary quantitative gate are satisfied. This justifies a tightly controlled experiment, not an automatic production-engine switch or capacity increase.';
      recommendedProductionRole = 'primary-engine-experiment';
    } else {
      status = 'fallback-pilot-candidate';
      title = 'qpdf is a candidate for a controlled fallback pilot';
      summary = 'The final corpus and fallback quantitative gate are satisfied, but the evidence does not justify treating qpdf as the primary production engine. A limited, observable fallback pilot is the conservative next step.';
      recommendedProductionRole = 'controlled-fallback-pilot';
    }

    return {
      status,
      title,
      summary,
      recommendedProductionRole,
      criteria,
      blockers,
      nextActions: this.unique(nextActions.concat(criteria.filter(item => item.action).map(item => item.action as string))),
      productionChangesAuthorized: false,
      capacityChangesAuthorized: false,
      privacyBoundaryChangesAuthorized: false,
      requiresHumanApproval: true,
      evidenceRecordCount: gate.recordCount,
      productionGate: gate.status,
      corpusHardening: corpus.status,
      privacyNote: 'This decision layer stores and exports benchmark metadata only. It does not upload, retain, or transmit PDF bytes, and it cannot authorize server-side PDF processing.'
    };
  }

  exportJson(decision: QpdfFinalDecisionResult): void {
    if (typeof window === 'undefined') return;

    const payload: QpdfFinalDecisionExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      decision,
      note: 'SafePDFHub qpdf final engineering decision. Evidence metadata only; PDF bytes are not included.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-qpdf-final-decision-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private unique(values: readonly string[]): string[] {
    return Array.from(new Set(values));
  }

  private fileDateStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

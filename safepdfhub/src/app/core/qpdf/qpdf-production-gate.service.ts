import { Injectable } from '@angular/core';
import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord } from './qpdf-benchmark-evidence.types';
import type {
  QpdfProductionGateCriteria,
  QpdfProductionGateEvaluationInput,
  QpdfProductionGateResult
} from './qpdf-production-gate.types';

const CRITERIA: QpdfProductionGateCriteria = {
  minimumRecordsForFallbackReview: 10,
  minimumDeviceClassesForFallbackReview: 2,
  minimumComplexityClassesForFallbackReview: 4,
  minimumRecordsForPrimaryReview: 20,
  minimumDeviceClassesForPrimaryReview: 3,
  minimumComplexityClassesForPrimaryReview: 6,
  minimumMedianSpeedupForPrimaryReview: 1.1,
  maximumAllowedQpdfMainThreadGapMs: 250
};

const PRIMARY_COMPLEXITIES: readonly QpdfBenchmarkComplexity[] = [
  'font-heavy',
  'image-heavy',
  'scanned',
  'mixed'
];

@Injectable({ providedIn: 'root' })
export class QpdfProductionGateService {
  readonly criteria = CRITERIA;

  evaluate(input: QpdfProductionGateEvaluationInput): QpdfProductionGateResult {
    const records = [...input.records];
    const deviceClasses = this.unique(records.map(record => record.deviceClass));
    const complexityClasses = this.unique(records.map(record => record.complexity));
    const successfulRecords = records.filter(record => record.qpdfSuccess && record.pdfLibWorkerSuccess);
    const failedQpdfRecordCount = records.filter(record => !record.qpdfSuccess).length;
    const failedPdfLibRecordCount = records.filter(record => !record.pdfLibWorkerSuccess).length;

    const hardFidelityMismatchCount = records.filter(record =>
      record.pageCountMatch === false ||
      record.pageGeometryMatch === false ||
      record.annotationsMatch === false ||
      record.linksMatch === false ||
      record.widgetsMatch === false ||
      record.outlinesMatch === false ||
      record.fieldsMatch === false ||
      record.firstPageRenderMatch === false
    ).length;

    const missingAdvancedFidelityCount = records.filter(record =>
      record.qpdfSuccess &&
      record.pdfLibWorkerSuccess &&
      (record.annotationsMatch === null ||
        record.linksMatch === null ||
        record.widgetsMatch === null ||
        record.outlinesMatch === null ||
        record.fieldsMatch === null ||
        record.firstPageRenderMatch === null)
    ).length;

    const medianQpdfSpeedup = this.median(
      successfulRecords
        .map(record => record.qpdfSpeedup)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );

    const medianQpdfMainThreadGapMs = this.median(
      successfulRecords
        .map(record => record.report.qpdf.maxMainThreadGapMs)
        .filter(value => Number.isFinite(value))
    );

    const medianPdfLibMainThreadGapMs = this.median(
      successfulRecords
        .map(record => record.report.pdfLibWorker.maxMainThreadGapMs)
        .filter(value => Number.isFinite(value))
    );

    const memoryTelemetryRecordCount = successfulRecords.filter(record =>
      record.report.qpdf.memory?.supported && record.report.pdfLibWorker.memory?.supported
    ).length;

    const longTaskTelemetryRecordCount = successfulRecords.filter(record =>
      record.report.qpdf.longTasks?.supported && record.report.pdfLibWorker.longTasks?.supported
    ).length;

    const maxObservedQpdfLongTaskMs = this.maximum(
      successfulRecords
        .map(record => record.report.qpdf.longTasks?.maxDurationMs ?? null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );

    const maxObservedPdfLibLongTaskMs = this.maximum(
      successfulRecords
        .map(record => record.report.pdfLibWorker.longTasks?.maxDurationMs ?? null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );

    const blockers: string[] = [];
    const nextActions: string[] = [];

    if (records.length < CRITERIA.minimumRecordsForFallbackReview) {
      blockers.push(`Need at least ${CRITERIA.minimumRecordsForFallbackReview} completed benchmark records.`);
    }

    if (deviceClasses.length < CRITERIA.minimumDeviceClassesForFallbackReview) {
      blockers.push(`Need evidence from at least ${CRITERIA.minimumDeviceClassesForFallbackReview} device classes.`);
    }

    if (complexityClasses.length < CRITERIA.minimumComplexityClassesForFallbackReview) {
      blockers.push(`Need at least ${CRITERIA.minimumComplexityClassesForFallbackReview} PDF complexity classes.`);
    }

    if (failedQpdfRecordCount > 0) {
      blockers.push(`${failedQpdfRecordCount} record(s) contain a qpdf failure; investigate before promotion review.`);
    }

    if (hardFidelityMismatchCount > 0) {
      blockers.push(`${hardFidelityMismatchCount} record(s) contain a fidelity mismatch.`);
    }

    if (missingAdvancedFidelityCount > 0) {
      blockers.push(`${missingAdvancedFidelityCount} successful record(s) do not have complete advanced fidelity evidence.`);
    }

    const fallbackEvidenceComplete =
      records.length >= CRITERIA.minimumRecordsForFallbackReview &&
      deviceClasses.length >= CRITERIA.minimumDeviceClassesForFallbackReview &&
      complexityClasses.length >= CRITERIA.minimumComplexityClassesForFallbackReview &&
      failedQpdfRecordCount === 0 &&
      hardFidelityMismatchCount === 0 &&
      missingAdvancedFidelityCount === 0;

    const primaryEvidenceComplete =
      fallbackEvidenceComplete &&
      records.length >= CRITERIA.minimumRecordsForPrimaryReview &&
      deviceClasses.length >= CRITERIA.minimumDeviceClassesForPrimaryReview &&
      complexityClasses.length >= CRITERIA.minimumComplexityClassesForPrimaryReview &&
      PRIMARY_COMPLEXITIES.every(complexity => complexityClasses.includes(complexity)) &&
      medianQpdfSpeedup !== null &&
      medianQpdfSpeedup >= CRITERIA.minimumMedianSpeedupForPrimaryReview &&
      medianQpdfMainThreadGapMs !== null &&
      medianQpdfMainThreadGapMs <= CRITERIA.maximumAllowedQpdfMainThreadGapMs;

    if (hardFidelityMismatchCount > 0 || failedQpdfRecordCount > 0) {
      nextActions.push('Reproduce and investigate every qpdf failure or fidelity mismatch with the source PDFs that caused it.');
    }

    if (missingAdvancedFidelityCount > 0) {
      nextActions.push('Collect complete annotation, link, widget, outline, field, and first-page rendering evidence.');
    }

    if (!primaryEvidenceComplete) {
      nextActions.push('Do not switch the production MergeEngine or raise public capacity from this gate alone.');
    }

    if (memoryTelemetryRecordCount < successfulRecords.length) {
      nextActions.push('Collect memory telemetry where the browser exposes it; JS heap telemetry does not measure qpdf Worker WASM memory directly.');
    }

    if (longTaskTelemetryRecordCount < successfulRecords.length) {
      nextActions.push('Collect long-task telemetry on browsers that support the Long Tasks API; use main-thread gap measurements on all runs.');
    }

    if (records.length < CRITERIA.minimumRecordsForPrimaryReview) {
      nextActions.push(`Collect at least ${CRITERIA.minimumRecordsForPrimaryReview} completed runs before considering primary-engine review.`);
    }

    if (deviceClasses.length < CRITERIA.minimumDeviceClassesForPrimaryReview) {
      nextActions.push('Repeat testing on additional representative device classes.');
    }

    const missingPrimaryComplexities = PRIMARY_COMPLEXITIES.filter(
      complexity => !complexityClasses.includes(complexity)
    );
    if (missingPrimaryComplexities.length > 0) {
      nextActions.push(`Collect primary-review evidence for: ${missingPrimaryComplexities.join(', ')}.`);
    }

    if (primaryEvidenceComplete) {
      return {
        status: 'primary-review-ready',
        title: 'Ready for primary-engine review',
        summary: 'The evidence meets the conservative quantitative gate for a human production-engine review. This does not automatically change engine selection or capacity.',
        criteria: CRITERIA,
        recordCount: records.length,
        successfulRecordCount: successfulRecords.length,
        failedQpdfRecordCount,
        failedPdfLibRecordCount,
        deviceClasses,
        complexityClasses,
        medianQpdfSpeedup,
        medianQpdfMainThreadGapMs,
        medianPdfLibMainThreadGapMs,
        hardFidelityMismatchCount,
        missingAdvancedFidelityCount,
        memoryTelemetryRecordCount,
        longTaskTelemetryRecordCount,
        maxObservedQpdfLongTaskMs,
        maxObservedPdfLibLongTaskMs,
        blockers: [],
        nextActions: ['Perform a final manual review of representative PDFs, memory behavior, cancellation, and production fallback semantics before making any engine-selection change.']
      };
    }

    if (fallbackEvidenceComplete) {
      return {
        status: 'fallback-review-ready',
        title: 'Ready for fallback review',
        summary: 'The evidence meets the conservative gate for considering qpdf as a controlled fallback. Production behavior must still be reviewed and explicitly implemented.',
        criteria: CRITERIA,
        recordCount: records.length,
        successfulRecordCount: successfulRecords.length,
        failedQpdfRecordCount,
        failedPdfLibRecordCount,
        deviceClasses,
        complexityClasses,
        medianQpdfSpeedup,
        medianQpdfMainThreadGapMs,
        medianPdfLibMainThreadGapMs,
        hardFidelityMismatchCount,
        missingAdvancedFidelityCount,
        memoryTelemetryRecordCount,
        longTaskTelemetryRecordCount,
        maxObservedQpdfLongTaskMs,
        maxObservedPdfLibLongTaskMs,
        blockers: [],
        nextActions: ['Review fallback trigger conditions, error handling, cancellation, memory pressure, and user-visible behavior before implementation.']
      };
    }

    const insufficient =
      records.length < CRITERIA.minimumRecordsForFallbackReview ||
      deviceClasses.length < CRITERIA.minimumDeviceClassesForFallbackReview ||
      complexityClasses.length < CRITERIA.minimumComplexityClassesForFallbackReview;

    return {
      status: insufficient ? 'insufficient-evidence' : 'blocked-by-failures',
      title: insufficient ? 'More evidence required' : 'Promotion review blocked',
      summary: insufficient
        ? 'The current ledger does not yet contain enough representative evidence for a production-engine review.'
        : 'The evidence volume is sufficient for review, but failures or fidelity gaps must be resolved first.',
      criteria: CRITERIA,
      recordCount: records.length,
      successfulRecordCount: successfulRecords.length,
      failedQpdfRecordCount,
      failedPdfLibRecordCount,
      deviceClasses,
      complexityClasses,
      medianQpdfSpeedup,
      medianQpdfMainThreadGapMs,
      medianPdfLibMainThreadGapMs,
      hardFidelityMismatchCount,
      missingAdvancedFidelityCount,
      memoryTelemetryRecordCount,
      longTaskTelemetryRecordCount,
      maxObservedQpdfLongTaskMs,
      maxObservedPdfLibLongTaskMs,
      blockers,
      nextActions
    };
  }

  private unique<T extends string>(values: readonly T[]): T[] {
    return Array.from(new Set(values));
  }

  private maximum(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return Math.max(...values);
  }

  private median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }
}

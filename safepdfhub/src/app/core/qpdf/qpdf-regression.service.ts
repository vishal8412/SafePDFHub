import { Injectable } from '@angular/core';
import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord } from './qpdf-benchmark-evidence.types';
import type {
  QpdfRegressionAnalysis,
  QpdfRegressionBaseline,
  QpdfRegressionClassComparison,
  QpdfRegressionEvaluationInput,
  QpdfRegressionMetricComparison,
  QpdfRegressionThresholds
} from './qpdf-regression.types';

const STORAGE_KEY = 'safepdfhub.qpdf-benchmark.regression-baseline.v1';

const THRESHOLDS: QpdfRegressionThresholds = {
  minimumBaselineRecords: 5,
  minimumCurrentRecords: 3,
  maximumPositiveQpdfFailureRate: 0,
  maximumFidelityMismatchRate: 0,
  maximumMedianElapsedRegressionRatio: 0.2,
  maximumMedianSpeedupRegressionRatio: 0.1,
  maximumMedianMainThreadGapRegressionRatio: 0.25,
  maximumLongTaskRegressionRatio: 0.25,
  minimumComparableRecordsPerClass: 2,
  memoryDeltaAdvisoryAbsoluteBytes: 50 * 1024 * 1024
};

const NEGATIVE_COMPLEXITIES = new Set<QpdfBenchmarkComplexity>([
  'encrypted',
  'malformed'
]);

@Injectable({ providedIn: 'root' })
export class QpdfRegressionService {
  readonly thresholds = THRESHOLDS;

  loadBaseline(): QpdfRegressionBaseline | null {
    if (!this.canUseStorage()) return null;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return this.isBaseline(value) ? value : null;
    } catch {
      return null;
    }
  }

  captureBaseline(records: readonly QpdfBenchmarkEvidenceRecord[]): QpdfRegressionBaseline {
    const baseline: QpdfRegressionBaseline = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      recordIds: records.map(record => record.id),
      recordCount: records.length,
      note: 'Baseline contains benchmark record IDs and metadata only. PDF bytes are never stored.'
    };

    if (this.canUseStorage()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));
      } catch {
        // Best effort only; benchmark evidence must remain independent of this storage.
      }
    }

    return baseline;
  }

  clearBaseline(): void {
    if (!this.canUseStorage()) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  evaluate(input: QpdfRegressionEvaluationInput): QpdfRegressionAnalysis {
    const baseline = input.baseline;
    if (!baseline) return this.emptyAnalysis('baseline-not-set', null);

    const baselineIds = new Set(baseline.recordIds);
    const baselineRecords = input.records.filter(record => baselineIds.has(record.id));
    const currentRecords = input.records.filter(record => !baselineIds.has(record.id));

    if (baselineRecords.length < THRESHOLDS.minimumBaselineRecords) {
      return this.buildInsufficientAnalysis(
        baseline,
        baselineRecords,
        currentRecords,
        `Baseline contains ${baselineRecords.length} record(s); at least ${THRESHOLDS.minimumBaselineRecords} are required.`
      );
    }

    if (currentRecords.length < THRESHOLDS.minimumCurrentRecords) {
      return this.buildInsufficientAnalysis(
        baseline,
        baselineRecords,
        currentRecords,
        `Collect at least ${THRESHOLDS.minimumCurrentRecords} new record(s) after capturing the baseline.`
      );
    }

    const baselinePositive = this.positiveRecords(baselineRecords);
    const currentPositive = this.positiveRecords(currentRecords);

    const positiveQpdfFailureRateBaseline = this.failureRate(baselinePositive);
    const positiveQpdfFailureRateCurrent = this.failureRate(currentPositive);
    const fidelityMismatchRateBaseline = this.fidelityMismatchRate(baselinePositive);
    const fidelityMismatchRateCurrent = this.fidelityMismatchRate(currentPositive);

    const metrics = [
      this.compareLowerIsBetter(
        'Median qpdf elapsed time',
        this.median(baselinePositive.map(record => record.qpdfElapsedMs).filter(this.isFiniteNumber)),
        this.median(currentPositive.map(record => record.qpdfElapsedMs).filter(this.isFiniteNumber)),
        THRESHOLDS.maximumMedianElapsedRegressionRatio
      ),
      this.compareHigherIsBetter(
        'Median qpdf speedup',
        this.median(baselinePositive.map(record => record.qpdfSpeedup).filter(this.isFiniteNumber)),
        this.median(currentPositive.map(record => record.qpdfSpeedup).filter(this.isFiniteNumber)),
        THRESHOLDS.maximumMedianSpeedupRegressionRatio
      ),
      this.compareLowerIsBetter(
        'Median qpdf main-thread gap',
        this.median(baselinePositive.map(record => record.report.qpdf.maxMainThreadGapMs).filter(this.isFiniteNumber)),
        this.median(currentPositive.map(record => record.report.qpdf.maxMainThreadGapMs).filter(this.isFiniteNumber)),
        THRESHOLDS.maximumMedianMainThreadGapRegressionRatio
      ),
      this.compareLowerIsBetter(
        'Maximum qpdf long task',
        this.maximumLongTask(baselinePositive),
        this.maximumLongTask(currentPositive),
        THRESHOLDS.maximumLongTaskRegressionRatio
      )
    ];

    const regressions: string[] = [];
    const improvements: string[] = [];
    const advisories: string[] = [];

    if (
      positiveQpdfFailureRateCurrent !== null &&
      positiveQpdfFailureRateCurrent > THRESHOLDS.maximumPositiveQpdfFailureRate
    ) {
      regressions.push(
        `Positive-case qpdf failure rate is ${(positiveQpdfFailureRateCurrent * 100).toFixed(1)}%; expected threshold is 0%.`
      );
    }

    if (
      fidelityMismatchRateCurrent !== null &&
      fidelityMismatchRateCurrent > THRESHOLDS.maximumFidelityMismatchRate
    ) {
      regressions.push(
        `Positive-case fidelity mismatch rate is ${(fidelityMismatchRateCurrent * 100).toFixed(1)}%; expected threshold is 0%.`
      );
    }

    for (const metric of metrics) {
      if (metric.status === 'regression') regressions.push(this.metricMessage(metric));
      if (metric.status === 'improved') improvements.push(this.metricMessage(metric));
      if (metric.status === 'insufficient') advisories.push(`${metric.name}: insufficient numeric evidence for comparison.`);
    }

    const classComparisons = this.compareByComplexity(baselinePositive, currentPositive);
    for (const comparison of classComparisons) {
      if (!comparison.comparable) continue;
      if (comparison.qpdfMedianElapsedMs.status === 'regression') {
        regressions.push(`${comparison.complexity}: median qpdf elapsed time regressed beyond the threshold.`);
      }
      if (comparison.qpdfMedianSpeedup.status === 'regression') {
        regressions.push(`${comparison.complexity}: qpdf speedup regressed beyond the threshold.`);
      }
      if (comparison.qpdfMedianMainThreadGapMs.status === 'regression') {
        regressions.push(`${comparison.complexity}: qpdf main-thread gap regressed beyond the threshold.`);
      }
    }

    const baselineMemory = this.medianMemoryDelta(baselinePositive);
    const currentMemory = this.medianMemoryDelta(currentPositive);
    if (baselineMemory !== null && currentMemory !== null) {
      const memoryChange = currentMemory - baselineMemory;
      if (Math.abs(memoryChange) > THRESHOLDS.memoryDeltaAdvisoryAbsoluteBytes) {
        advisories.push(
          `Median JS heap delta changed by ${this.formatBytes(Math.abs(memoryChange))}. Treat this as advisory browser telemetry, not proof of a WASM memory leak.`
        );
      }
    } else {
      advisories.push('JS heap telemetry is incomplete; memory regression analysis remains advisory.');
    }

    if (currentPositive.length === 0) {
      advisories.push('No positive-case records are available in the post-baseline period; encrypted/malformed cases are excluded from success-rate regression checks.');
    }

    const status = regressions.length > 0
      ? 'regression-detected'
      : improvements.length > 0
        ? 'improved'
        : 'stable';

    return {
      status,
      title: status === 'regression-detected'
        ? 'Regression detected — review before promotion'
        : status === 'improved'
          ? 'Evidence improved — continue validation'
          : 'No regression detected against baseline',
      summary: status === 'regression-detected'
        ? 'One or more controlled metrics crossed the regression thresholds. This blocks automatic promotion and requires investigation of the new evidence.'
        : 'The post-baseline evidence is within the defined regression thresholds. This is evidence stability only; it does not approve qpdf for production.',
      thresholds: THRESHOLDS,
      baseline,
      baselineRecordCount: baselineRecords.length,
      currentRecordCount: currentRecords.length,
      positiveBaselineRecordCount: baselinePositive.length,
      positiveCurrentRecordCount: currentPositive.length,
      positiveQpdfFailureRateBaseline,
      positiveQpdfFailureRateCurrent,
      fidelityMismatchRateBaseline,
      fidelityMismatchRateCurrent,
      metrics,
      classComparisons,
      regressions,
      improvements,
      advisories,
      nextActions: this.nextActions(status, regressions, currentRecords)
    };
  }

  private buildInsufficientAnalysis(
    baseline: QpdfRegressionBaseline,
    baselineRecords: readonly QpdfBenchmarkEvidenceRecord[],
    currentRecords: readonly QpdfBenchmarkEvidenceRecord[],
    reason: string
  ): QpdfRegressionAnalysis {
    return {
      status: 'insufficient-comparison',
      title: 'More evidence required for regression comparison',
      summary: reason,
      thresholds: THRESHOLDS,
      baseline,
      baselineRecordCount: baselineRecords.length,
      currentRecordCount: currentRecords.length,
      positiveBaselineRecordCount: this.positiveRecords(baselineRecords).length,
      positiveCurrentRecordCount: this.positiveRecords(currentRecords).length,
      positiveQpdfFailureRateBaseline: this.failureRate(this.positiveRecords(baselineRecords)),
      positiveQpdfFailureRateCurrent: this.failureRate(this.positiveRecords(currentRecords)),
      fidelityMismatchRateBaseline: this.fidelityMismatchRate(this.positiveRecords(baselineRecords)),
      fidelityMismatchRateCurrent: this.fidelityMismatchRate(this.positiveRecords(currentRecords)),
      metrics: [],
      classComparisons: [],
      regressions: [],
      improvements: [],
      advisories: ['Do not interpret insufficient comparison as a pass or a failure.'],
      nextActions: [reason, 'Keep collecting representative benchmark and soak evidence.']
    };
  }

  private emptyAnalysis(
    status: 'baseline-not-set' | 'no-new-evidence',
    baseline: QpdfRegressionBaseline | null
  ): QpdfRegressionAnalysis {
    return {
      status,
      title: status === 'baseline-not-set' ? 'Regression baseline not set' : 'No new evidence after baseline',
      summary: status === 'baseline-not-set'
        ? 'Capture a baseline after you have a representative evidence set. The baseline stores IDs only; it never stores PDF bytes.'
        : 'Run additional benchmarks after capturing the baseline before evaluating regression behavior.',
      thresholds: THRESHOLDS,
      baseline,
      baselineRecordCount: 0,
      currentRecordCount: 0,
      positiveBaselineRecordCount: 0,
      positiveCurrentRecordCount: 0,
      positiveQpdfFailureRateBaseline: null,
      positiveQpdfFailureRateCurrent: null,
      fidelityMismatchRateBaseline: null,
      fidelityMismatchRateCurrent: null,
      metrics: [],
      classComparisons: [],
      regressions: [],
      improvements: [],
      advisories: [],
      nextActions: ['Collect at least 5 representative evidence records.', 'Capture the baseline, then collect at least 3 new records for comparison.']
    };
  }

  private compareByComplexity(
    baseline: readonly QpdfBenchmarkEvidenceRecord[],
    current: readonly QpdfBenchmarkEvidenceRecord[]
  ): QpdfRegressionClassComparison[] {
    const complexities = Array.from(new Set([
      ...baseline.map(record => record.complexity),
      ...current.map(record => record.complexity)
    ])).filter(complexity => !NEGATIVE_COMPLEXITIES.has(complexity));

    return complexities.map(complexity => {
      const baselineRecords = baseline.filter(record => record.complexity === complexity);
      const currentRecords = current.filter(record => record.complexity === complexity);
      const comparable =
        baselineRecords.length >= THRESHOLDS.minimumComparableRecordsPerClass &&
        currentRecords.length >= THRESHOLDS.minimumComparableRecordsPerClass;

      return {
        complexity,
        baselineCount: baselineRecords.length,
        currentCount: currentRecords.length,
        comparable,
        qpdfMedianElapsedMs: this.compareLowerIsBetter(
          'Median qpdf elapsed time',
          this.median(baselineRecords.map(record => record.qpdfElapsedMs).filter(this.isFiniteNumber)),
          this.median(currentRecords.map(record => record.qpdfElapsedMs).filter(this.isFiniteNumber)),
          THRESHOLDS.maximumMedianElapsedRegressionRatio
        ),
        qpdfMedianSpeedup: this.compareHigherIsBetter(
          'Median qpdf speedup',
          this.median(baselineRecords.map(record => record.qpdfSpeedup).filter(this.isFiniteNumber)),
          this.median(currentRecords.map(record => record.qpdfSpeedup).filter(this.isFiniteNumber)),
          THRESHOLDS.maximumMedianSpeedupRegressionRatio
        ),
        qpdfMedianMainThreadGapMs: this.compareLowerIsBetter(
          'Median qpdf main-thread gap',
          this.median(baselineRecords.map(record => record.report.qpdf.maxMainThreadGapMs).filter(this.isFiniteNumber)),
          this.median(currentRecords.map(record => record.report.qpdf.maxMainThreadGapMs).filter(this.isFiniteNumber)),
          THRESHOLDS.maximumMedianMainThreadGapRegressionRatio
        )
      };
    });
  }

  private compareLowerIsBetter(
    name: string,
    baseline: number | null,
    current: number | null,
    thresholdRatio: number
  ): QpdfRegressionMetricComparison {
    if (baseline === null || current === null || baseline <= 0) {
      return { name, baseline, current, changeRatio: null, thresholdRatio, direction: 'lower-is-better', status: 'insufficient' };
    }

    const changeRatio = (current - baseline) / baseline;
    return {
      name,
      baseline,
      current,
      changeRatio,
      thresholdRatio,
      direction: 'lower-is-better',
      status: changeRatio > thresholdRatio ? 'regression' : changeRatio < -thresholdRatio ? 'improved' : 'pass'
    };
  }

  private compareHigherIsBetter(
    name: string,
    baseline: number | null,
    current: number | null,
    thresholdRatio: number
  ): QpdfRegressionMetricComparison {
    if (baseline === null || current === null || baseline <= 0) {
      return { name, baseline, current, changeRatio: null, thresholdRatio, direction: 'higher-is-better', status: 'insufficient' };
    }

    const changeRatio = (current - baseline) / baseline;
    return {
      name,
      baseline,
      current,
      changeRatio,
      thresholdRatio,
      direction: 'higher-is-better',
      status: changeRatio < -thresholdRatio ? 'regression' : changeRatio > thresholdRatio ? 'improved' : 'pass'
    };
  }

  private metricMessage(metric: QpdfRegressionMetricComparison): string {
    const change = metric.changeRatio === null ? 'n/a' : `${metric.changeRatio >= 0 ? '+' : ''}${(metric.changeRatio * 100).toFixed(1)}%`;
    return `${metric.name}: ${change} versus baseline.`;
  }

  private nextActions(status: QpdfRegressionAnalysis['status'], regressions: readonly string[], currentRecords: readonly QpdfBenchmarkEvidenceRecord[]): string[] {
    if (status === 'regression-detected') {
      return [
        'Re-run the affected workload to reproduce the regression.',
        'Inspect the corresponding PDF complexity/device class before changing production behavior.',
        'Do not promote qpdf or increase capacity while the regression remains unexplained.'
      ];
    }

    const actions = [
      'Continue collecting representative evidence across PDF complexity and device classes.',
      'Use repeated-run soaks for workloads that show timing or stability variance.'
    ];

    if (currentRecords.length < 10) {
      actions.push('Collect more post-baseline records before treating the comparison as durable evidence.');
    }

    return actions;
  }

  private positiveRecords(records: readonly QpdfBenchmarkEvidenceRecord[]): QpdfBenchmarkEvidenceRecord[] {
    return records.filter(record => !NEGATIVE_COMPLEXITIES.has(record.complexity));
  }

  private failureRate(records: readonly QpdfBenchmarkEvidenceRecord[]): number | null {
    if (records.length === 0) return null;
    const failures = records.filter(record => !record.qpdfSuccess).length;
    return failures / records.length;
  }

  private fidelityMismatchRate(records: readonly QpdfBenchmarkEvidenceRecord[]): number | null {
    if (records.length === 0) return null;
    const mismatches = records.filter(record =>
      record.pageCountMatch === false ||
      record.pageGeometryMatch === false ||
      record.annotationsMatch === false ||
      record.linksMatch === false ||
      record.widgetsMatch === false ||
      record.outlinesMatch === false ||
      record.fieldsMatch === false ||
      record.firstPageRenderMatch === false
    ).length;
    return mismatches / records.length;
  }

  private maximumLongTask(records: readonly QpdfBenchmarkEvidenceRecord[]): number | null {
    const values = records
      .map(record => record.report.qpdf.longTasks?.maxDurationMs ?? null)
      .filter(this.isFiniteNumber);
    return values.length === 0 ? null : Math.max(...values);
  }

  private medianMemoryDelta(records: readonly QpdfBenchmarkEvidenceRecord[]): number | null {
    const values = records
      .map(record => record.report.qpdf.memory?.deltaBytes ?? null)
      .filter(this.isFiniteNumber);
    return this.median(values);
  }

  private median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private isFiniteNumber(value: number | null): value is number {
    return value !== null && Number.isFinite(value);
  }

  private formatBytes(bytes: number): string {
    const absolute = Math.abs(bytes);
    if (absolute >= 1024 * 1024 * 1024) return `${(absolute / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${(absolute / (1024 * 1024)).toFixed(1)} MB`;
  }

  private isBaseline(value: unknown): value is QpdfRegressionBaseline {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return candidate['schemaVersion'] === 1 &&
      typeof candidate['capturedAt'] === 'string' &&
      Array.isArray(candidate['recordIds']) &&
      candidate['recordIds'].every(item => typeof item === 'string') &&
      typeof candidate['recordCount'] === 'number';
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }
}

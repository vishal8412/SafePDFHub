import { Injectable } from '@angular/core';
import { QpdfBenchmarkService } from './qpdf-benchmark.service';
import type { QpdfBenchmarkComplexity, QpdfBenchmarkResult } from './qpdf-benchmark.types';
import { QpdfBenchmarkEvidenceService } from './qpdf-benchmark-evidence.service';
import type { QpdfSoakIterationSummary, QpdfSoakResult } from './qpdf-soak.types';

@Injectable({ providedIn: 'root' })
export class QpdfSoakService {
  private cancelRequested = false;

  constructor(
    private readonly benchmarkService: QpdfBenchmarkService,
    private readonly evidenceService: QpdfBenchmarkEvidenceService
  ) {}

  async run(
    files: readonly File[],
    complexity: QpdfBenchmarkComplexity,
    iterations: number,
    cooldownMs: number,
    onProgress?: (progress: number, message: string) => void
  ): Promise<QpdfSoakResult> {
    if (files.length < 2) {
      throw new Error('Select at least 2 PDF files for soak testing.');
    }

    const requestedIterations = Math.min(20, Math.max(2, Math.floor(iterations)));
    const safeCooldownMs = Math.min(10_000, Math.max(0, Math.floor(cooldownMs)));
    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);

    this.cancelRequested = false;
    const started = performance.now();
    const reports: QpdfBenchmarkResult[] = [];
    const iterationSummaries: QpdfSoakIterationSummary[] = [];
    let stopReason: string | undefined;

    for (let index = 0; index < requestedIterations; index += 1) {
      if (this.cancelRequested) {
        stopReason = 'Cancellation requested by the user.';
        break;
      }

      const iteration = index + 1;
      onProgress?.(
        Math.round((index / requestedIterations) * 100),
        `Soak iteration ${iteration} of ${requestedIterations}...`
      );

      const report = await this.benchmarkService.run(
        files,
        complexity,
        (benchmarkProgress, message) => {
          const base = (index / requestedIterations) * 100;
          const span = 100 / requestedIterations;
          onProgress?.(
            Math.min(99, Math.round(base + (benchmarkProgress / 100) * span)),
            `Iteration ${iteration}/${requestedIterations}: ${message}`
          );
        }
      );

      reports.push(report);

      if (report.status === 'completed') {
        this.evidenceService.save(report);
      }

      iterationSummaries.push(this.toIterationSummary(iteration, report));

      if (report.status === 'cancelled') {
        stopReason = 'Benchmark engine reported cancellation.';
        break;
      }

      if (this.cancelRequested) {
        stopReason = 'Cancellation requested by the user.';
        break;
      }

      if (iteration < requestedIterations && safeCooldownMs > 0) {
        onProgress?.(
          Math.round((iteration / requestedIterations) * 100),
          `Cooldown ${safeCooldownMs} ms before the next iteration...`
        );
        await this.delay(safeCooldownMs);
      }
    }

    const inputPages = this.findInputPages(reports);
    const totalElapsedMs = performance.now() - started;
    const completedReports = reports.filter(report => report.status === 'completed');
    const qpdfSuccessCount = completedReports.filter(report => report.qpdf.success).length;
    const pdfLibWorkerSuccessCount = completedReports.filter(report => report.pdfLibWorker.success).length;
    const pairedSuccessReports = completedReports.filter(
      report => report.qpdf.success && report.pdfLibWorker.success
    );
    const fidelityMismatchCount = completedReports.filter(report =>
      report.pageCountMatch === false ||
      report.pageGeometryMatch === false ||
      report.annotationsMatch === false ||
      report.linksMatch === false ||
      report.widgetsMatch === false ||
      report.outlinesMatch === false ||
      report.fieldsMatch === false ||
      report.firstPageRenderMatch === false
    ).length;

    const qpdfElapsedValues = pairedSuccessReports.map(report => report.qpdf.elapsedMs);
    const qpdfSpeedups = pairedSuccessReports
      .map(report => report.qpdfSpeedup)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const qpdfGapValues = pairedSuccessReports.map(report => report.qpdf.maxMainThreadGapMs);
    const qpdfLongTasks = pairedSuccessReports
      .map(report => report.qpdf.longTasks?.maxDurationMs ?? null)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const pdfLibLongTasks = pairedSuccessReports
      .map(report => report.pdfLibWorker.longTasks?.maxDurationMs ?? null)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    const status: QpdfSoakResult['status'] =
      this.cancelRequested || stopReason
        ? 'cancelled'
        : completedReports.length === requestedIterations
          ? 'completed'
          : 'failed';

    const result: QpdfSoakResult = {
      status,
      complexity,
      requestedIterations,
      completedIterations: completedReports.length,
      inputFileCount: files.length,
      inputBytes,
      inputPages,
      totalElapsedMs,
      qpdfSuccessCount,
      pdfLibWorkerSuccessCount,
      pairedSuccessCount: pairedSuccessReports.length,
      qpdfFailureCount: completedReports.length - qpdfSuccessCount,
      pdfLibWorkerFailureCount: completedReports.length - pdfLibWorkerSuccessCount,
      fidelityMismatchCount,
      qpdfMedianElapsedMs: this.median(qpdfElapsedValues),
      qpdfMedianSpeedup: this.median(qpdfSpeedups),
      qpdfFirstIterationElapsedMs: qpdfElapsedValues[0] ?? null,
      qpdfLastIterationElapsedMs: qpdfElapsedValues[qpdfElapsedValues.length - 1] ?? null,
      qpdfElapsedDriftRatio: this.driftRatio(qpdfElapsedValues),
      qpdfMedianMainThreadGapMs: this.median(qpdfGapValues),
      qpdfMaxMainThreadGapMs: this.maximum(qpdfGapValues),
      qpdfMaxLongTaskMs: this.maximum(qpdfLongTasks),
      pdfLibMaxLongTaskMs: this.maximum(pdfLibLongTasks),
      qpdfMemoryDeltaTrendBytes: this.trendDelta(
        pairedSuccessReports.map(report => report.qpdf.memory?.deltaBytes ?? null)
      ),
      pdfLibMemoryDeltaTrendBytes: this.trendDelta(
        pairedSuccessReports.map(report => report.pdfLibWorker.memory?.deltaBytes ?? null)
      ),
      iterations: iterationSummaries,
      reports,
      stopReason
    };

    onProgress?.(
      100,
      status === 'completed'
        ? 'Soak test complete.'
        : 'Soak test stopped; review the collected iterations.'
    );

    return result;
  }

  cancel(): void {
    this.cancelRequested = true;
    this.benchmarkService.cancel();
  }

  private toIterationSummary(
    iteration: number,
    report: QpdfBenchmarkResult
  ): QpdfSoakIterationSummary {
    const hardFidelityPass = report.status === 'completed' &&
      report.qpdf.success &&
      report.pdfLibWorker.success &&
      report.pageCountMatch !== false &&
      report.pageGeometryMatch !== false &&
      report.annotationsMatch !== false &&
      report.linksMatch !== false &&
      report.widgetsMatch !== false &&
      report.outlinesMatch !== false &&
      report.fieldsMatch !== false &&
      report.firstPageRenderMatch !== false;

    return {
      iteration,
      qpdfSuccess: report.qpdf.success,
      pdfLibWorkerSuccess: report.pdfLibWorker.success,
      qpdfElapsedMs: report.qpdf.elapsedMs,
      pdfLibWorkerElapsedMs: report.pdfLibWorker.elapsedMs,
      qpdfSpeedup: report.qpdfSpeedup,
      qpdfMainThreadGapMs: report.qpdf.maxMainThreadGapMs,
      pdfLibMainThreadGapMs: report.pdfLibWorker.maxMainThreadGapMs,
      pageCountMatch: report.pageCountMatch,
      pageGeometryMatch: report.pageGeometryMatch,
      hardFidelityPass,
      qpdfMemoryDeltaBytes: report.qpdf.memory?.deltaBytes ?? null,
      pdfLibMemoryDeltaBytes: report.pdfLibWorker.memory?.deltaBytes ?? null,
      qpdfLongTaskMaxMs: report.qpdf.longTasks?.maxDurationMs ?? null,
      pdfLibLongTaskMaxMs: report.pdfLibWorker.longTasks?.maxDurationMs ?? null
    };
  }

  private findInputPages(reports: readonly QpdfBenchmarkResult[]): number | null {
    return reports.find(report => report.inputPages !== null)?.inputPages ?? null;
  }

  private median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private maximum(values: readonly number[]): number | null {
    return values.length === 0 ? null : Math.max(...values);
  }

  private driftRatio(values: readonly number[]): number | null {
    if (values.length < 2 || values[0] <= 0) return null;
    return (values[values.length - 1] - values[0]) / values[0];
  }

  private trendDelta(values: readonly (number | null)[]): number | null {
    const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (numeric.length < 2) return null;
    return numeric[numeric.length - 1] - numeric[0];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }
}

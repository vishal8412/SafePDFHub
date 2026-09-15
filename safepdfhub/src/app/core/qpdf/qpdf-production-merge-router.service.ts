import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { MergeEngine, MergeCancelledError } from '../engines/merge.engine';
import { QpdfWasmPrototypeService, QpdfPrototypeCancelledError } from './qpdf-wasm-prototype.service';
import { QpdfProductionPilotService } from './qpdf-production-pilot.service';
import type { QpdfProductionPilotConfig, QpdfProductionPilotEligibility } from './qpdf-production-pilot.types';
import type {
  QpdfProductionRoutingObservedOutcome,
  QpdfProductionRoutingValidationResult,
  QpdfProductionRoutingValidationScenario
} from './qpdf-production-routing-validation.types';

export interface QpdfProductionMergeOptions {
  onStage?: (stage: string, message: string) => void;
}

/**
 * Production-facing merge boundary for the qpdf pilot.
 *
 * The default configuration is fail-closed, so normal production behavior is
 * exactly the existing MergeEngine Worker path. qpdf is attempted only when
 * the explicit pilot controls authorize the selected workload/session.
 */
@Injectable({ providedIn: 'root' })
export class QpdfProductionMergeRouterService {
  private cancelled = false;
  private lastRoutingOutcome: QpdfProductionRoutingValidationResult['outcome'] | null = null;

  constructor(
    private readonly mergeEngine: MergeEngine,
    private readonly qpdfService: QpdfWasmPrototypeService,
    private readonly pilotService: QpdfProductionPilotService
  ) {}

  async merge(
    files: File[],
    onProgress?: (progress: number) => void,
    knownPageCounts: readonly number[] = [],
    options: QpdfProductionMergeOptions = {}
  ): Promise<File> {
    this.cancelled = false;
    this.lastRoutingOutcome = null;

    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
    const eligibility = this.pilotService.evaluateEligibility(files.length, inputBytes);

    return this.routeMerge(
      files,
      onProgress,
      knownPageCounts,
      options,
      eligibility
    );
  }

  /**
   * Development-only validation entry point. It exercises the same routing/fallback
   * implementation used by the production Merge tool, but never mutates the real
   * pilot configuration.
   */
  async validateControlledRoutingPath(
    files: readonly File[],
    knownPageCounts: readonly number[],
    validationConfig: QpdfProductionPilotConfig,
    forceQpdfFailure: boolean,
    onProgress?: (progress: number, message: string) => void
  ): Promise<QpdfProductionRoutingValidationResult> {
    this.cancelled = false;
    this.lastRoutingOutcome = null;
    const started = performance.now();
    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
    const eligibility = this.pilotService.evaluateEligibilityForValidation(
      validationConfig,
      files.length,
      inputBytes
    );

    const scenario: QpdfProductionRoutingValidationScenario = forceQpdfFailure
      ? 'qpdf-failure-fallback'
      : validationConfig.killSwitch
        ? 'kill-switch-blocked'
        : validationConfig.maxFiles < files.length || validationConfig.maxTotalBytes < inputBytes
          ? 'capacity-blocked'
          : validationConfig.enabled && validationConfig.humanApprovalRecorded && validationConfig.rolloutPercent > 0
            ? 'eligible-qpdf'
            : 'default-blocked';

    try {
      const output = await this.routeMerge(
        [...files],
        progress => onProgress?.(progress, scenario === 'eligible-qpdf' ? 'Running eligible qpdf routing path...' : 'Running production routing path...'),
        knownPageCounts,
        {
          onStage: (_stage, message) => onProgress?.(0, message)
        },
        eligibility,
        forceQpdfFailure
      );

      const observedOutcome: QpdfProductionRoutingValidationResult['outcome'] =
        this.lastRoutingOutcome ?? (eligibility.allowed ? 'failed' : 'pdf-lib-worker');

      const expected = scenario === 'default-blocked' || scenario === 'kill-switch-blocked' || scenario === 'capacity-blocked'
        ? 'Existing pdf-lib Worker is used and qpdf is not attempted.'
        : forceQpdfFailure
          ? 'qpdf is attempted, fails safely, then existing pdf-lib Worker completes the merge.'
          : 'qpdf is attempted and its hard validation gate passes.';

      const fallbackUsed = this.isFallbackOutcome(observedOutcome);
      const qpdfSucceeded = this.isQpdfSuccessOutcome(observedOutcome);

      const passed = scenario === 'qpdf-failure-fallback'
        ? fallbackUsed
        : scenario === 'eligible-qpdf'
          ? qpdfSucceeded
          : observedOutcome === 'pdf-lib-worker' && !eligibility.allowed;

      return {
        schemaVersion: 1,
        scenario,
        label: scenario,
        passed,
        expected,
        observed: `${observedOutcome}; qpdf attempted=${eligibility.allowed}; fallback=${fallbackUsed}.`,
        eligibilityAllowed: eligibility.allowed,
        eligibilityReason: eligibility.reason ?? null,
        qpdfAttempted: eligibility.allowed,
        fallbackUsed,
        outcome: observedOutcome,
        elapsedMs: performance.now() - started,
        note: output.size > 0 ? `Validated output size: ${output.size} bytes.` : undefined
      };
    } catch (error) {
      const cancelled = this.isCancellation(error);
      return {
        schemaVersion: 1,
        scenario,
        label: scenario,
        passed: false,
        expected: 'Routing path completes according to its scenario contract.',
        observed: cancelled ? 'cancelled' : `failed: ${this.toFailureMessage(error)}`,
        eligibilityAllowed: eligibility.allowed,
        eligibilityReason: eligibility.reason ?? null,
        qpdfAttempted: eligibility.allowed,
        fallbackUsed: false,
        outcome: cancelled ? 'cancelled' : 'failed',
        elapsedMs: performance.now() - started,
        note: 'Validation failure is reported without changing production configuration.'
      };
    }
  }

  private async routeMerge(
    files: File[],
    onProgress: ((progress: number) => void) | undefined,
    knownPageCounts: readonly number[],
    options: QpdfProductionMergeOptions,
    eligibility: QpdfProductionPilotEligibility,
    forceQpdfFailure = false
  ): Promise<File> {
    if (!eligibility.allowed) {
      this.lastRoutingOutcome = 'pdf-lib-worker';
      options.onStage?.('pdf-lib', 'Using the existing pdf-lib Worker engine.');
      return this.mergeWithPdfLibWorker(files, onProgress, knownPageCounts, options);
    }

    return this.mergeWithControlledQpdfFallback(
      files,
      onProgress,
      knownPageCounts,
      options,
      eligibility,
      forceQpdfFailure
    );
  }

  cancel(): void {
    this.cancelled = true;
    void this.qpdfService.cancel();
    this.mergeEngine.cancel();
  }

  private async mergeWithControlledQpdfFallback(
    files: File[],
    onProgress: ((progress: number) => void) | undefined,
    knownPageCounts: readonly number[],
    options: QpdfProductionMergeOptions,
    eligibility: QpdfProductionPilotEligibility,
    forceQpdfFailure = false
  ): Promise<File> {
    const started = performance.now();
    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
    const inputPageCount = this.getKnownPageCount(knownPageCounts);
    let qpdfAttempted = false;

    try {
      qpdfAttempted = true;
      options.onStage?.('qpdf', 'Trying the controlled qpdf local pilot...');
      if (forceQpdfFailure) {
        throw new Error('Controlled validation forced qpdf failure.');
      }
      const qpdfOutput = await this.qpdfService.merge(
        files,
        (progress: number) => onProgress?.(Math.min(78, Math.round(progress * 0.78)))
      );

      this.throwIfCancelled();
      const validation = await this.validateOutput(qpdfOutput);
      const hardFidelityPassed = validation.parseable &&
        (inputPageCount === null || validation.pageCount === inputPageCount);

      if (hardFidelityPassed) {
        this.pilotService.record({
          schemaVersion: 1,
          recordedAt: new Date().toISOString(),
          outcome: 'qpdf-success',
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          qpdfAttempted,
          qpdfSucceeded: true,
          fallbackUsed: false,
          hardFidelityPassed: true,
          elapsedMs: performance.now() - started,
          note: `Controlled qpdf pilot session bucket ${eligibility.sessionBucket}.`
        });
        this.lastRoutingOutcome = 'qpdf-success';
        onProgress?.(100);
        options.onStage?.('finalizing', 'qpdf pilot completed successfully.');
        return qpdfOutput;
      }

      const reason = validation.errorMessage ??
        `qpdf output failed the hard validation gate (page count: ${validation.pageCount ?? 'unavailable'}).`;
      return this.fallbackToPdfLibWorker(
        files,
        onProgress,
        knownPageCounts,
        options,
        inputBytes,
        inputPageCount,
        started,
        reason
      );
    } catch (error) {
      if (this.isCancellation(error)) {
        this.pilotService.record({
          schemaVersion: 1,
          recordedAt: new Date().toISOString(),
          outcome: 'cancelled',
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          qpdfAttempted,
          qpdfSucceeded: false,
          fallbackUsed: false,
          hardFidelityPassed: null,
          elapsedMs: performance.now() - started,
          failureCode: 'cancelled'
        });
        this.lastRoutingOutcome = 'cancelled';
        throw new MergeCancelledError();
      }

      const reason = this.toFailureMessage(error);
      return this.fallbackToPdfLibWorker(
        files,
        onProgress,
        knownPageCounts,
        options,
        inputBytes,
        inputPageCount,
        started,
        reason
      );
    }
  }

  private async fallbackToPdfLibWorker(
    files: File[],
    onProgress: ((progress: number) => void) | undefined,
    knownPageCounts: readonly number[],
    options: QpdfProductionMergeOptions,
    inputBytes: number,
    inputPageCount: number | null,
    started: number,
    qpdfFailureReason: string
  ): Promise<File> {
    this.throwIfCancelled();
    options.onStage?.('fallback', 'qpdf pilot did not pass; using the existing pdf-lib Worker.');

    try {
      const result = await this.mergeWithPdfLibWorker(
        files,
        progress => onProgress?.(78 + Math.round(progress * 0.22)),
        knownPageCounts,
        options
      );

      this.pilotService.record({
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        outcome: 'pdf-lib-fallback',
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        qpdfAttempted: true,
        qpdfSucceeded: false,
        fallbackUsed: true,
        hardFidelityPassed: true,
        elapsedMs: performance.now() - started,
        failureCode: this.classifyFailure(qpdfFailureReason),
        note: 'qpdf pilot failed or failed hard validation; existing pdf-lib Worker completed the merge.'
      });

      this.lastRoutingOutcome = 'pdf-lib-fallback';
      onProgress?.(100);
      return result;
    } catch (error) {
      if (this.isCancellation(error)) {
        this.pilotService.record({
          schemaVersion: 1,
          recordedAt: new Date().toISOString(),
          outcome: 'cancelled',
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          qpdfAttempted: true,
          qpdfSucceeded: false,
          fallbackUsed: true,
          hardFidelityPassed: null,
          elapsedMs: performance.now() - started,
          failureCode: 'fallback-cancelled'
        });
        this.lastRoutingOutcome = 'cancelled';
        throw new MergeCancelledError();
      }

      this.pilotService.record({
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        outcome: 'failed',
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        qpdfAttempted: true,
        qpdfSucceeded: false,
        fallbackUsed: true,
        hardFidelityPassed: false,
        elapsedMs: performance.now() - started,
        failureCode: 'qpdf-and-pdf-lib-failed',
        note: `qpdf: ${qpdfFailureReason}; fallback: ${this.toFailureMessage(error)}`
      });
      this.lastRoutingOutcome = 'failed';
      throw error;
    }
  }

  private mergeWithPdfLibWorker(
    files: File[],
    onProgress: ((progress: number) => void) | undefined,
    knownPageCounts: readonly number[],
    options: QpdfProductionMergeOptions
  ): Promise<File> {
    return this.mergeEngine.merge(
      files,
      onProgress,
      knownPageCounts,
      { executionMode: 'worker', onStage: options.onStage }
    );
  }

  private async validateOutput(file: File): Promise<{
    parseable: boolean;
    pageCount: number | null;
    errorMessage?: string;
  }> {
    try {
      const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      return {
        parseable: true,
        pageCount: document.getPageCount()
      };
    } catch (error) {
      return {
        parseable: false,
        pageCount: null,
        errorMessage: this.toFailureMessage(error)
      };
    }
  }

  private isFallbackOutcome(outcome: QpdfProductionRoutingObservedOutcome): boolean {
    return outcome === 'pdf-lib-fallback';
  }

  private isQpdfSuccessOutcome(outcome: QpdfProductionRoutingObservedOutcome): boolean {
    return outcome === 'qpdf-success';
  }

  private getKnownPageCount(pageCounts: readonly number[]): number | null {
    if (pageCounts.length === 0 || pageCounts.some(count => count <= 0)) return null;
    return pageCounts.reduce((sum, count) => sum + count, 0);
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new QpdfPrototypeCancelledError();
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof QpdfPrototypeCancelledError ||
      error instanceof MergeCancelledError ||
      this.cancelled;
  }

  private toFailureMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'qpdf pilot failed.';
  }

  private classifyFailure(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('password') || normalized.includes('encrypted')) return 'encrypted-input';
    if (normalized.includes('parse') || normalized.includes('invalid') || normalized.includes('malformed')) return 'invalid-pdf';
    if (normalized.includes('memory') || normalized.includes('out of')) return 'resource-failure';
    return 'qpdf-failed';
  }
}

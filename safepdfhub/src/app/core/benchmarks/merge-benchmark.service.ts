import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import { MergeEngine } from '../engines/merge.engine';
import {
  MergeBenchmarkCase,
  MergeBenchmarkComparison,
  MergeBenchmarkExecutionMode,
  MergeBenchmarkReport,
  MergeBenchmarkRun
} from './merge-benchmark.types';

@Injectable({ providedIn: 'root' })
export class MergeBenchmarkService {
  constructor(
    private readonly mergeEngine: MergeEngine,
    private readonly capabilityService: LocalProcessingCapabilityService
  ) {}

  async run(cases: readonly MergeBenchmarkCase[]): Promise<MergeBenchmarkReport> {
    const startedAt = new Date().toISOString();
    const comparisons: MergeBenchmarkComparison[] = [];

    for (const benchmarkCase of cases) {
      const modes: MergeBenchmarkExecutionMode[] = typeof Worker === 'undefined'
        ? ['main']
        : ['main', 'worker'];

      const runs = new Map<MergeBenchmarkExecutionMode, MergeBenchmarkRun>();
      for (const mode of modes) {
        runs.set(mode, await this.runCase(benchmarkCase, mode));
      }

      const main = runs.get('main');
      const worker = runs.get('worker');
      comparisons.push({
        caseId: benchmarkCase.id,
        caseLabel: benchmarkCase.label,
        main,
        worker,
        workerSpeedup: main?.success && worker?.success && worker.elapsedMs > 0
          ? main.elapsedMs / worker.elapsedMs
          : undefined,
        workerMainThreadGapReduction: main?.success && worker?.success && main.maxMainThreadGapMs > 0
          ? 1 - (worker.maxMainThreadGapMs / main.maxMainThreadGapMs)
          : undefined,
        outputEquivalent: main?.success && worker?.success
          ? main.outputBytes === worker.outputBytes && main.outputPages === worker.outputPages
          : undefined
      });
    }

    const completedAt = new Date().toISOString();
    const successfulRuns = comparisons.flatMap(c => [c.main, c.worker]).filter((r): r is MergeBenchmarkRun => !!r && r.success);
    const allSuccessful = comparisons.every(c => !!c.worker?.success && !!c.main?.success);
    const outputsEquivalent = comparisons.every(c => c.outputEquivalent !== false);

    // Phase 0C intentionally does not auto-promote public capacity. Promotion requires
    // repeated real-device evidence reviewed against the documented acceptance criteria.
    const capacityPromotionEligible = allSuccessful && outputsEquivalent && successfulRuns.length > 0 &&
      successfulRuns.every(r => Number.isFinite(r.elapsedMs) && Number.isFinite(r.maxMainThreadGapMs));

    return {
      startedAt,
      completedAt,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      deviceMemoryGiB: this.readDeviceMemory(),
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
      currentBudget: {
        maxFileBytes: this.capabilityService.budget.maxFileBytes,
        maxTotalBytes: this.capabilityService.budget.maxTotalBytes,
        maxFiles: this.capabilityService.budget.maxFiles,
        maxPages: this.capabilityService.budget.maxPages
      },
      comparisons,
      capacityPromotionEligible,
      capacityDecision: capacityPromotionEligible ? 'insufficient-evidence' : 'retain-current-ceiling',
      decisionReason: capacityPromotionEligible
        ? 'A local benchmark completed successfully, but one run on one device is not sufficient evidence to raise public capacity. Repeat across representative devices and PDF complexity classes.'
        : 'Keep the existing conservative capacity ceiling until representative benchmark runs demonstrate stable success, output fidelity, and acceptable responsiveness.'
    };
  }

  private async runCase(benchmarkCase: MergeBenchmarkCase, mode: MergeBenchmarkExecutionMode): Promise<MergeBenchmarkRun> {
    const inputBytes = benchmarkCase.files.reduce((sum, file) => sum + file.size, 0);
    const inputPages = this.resolvePageCount(benchmarkCase.pageCounts);
    const complexity = benchmarkCase.complexity ?? 'unknown';
    let heartbeatLast = performance.now();
    let maxGap = 0;
    let timer: number | null = null;
    if (typeof window !== 'undefined') {
      timer = window.setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - heartbeatLast);
        heartbeatLast = now;
      }, 25);
    }

    const started = performance.now();
    try {
      const result = await this.mergeEngine.merge(
        benchmarkCase.files,
        undefined,
        benchmarkCase.pageCounts ?? [],
        { executionMode: mode }
      );
      const elapsedMs = performance.now() - started;
      const outputBytes = result.size;
      const outputPages = await this.readOutputPageCount(result);
      return {
        caseId: benchmarkCase.id,
        caseLabel: benchmarkCase.label,
        executionMode: mode,
        inputBytes,
        inputPages,
        outputBytes,
        outputPages,
        elapsedMs,
        throughputMiBPerSecond: elapsedMs > 0 ? (inputBytes / (1024 * 1024)) / (elapsedMs / 1000) : 0,
        pagesPerSecond: inputPages !== null && elapsedMs > 0 ? inputPages / (elapsedMs / 1000) : null,
        maxMainThreadGapMs: maxGap,
        workerSupported: typeof Worker !== 'undefined',
        success: true,
        complexity
      };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      return {
        caseId: benchmarkCase.id,
        caseLabel: benchmarkCase.label,
        executionMode: mode,
        inputBytes,
        inputPages,
        outputBytes: null,
        outputPages: null,
        elapsedMs,
        throughputMiBPerSecond: 0,
        pagesPerSecond: null,
        maxMainThreadGapMs: maxGap,
        workerSupported: typeof Worker !== 'undefined',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown benchmark failure.',
        complexity
      };
    } finally {
      if (timer !== null) window.clearInterval(timer);
    }
  }

  private resolvePageCount(pageCounts?: readonly number[]): number | null {
    if (!pageCounts || pageCounts.length === 0 || pageCounts.some(p => !Number.isFinite(p) || p <= 0)) return null;
    return pageCounts.reduce((sum, pages) => sum + pages, 0);
  }

  private async readOutputPageCount(file: File): Promise<number> {
    const bytes = await file.arrayBuffer();
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    return document.getPageCount();
  }

  private readDeviceMemory(): number | null {
    if (typeof navigator === 'undefined') return null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null;
  }
}

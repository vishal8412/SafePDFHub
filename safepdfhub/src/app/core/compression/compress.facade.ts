import { LargeCompressionService } from './large/large-compression.service';
import { LARGE_COMPRESSION_THRESHOLD } from './large/large-compression-policy';
import { Injectable, isDevMode, Optional } from '@angular/core';
import { CompressionState } from './compression.state';
import { CompressEngine } from '../engines/compress.engine';
import { CompressionEstimate, CompressionResult } from './compression.models';
import { CompressionPlanner } from './compression-planner';
import { PdfAnalyzer } from './pdf-analyzer.service';
import { PdfFileAnalysis } from './pdf-analysis.models';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';

@Injectable({ providedIn: 'root' })
export class CompressionFacade {
  private readonly analysisCache = new WeakMap<File, PdfFileAnalysis>();
  private activeAnalysisAbortController: AbortController | null = null;

  constructor(
    private readonly pdfAnalyzer: PdfAnalyzer,
    private readonly compressEngine: CompressEngine,
    private readonly compressionPlanner: CompressionPlanner,
    public readonly state: CompressionState,
    @Optional() private readonly large?: LargeCompressionService,
  ) {}

  async analyze(file: File): Promise<CompressionEstimate> {
    if (this.state.compressing) return {
      estimatedReduction: this.state.estimatedReduction,
      estimatedFinalSize: this.state.estimatedFinalSize,
    };
    if (file.size > LARGE_COMPRESSION_THRESHOLD) {
      if (!this.large) throw new Error('Large-file compression is unavailable.');
      this.large.capability.assertFile(file);
      this.activeAnalysisAbortController?.abort();
      this.state.analysisResult = null;
      this.state.pdfInsights = null;
      this.state.analyzedPdfType = null;
      this.state.estimatedReduction = 0;
      this.state.estimatedFinalSize = 0;
      this.state.stage = 'analysis';
      return { estimatedReduction: 0, estimatedFinalSize: 0 };
    }
    this.activeAnalysisAbortController?.abort();
    const controller = new AbortController();
    this.activeAnalysisAbortController = controller;

    try {
      const result = await this.getAnalysis(file, controller.signal);
      throwIfCompressionCancelled(controller.signal);
      const sizeMB = file.size / 1024 / 1024;
      const plan = this.compressionPlanner.createPlan(
        result.analysis,
        result.pages,
        this.state.compressionLevel,
      );

      this.state.analyzedPdfType = result.type;
      this.state.pdfInsights = result.analysis;
      this.state.estimatedReduction = plan.estimatedReduction;
      this.state.estimatedFinalSize = Math.max(0, sizeMB * (1 - plan.estimatedReduction / 100));
      this.state.stage = 'analysis';

      return {
        estimatedReduction: plan.estimatedReduction,
        estimatedFinalSize: this.state.estimatedFinalSize,
      };
    } finally {
      if (this.activeAnalysisAbortController === controller) {
        this.activeAnalysisAbortController = null;
      }
    }
  }

  async compress(file: File): Promise<File> {
    // Snapshot settings before any asynchronous work. A run owns its settings.
    const targetMB = this.state.targetSizeMB;
    if (targetMB !== null && (!Number.isFinite(targetMB) || targetMB <= 0 || targetMB > 10000)) {
      throw new Error('Enter a target between 0 and 10,000 MB.');
    }
    const targetBytes = targetMB === null ? undefined : Math.floor(targetMB * 1_000_000);
    if (targetBytes !== undefined && targetBytes < 1) throw new Error('Target size is too small.');
    const level = targetBytes ? 'strong' : this.state.compressionLevel;
    const startedAt = performance.now();
    this.cancel();
    const analysisController = new AbortController();
    this.activeAnalysisAbortController = analysisController;
    this.state.clearResult();
    this.state.compressing = true;
    this.state.progress = 0;

    try {
      if (file.size > LARGE_COMPRESSION_THRESHOLD) {
        if (!this.large) throw new Error('Large-file compression is unavailable.');
        this.state.stage = 'optimization';
        const output = await this.large.compress(file, analysisController.signal, n => { if (!analysisController.signal.aborted) this.state.progress = n; }, { level, targetBytes });
        throwIfCompressionCancelled(analysisController.signal);
        const compressed = output.file;
        this.state.compressedFile = compressed;
        this.state.originalSize = file.size;
        this.state.finalSize = compressed.size;
        this.state.reductionBytes = Math.max(0, file.size - compressed.size);
        this.state.reduction = Math.round(this.state.reductionBytes / file.size * 10000) / 100;
        this.state.durationMs = performance.now() - startedAt;
        this.state.duration = `${(this.state.durationMs / 1000).toFixed(1)}s`;
        this.state.compressionResult = { file: compressed, targetBytes,
          targetMet: targetBytes === undefined ? undefined : compressed.size <= targetBytes,
          originalSize: file.size, finalSize: compressed.size, reductionBytes: this.state.reductionBytes,
          reduction: this.state.reduction, duration: this.state.duration, durationMs: this.state.durationMs,
          strategy: output.strategy ?? 'safe', returnedOriginal: compressed === file, pagesTotal: output.pages,
          processingNote: output.note ?? 'Disk-backed compression completed.' };
        this.state.stage = 'complete'; this.state.progress = 100;
        return compressed;
      }
      const result = await this.getAnalysis(file, analysisController.signal);
      if (analysisController.signal.aborted) {
        throw new CompressionCancelledError();
      }

      const plan = this.compressionPlanner.createPlan(
        result.analysis,
        result.pages,
        level,
      );

      this.state.compressing = true;
      this.state.progress = 0;
      plan.targetBytes = targetBytes;
      this.state.stage = 'optimization';

      try {
        const compressed = await this.compressEngine.compress(
          file,
          level,
          plan,
          result,
          (progress) => {
            if (!analysisController.signal.aborted) this.state.progress = progress;
          },
        );

        throwIfCompressionCancelled(analysisController.signal);
        this.state.compressedFile = compressed;
        this.state.originalSize = file.size;
        this.state.finalSize = compressed.size;
        this.state.reduction = Math.max(
          0,
          Math.round(((file.size - compressed.size) / file.size) * 10000) / 100,
        );
        this.state.durationMs = performance.now() - startedAt;
        this.state.duration = `${(this.state.durationMs / 1000).toFixed(1)}s`;

        const reductionBytes = Math.max(0, file.size - compressed.size);
        const compressionResult: CompressionResult = {
          file: compressed,
          targetBytes,
          targetMet: targetBytes === undefined ? undefined : compressed.size <= targetBytes,
          originalSize: file.size,
          finalSize: compressed.size,
          reductionBytes,
          reduction: this.state.reduction,
          duration: this.state.duration,
          durationMs: this.state.durationMs,
          strategy: plan.strategy,
          returnedOriginal: compressed === file,
          pagesTotal: result.pages,
          telemetry: this.compressEngine.lastExecutionTelemetry ?? undefined,
        };

        this.state.reductionBytes = reductionBytes;
        this.state.compressionResult = compressionResult;

        // Browser acceptance harness hook. This is development-only, contains
        // no PDF bytes, and exposes only the existing privacy-safe telemetry
        // needed to correlate the downloaded artifact with candidate lineage.
        if (isDevMode() && compressionResult.telemetry) {
          console.info('[SafePDFHub Compression Benchmark]', compressionResult.telemetry);
        }

        this.state.stage = 'complete';
        return compressed;
      } finally {
        if (this.activeAnalysisAbortController === analysisController) {
          this.compressEngine.cancel();
          this.state.compressing = false;
          this.state.progress = this.state.stage === 'complete' ? 100 : 0;
        }
      }
    } finally {
      if (this.activeAnalysisAbortController === analysisController) {
        this.activeAnalysisAbortController = null;
        this.state.compressing = false;
        if (this.state.stage !== 'complete') this.state.progress = 0;
      }
    }
  }

  retainLargeResultForDownload(): void { this.large?.retainForDownload(); }

  async saveLargeResult(): Promise<boolean> {
    const file = this.state.compressedFile;
    return this.large && file && this.state.compressionResult?.processingNote
      ? this.large.save(file) : false;
  }

  cancel(): void {
    this.large?.cancel();
    this.activeAnalysisAbortController?.abort();
    this.activeAnalysisAbortController = null;
    this.compressEngine.cancel();
    this.state.compressing = false;
    this.state.progress = 0;
    this.state.stage = this.state.analysisResult ? 'analysis' : 'idle';
  }

  isCancellation(error: unknown): boolean {
    return error instanceof CompressionCancelledError ||
      (error instanceof Error && error.name === 'CompressionCancelledError');
  }

  reset(): void {
    this.cancel();
    void this.large?.release();
    this.state.reset();
  }

  invalidate(file?: File): void {
    if (file) this.analysisCache.delete(file);
    this.state.analysisResult = null;
  }

  private async getAnalysis(file: File, signal?: AbortSignal): Promise<PdfFileAnalysis> {
    const cached = this.analysisCache.get(file);
    throwIfCompressionCancelled(signal);
    if (cached) {
      this.state.analysisResult = cached;
      return cached;
    }

    const result = await this.pdfAnalyzer.analyzeFile(file, signal);
    throwIfCompressionCancelled(signal);
    this.analysisCache.set(file, result);
    this.state.analysisResult = result;
    return result;
  }
}

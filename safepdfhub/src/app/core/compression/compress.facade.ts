import { Injectable } from '@angular/core';
import { CompressionState } from './compression.state';
import { CompressEngine } from '../engines/compress.engine';
import { CompressionEstimate } from './compression.models';
import { CompressionPlanner } from './compression-planner';
import { PdfAnalyzer } from './pdf-analyzer.service';
import { PdfFileAnalysis } from './pdf-analysis.models';

@Injectable({ providedIn: 'root' })
export class CompressionFacade {
  private readonly analysisCache = new WeakMap<File, PdfFileAnalysis>();

  constructor(
    private readonly pdfAnalyzer: PdfAnalyzer,
    private readonly compressEngine: CompressEngine,
    private readonly compressionPlanner: CompressionPlanner,
    public readonly state: CompressionState,
  ) {}

  async analyze(file: File): Promise<CompressionEstimate> {
    const result = await this.getAnalysis(file);
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
  }

  async compress(file: File): Promise<File> {
    const startedAt = performance.now();
    const result = await this.getAnalysis(file);
    const plan = this.compressionPlanner.createPlan(
      result.analysis,
      result.pages,
      this.state.compressionLevel,
    );

    this.state.compressing = true;
    this.state.progress = 0;
    this.state.stage = 'optimization';

    try {
      const compressed = await this.compressEngine.compress(
        file,
        this.state.compressionLevel,
        plan,
        result,
        (progress) => {
          this.state.progress = progress;
        },
      );

      this.state.compressedFile = compressed;
      this.state.originalSize = file.size;
      this.state.finalSize = compressed.size;
      this.state.reduction = Math.max(
        0,
        Math.round(((file.size - compressed.size) / file.size) * 100),
      );
      this.state.duration = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
      this.state.estimatedFinalSize = compressed.size / 1024 / 1024;
      this.state.estimatedReduction = this.state.reduction;
      this.state.stage = 'complete';
      return compressed;
    } finally {
      this.state.compressing = false;
      this.state.progress = 100;
    }
  }

  reset(): void {
    this.state.reset();
  }

  invalidate(file?: File): void {
    if (file) this.analysisCache.delete(file);
    this.state.analysisResult = null;
  }

  private async getAnalysis(file: File): Promise<PdfFileAnalysis> {
    const cached = this.analysisCache.get(file);
    if (cached) {
      this.state.analysisResult = cached;
      return cached;
    }

    const result = await this.pdfAnalyzer.analyzeFile(file);
    this.analysisCache.set(file, result);
    this.state.analysisResult = result;
    return result;
  }
}

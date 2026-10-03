import { Injectable, signal } from '@angular/core';
import { CompressionLevel, CompressionStage } from './compression.types';
import { PdfFileAnalysis } from './pdf-analysis.models';
import { CompressionAnalysis, CompressionResult } from './compression.models';

@Injectable({
  providedIn: 'root'
})
export class CompressionState {

  private readonly compressionLevelValue = signal<CompressionLevel>('recommended');
  get compressionLevel(): CompressionLevel { return this.compressionLevelValue(); }
  set compressionLevel(value: CompressionLevel) { this.compressionLevelValue.set(value); }

  private readonly targetSizeMBValue = signal<number | null>(null);
  get targetSizeMB(): number | null { return this.targetSizeMBValue(); }
  set targetSizeMB(value: number | null) { this.targetSizeMBValue.set(value); }

  /** Planner-only values. They must remain estimates throughout the lifecycle. */
  private readonly estimatedReductionValue = signal<number>(0);
  get estimatedReduction(): number { return this.estimatedReductionValue(); }
  set estimatedReduction(value: number) { this.estimatedReductionValue.set(value); }
  private readonly estimatedFinalSizeValue = signal<number>(0);
  get estimatedFinalSize(): number { return this.estimatedFinalSizeValue(); }
  set estimatedFinalSize(value: number) { this.estimatedFinalSizeValue.set(value); }

  /** Authoritative post-execution values. */
  private readonly originalSizeValue = signal<number>(0);
  get originalSize(): number { return this.originalSizeValue(); }
  set originalSize(value: number) { this.originalSizeValue.set(value); }
  private readonly finalSizeValue = signal<number>(0);
  get finalSize(): number { return this.finalSizeValue(); }
  set finalSize(value: number) { this.finalSizeValue.set(value); }
  private readonly reductionBytesValue = signal<number>(0);
  get reductionBytes(): number { return this.reductionBytesValue(); }
  set reductionBytes(value: number) { this.reductionBytesValue.set(value); }
  private readonly reductionValue = signal<number>(0);
  get reduction(): number { return this.reductionValue(); }
  set reduction(value: number) { this.reductionValue.set(value); }
  private readonly compressionResultValue = signal<CompressionResult | null>(null);
  get compressionResult(): CompressionResult | null { return this.compressionResultValue(); }
  set compressionResult(value: CompressionResult | null) { this.compressionResultValue.set(value); }

  private readonly analyzedPdfTypeValue = signal<'text' | 'mixed' | 'scanned' | null>(null);
  get analyzedPdfType(): 'text' | 'mixed' | 'scanned' | null { return this.analyzedPdfTypeValue(); }
  set analyzedPdfType(value: 'text' | 'mixed' | 'scanned' | null) { this.analyzedPdfTypeValue.set(value); }
  private readonly pdfInsightsValue = signal<CompressionAnalysis | null>(null);
  get pdfInsights(): CompressionAnalysis | null { return this.pdfInsightsValue(); }
  set pdfInsights(value: CompressionAnalysis | null) { this.pdfInsightsValue.set(value); }
  private readonly compressingValue = signal<boolean>(false);
  get compressing(): boolean { return this.compressingValue(); }
  set compressing(value: boolean) { this.compressingValue.set(value); }
  private readonly progressValue = signal<number>(0);
  get progress(): number { return this.progressValue(); }
  set progress(value: number) { this.progressValue.set(value); }
  private readonly stageValue = signal<CompressionStage>('idle');
  get stage(): CompressionStage { return this.stageValue(); }
  set stage(value: CompressionStage) { this.stageValue.set(value); }
  private readonly compressedFileValue = signal<File | null>(null);
  get compressedFile(): File | null { return this.compressedFileValue(); }
  set compressedFile(value: File | null) { this.compressedFileValue.set(value); }
  private readonly durationValue = signal<string>('');
  get duration(): string { return this.durationValue(); }
  set duration(value: string) { this.durationValue.set(value); }
  private readonly durationMsValue = signal<number>(0);
  get durationMs(): number { return this.durationMsValue(); }
  set durationMs(value: number) { this.durationMsValue.set(value); }
  private readonly showResultValue = signal<boolean>(false);
  get showResult(): boolean { return this.showResultValue(); }
  set showResult(value: boolean) { this.showResultValue.set(value); }
  private readonly showCompressResultValue = signal<boolean>(false);
  get showCompressResult(): boolean { return this.showCompressResultValue(); }
  set showCompressResult(value: boolean) { this.showCompressResultValue.set(value); }
  private readonly analysisResultValue = signal<PdfFileAnalysis | null>(null);
  get analysisResult(): PdfFileAnalysis | null { return this.analysisResultValue(); }
  set analysisResult(value: PdfFileAnalysis | null) { this.analysisResultValue.set(value); }

  clearResult(): void {
    this.compressedFile = null;
    this.originalSize = 0;
    this.finalSize = 0;
    this.reductionBytes = 0;
    this.reduction = 0;
    this.compressionResult = null;
    this.duration = '';
    this.durationMs = 0;
    this.showResult = false;
    this.showCompressResult = false;
    this.stage = this.analysisResult ? 'analysis' : 'idle';
  }

  reset(): void {
    this.compressionLevel = 'recommended';
    this.targetSizeMB = null;
    this.estimatedReduction = 0;
    this.estimatedFinalSize = 0;
    this.analyzedPdfType = null;
    this.pdfInsights = null;
    this.compressing = false;
    this.progress = 0;
    this.stage = 'idle';
    this.compressedFile = null;
    this.originalSize = 0;
    this.finalSize = 0;
    this.reductionBytes = 0;
    this.reduction = 0;
    this.compressionResult = null;
    this.duration = '';
    this.durationMs = 0;
    this.showResult = false;
    this.showCompressResult = false;
    this.analysisResult = null;
  }

}

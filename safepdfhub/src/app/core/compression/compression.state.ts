import { Injectable } from '@angular/core';
import { CompressionLevel, CompressionStage } from './compression.types';
import { CompressionAnalysis } from './compression.models';
@Injectable({
  providedIn: 'root'
})
export class CompressionState {

    compressionLevel: CompressionLevel = 'recommended';
    estimatedReduction = 0;
    estimatedFinalSize = 0;
    analyzedPdfType: 'text' | 'mixed' | 'scanned' | null = null;
    pdfInsights: CompressionAnalysis | null = null;
    compressing = false;
    progress = 0;
    stage: CompressionStage = 'idle';
    compressedFile: File | null = null;
    originalSize = 0;
    finalSize = 0;
    reduction = 0;
    duration = '';
    showResult = false;
    showCompressResult = false;

    reset(): void {
    this.compressionLevel = 'recommended';
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
    this.reduction = 0;
    this.duration = '';
    this.showResult = false;
    this.showCompressResult = false;
}

}

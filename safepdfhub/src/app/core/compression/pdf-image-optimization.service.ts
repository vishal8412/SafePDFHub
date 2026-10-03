import { Injectable } from '@angular/core';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';
import { PDFDocument } from 'pdf-lib';
import { PdfForensicAnalysis } from './pdf-forensic.models';
import {
  PdfImageOptimizationCandidate,
  PdfImageOptimizationResult,
  PdfImageOptimizationRisk,
} from './pdf-image-optimization.models';
import { QpdfStructuralCandidateError, QpdfWasmPrototypeService } from '../qpdf/qpdf-wasm-prototype.service';
import { PdfVisualFidelityService } from './pdf-visual-fidelity.service';
import { PdfSemanticIntegrityService } from './pdf-semantic-integrity.service';
import { QpdfWasmResourceGuardService } from '../qpdf/qpdf-wasm-resource-guard.service';

@Injectable({ providedIn: 'root' })
export class PdfImageOptimizationService {
  constructor(
    private readonly qpdf: QpdfWasmPrototypeService,
    private readonly visualFidelity: PdfVisualFidelityService,
    private readonly semanticIntegrity: PdfSemanticIntegrityService,
    private readonly qpdfResourceGuard: QpdfWasmResourceGuardService,
  ) {}

  /**
   * V2.3 adaptive image-resource optimization with the V2.4 visual-fidelity guard.
   *
   * This phase never rasterizes a page. It asks qpdf to optimize embedded image
   * resources at a small, forensic-driven quality ladder and keeps only the
   * smallest independently validated result. Quality is a candidate parameter,
   * never a promised reduction.
   */
  async optimize(
    file: File,
    forensic: PdfForensicAnalysis | undefined,
    level: 'light' | 'recommended' | 'strong',
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    pageCount = forensic?.pageCount ?? 0,
  ): Promise<PdfImageOptimizationResult> {
    const risk = this.classifyRisk(file, forensic);
    const qpdfProfile = this.qpdfResourceGuard.profile(file.size, pageCount, forensic);
    const decision = qpdfProfile.allowImageOptimization
      ? this.selectQualities(forensic, risk, level)
      : {
          eligible: false,
          reason: qpdfProfile.reason ?? 'qpdf WASM memory guard disabled image optimization.',
          qualities: [],
        };

    if (!decision.eligible) {
      onProgress?.(100);
      return {
        inputBytes: file.size,
        risk,
        eligible: false,
        skippedReason: decision.reason,
        attemptedQualities: [],
        candidates: [],
        selected: null,
      };
    }

    const candidates: PdfImageOptimizationCandidate[] = [];
    onProgress?.(3);

    for (let index = 0; index < decision.qualities.length; index += 1) {
      throwIfCompressionCancelled(signal);
      const quality = decision.qualities[index];
      const start = performance.now();

      try {
        const output = await this.qpdf.optimizeImageCandidate(
          file,
          quality,
          undefined,
          qpdfProfile.optimizationProfile,
        );
        if (output && output.size > 0) {
          const structuralValid = await this.validateCandidate(file, output);
          const visualFidelity = structuralValid
            ? await this.visualFidelity.validate(file, output, forensic, level)
            : null;
          const semanticIntegrity = structuralValid && visualFidelity?.status === 'passed'
            ? await this.semanticIntegrity.validate(file, output, forensic)
            : null;
          const valid = structuralValid &&
            (visualFidelity?.status === 'passed') &&
            (semanticIntegrity?.status === 'passed');
          const reductionBytes = Math.max(0, file.size - output.size);
          candidates.push({
            quality,
            file: output,
            inputBytes: file.size,
            outputBytes: output.size,
            reductionBytes,
            reductionPercent: file.size > 0
              ? (reductionBytes / file.size) * 100
              : 0,
            valid,
            visualFidelity,
            semanticIntegrity,
            durationMs: performance.now() - start,
          });
        }
      } catch (error) {
        if (signal?.aborted || error instanceof CompressionCancelledError) throw error;
        // A qpdf runtime failure is a worker/runtime boundary, not a quality-
        // specific miss. Stop the remaining qpdf image ladder immediately and
        // let the non-qpdf pipeline continue. This prevents repeated expensive
        // runner creation after an OOM or unhealthy qpdf worker.
        if (error instanceof QpdfStructuralCandidateError &&
            (error.reason === 'QPDF_MEMORY_EXHAUSTED' ||
             error.reason === 'QPDF_RUN_FAILED' ||
             error.reason === 'QPDF_RUNNER_CREATE_FAILED')) {
          break;
        }
        // Image optimization is an optional candidate phase. A single quality
        // failure must never prevent the existing compression pipeline from continuing.
      }

      onProgress?.(
        5 + Math.round(((index + 1) / decision.qualities.length) * 90),
      );
    }

    const selected = candidates
      .filter(candidate => candidate.valid && candidate.outputBytes < file.size)
      .sort((a, b) => a.outputBytes - b.outputBytes)[0] ?? null;

    onProgress?.(100);

    return {
      inputBytes: file.size,
      risk,
      eligible: true,
      skippedReason: null,
      attemptedQualities: decision.qualities,
      candidates,
      selected,
    };
  }

  private classifyRisk(
    file: File,
    forensic: PdfForensicAnalysis | undefined,
  ): PdfImageOptimizationRisk {
    if (!forensic || forensic.uniqueImageResourceCount <= 0 || forensic.imageBytes <= 0) {
      return 'none';
    }

    const imageShare = forensic.imageBytes / Math.max(1, file.size);
    const areaRatio = forensic.sampledImageAreaRatio;
    const nonJpegImageCount = forensic.imageResources.filter(
      image => !this.isJpegFilter(image.filter),
    ).length;

    if (nonJpegImageCount === 0) return 'low';
    if (imageShare >= 0.35 || areaRatio >= 0.40) return 'high';
    if (imageShare >= 0.15 || areaRatio >= 0.25) return 'medium';
    return 'low';
  }

  private selectQualities(
    forensic: PdfForensicAnalysis | undefined,
    risk: PdfImageOptimizationRisk,
    level: 'light' | 'recommended' | 'strong',
  ): { eligible: boolean; reason: string | null; qualities: number[] } {
    if (!forensic || forensic.uniqueImageResourceCount <= 0 || forensic.imageBytes <= 0) {
      return {
        eligible: false,
        reason: 'No embedded image resources were detected by the forensic analyzer.',
        qualities: [],
      };
    }

    const optimizableImages = forensic.imageResources.filter(
      image => !this.isJpegFilter(image.filter),
    );

    if (optimizableImages.length === 0) {
      return {
        eligible: false,
        reason: 'All detected image resources are already JPEG/DCT resources.',
        qualities: [],
      };
    }

    const qualities = this.qualityLadder(level, risk);
    return {
      eligible: qualities.length > 0,
      reason: null,
      qualities,
    };
  }

  private qualityLadder(
    level: 'light' | 'recommended' | 'strong',
    risk: PdfImageOptimizationRisk,
  ): number[] {
    switch (level) {
      case 'light':
        return risk === 'high' ? [90, 84] : [92, 88];
      case 'recommended':
        return risk === 'high' ? [84, 76, 68] : [88, 80, 72];
      case 'strong':
        return risk === 'high' ? [78, 68, 58] : [84, 74, 64];
    }
  }

  private isJpegFilter(filter: string | null): boolean {
    if (!filter) return false;
    return filter
      .split(',')
      .map(value => value.trim().replace(/^\//, ''))
      .some(value => value === 'DCTDecode' || value === 'DCT');
  }

  private async validateCandidate(source: File, candidate: File): Promise<boolean> {
    try {
      const [sourceBytes, candidateBytes] = await Promise.all([
        source.arrayBuffer(),
        candidate.arrayBuffer(),
      ]);

      const sourcePdf = await PDFDocument.load(sourceBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      const outputPdf = await PDFDocument.load(candidateBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });

      try {
        if (sourcePdf.getPageCount() !== outputPdf.getPageCount()) return false;

        const sourcePages = sourcePdf.getPages();
        const outputPages = outputPdf.getPages();

        for (let index = 0; index < sourcePages.length; index += 1) {
          const sourcePage = sourcePages[index];
          const outputPage = outputPages[index];
          const sourceRotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
          const outputRotation = ((outputPage.getRotation().angle % 360) + 360) % 360;

          if (
            Math.abs(sourcePage.getWidth() - outputPage.getWidth()) > 0.01 ||
            Math.abs(sourcePage.getHeight() - outputPage.getHeight()) > 0.01 ||
            sourceRotation !== outputRotation
          ) {
            return false;
          }
        }

        return true;
      } finally {
        sourcePdf.flush?.();
        outputPdf.flush?.();
      }
    } catch {
      return false;
    }
  }
}

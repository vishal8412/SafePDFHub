import { Injectable } from '@angular/core';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';
import { PDFDocument } from 'pdf-lib';
import { PdfForensicAnalysis } from './pdf-forensic.models';
import {
  PdfStructuralCandidate,
  PdfStructuralCandidateDiagnostic,
  PdfStructuralCandidateKind,
  PdfQpdfAttemptDecision,
  PdfQpdfResourceSignalProvenance,
  PdfQpdfResourceSignalStatus,
  PdfStructuralOptimizationResult,
} from './pdf-structural-optimization.models';
import { QpdfStructuralCandidateError, QpdfWasmPrototypeService } from '../qpdf/qpdf-wasm-prototype.service';
import { PdfSemanticIntegrityService } from './pdf-semantic-integrity.service';
import { PdfStructuralValidationResult } from './pdf-structural-validation.models';
import { QpdfWasmResourceGuardService } from '../qpdf/qpdf-wasm-resource-guard.service';

@Injectable({ providedIn: 'root' })
export class PdfStructuralOptimizationService {
  constructor(
    private readonly qpdf: QpdfWasmPrototypeService,
    private readonly semanticIntegrity: PdfSemanticIntegrityService,
    private readonly qpdfResourceGuard: QpdfWasmResourceGuardService,
  ) {}

  /**
   * V2.2 structural optimization.
   *
   * This phase never rasterizes pages and never replaces native text/vector
   * content with images. Each structural transformation is isolated into a
   * candidate, validated, and compared using the actual output byte length.
   *
   * Forensic findings are used only to decide which candidates are worth
   * attempting. A forensic estimate is never presented as an actual saving.
   */
  async optimize(
    file: File,
    forensic: PdfForensicAnalysis | undefined,
    level: 'light' | 'recommended' | 'strong',
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    pageCount = forensic?.pageCount ?? 0,
  ): Promise<PdfStructuralOptimizationResult> {
    const resourceProfile = this.qpdfResourceGuard.profile(file.size, pageCount, forensic);
    const resourceSignals = {
      fileBytes: file.size,
      pages: pageCount,
      streamBytes: forensic?.streamBytes ?? 0,
      imageBytes: forensic?.imageBytes ?? 0,
      objectCount: forensic?.objectCount ?? 0,
    };
    const resourceSignalProvenance: PdfQpdfResourceSignalProvenance = {
      source: forensic ? 'forensic-analyzer' : 'input-metadata',
      partial: forensic?.partial ?? null,
      fileBytes: this.signalStatus(resourceSignals.fileBytes),
      pages: this.signalStatus(resourceSignals.pages),
      streamBytes: forensic && !forensic.partial ? this.signalStatus(resourceSignals.streamBytes) : 'unavailable',
      imageBytes: forensic && !forensic.partial ? this.signalStatus(resourceSignals.imageBytes) : 'unavailable',
      objectCount: forensic && !forensic.partial ? this.signalStatus(resourceSignals.objectCount) : 'unavailable',
    };
    const attemptedKinds = resourceProfile.allowPdfOutput
      ? this.selectCandidates(forensic, level, resourceProfile.maxStructuralCandidates, resourceProfile.allowImageOptimization)
      : [];
    const skippedKinds = this.allKinds().filter(kind => !attemptedKinds.includes(kind));
    const qpdfAttemptDecision: PdfQpdfAttemptDecision = resourceProfile.allowPdfOutput
      ? {
          scope: 'structural',
          state: attemptedKinds.length > 0 ? 'attempted' : 'not-attempted',
          reason: attemptedKinds.length > 0 ? 'QPDF_ATTEMPTED' : 'NO_STRUCTURAL_CANDIDATES_SELECTED',
          attemptedKinds,
          skippedKinds,
        }
      : {
          scope: 'structural',
          state: 'guard-blocked',
          reason: 'RESOURCE_GUARD_BLOCKED',
          attemptedKinds: [],
          skippedKinds,
        };
    const candidates: PdfStructuralCandidate[] = [];
    const diagnostics: PdfStructuralCandidateDiagnostic[] = [];

    if (!resourceProfile.allowPdfOutput) {
      const reason: PdfStructuralCandidateDiagnostic['reason'] = 'QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD';
      diagnostics.push(...this.allKinds().map(kind => ({
        kind,
        status: 'failed' as const,
        reason,
        inputBytes: file.size,
        outputBytes: 0,
        durationMs: 0,
        resourceRisk: resourceProfile.risk,
        optimizationProfile: resourceProfile.optimizationProfile,
        guardMessage: resourceProfile.reason,
        resourceSignals,
        resourceSignalProvenance,
      })));
      onProgress?.(100);
      return {
        inputBytes: file.size,
        selected: null,
        candidates: [],
        attemptedKinds: [],
        skippedKinds,
        forensicDriven: Boolean(forensic),
        qpdfAttemptDecision,
        diagnostics,
      };
    }

    onProgress?.(2);

    for (let index = 0; index < attemptedKinds.length; index += 1) {
      throwIfCompressionCancelled(signal);
      const kind = attemptedKinds[index];
      const start = performance.now();

      try {
        const result = await this.runCandidate(file, kind, level, forensic, pageCount, signal);
        if (result.candidate) {
          candidates.push({
            ...result.candidate,
            durationMs: performance.now() - start,
          });
          diagnostics.push({
            ...result.diagnostic,
            durationMs: performance.now() - start,
            resourceRisk: resourceProfile.risk,
            optimizationProfile: resourceProfile.optimizationProfile,
            guardMessage: resourceProfile.reason,
            resourceSignals,
            resourceSignalProvenance,
          });
        } else {
          diagnostics.push({
            ...result.diagnostic,
            durationMs: performance.now() - start,
            resourceRisk: resourceProfile.risk,
            optimizationProfile: resourceProfile.optimizationProfile,
            guardMessage: resourceProfile.reason,
            resourceSignals,
            resourceSignalProvenance,
          });
        }
      } catch (error) {
        if (signal?.aborted || error instanceof CompressionCancelledError) throw error;
        const durationMs = performance.now() - start;
        if (error instanceof QpdfStructuralCandidateError) {
          diagnostics.push({
            kind,
            status: 'failed',
            reason: error.reason,
            inputBytes: file.size,
            outputBytes: 0,
            durationMs,
            qpdfExitCode: error.result?.exitCode ?? null,
            qpdfOk: error.result?.ok ?? false,
            qpdfErrorCount: error.result?.stderr.length ?? 0,
            qpdfWarningCount: error.result?.warnings.length ?? 0,
            runtimeErrorPhase: error.runtimeError?.phase,
            runtimeErrorName: error.runtimeError?.name,
            runtimeErrorMessage: error.runtimeError?.message,
            resourceRisk: resourceProfile.risk,
            optimizationProfile: resourceProfile.optimizationProfile,
            guardMessage: resourceProfile.reason,
            resourceSignals,
            resourceSignalProvenance,
          });
          if (this.shouldStopQpdfFanOut(error.reason)) break;
        } else {
          diagnostics.push({
            kind,
            status: 'failed',
            reason: 'UNKNOWN',
            inputBytes: file.size,
            outputBytes: 0,
            durationMs,
            resourceRisk: resourceProfile.risk,
            optimizationProfile: resourceProfile.optimizationProfile,
            guardMessage: resourceProfile.reason,
            resourceSignals,
            resourceSignalProvenance,
          });
        }
      }

      onProgress?.(
        5 + Math.round(((index + 1) / attemptedKinds.length) * 90),
      );
    }

    const selected = candidates
      .filter(candidate => candidate.valid && candidate.outputBytes < file.size)
      .sort((a, b) => a.outputBytes - b.outputBytes)[0] ?? null;

    onProgress?.(100);

    return {
      inputBytes: file.size,
      selected,
      candidates,
      attemptedKinds,
      skippedKinds,
      forensicDriven: Boolean(forensic),
      qpdfAttemptDecision,
      diagnostics,
    };
  }

  private shouldStopQpdfFanOut(reason: QpdfStructuralCandidateError['reason']): boolean {
    return reason === 'QPDF_MEMORY_EXHAUSTED' ||
      reason === 'QPDF_RUN_FAILED' ||
      reason === 'QPDF_RUNNER_CREATE_FAILED' ||
      reason === 'QPDF_EXECUTION_FAILED';
  }

  private signalStatus(value: number): PdfQpdfResourceSignalStatus {
    return value === 0 ? 'measured-zero' : 'measured';
  }

  private async runCandidate(
    source: File,
    kind: PdfStructuralCandidateKind,
    level: 'light' | 'recommended' | 'strong',
    forensic: PdfForensicAnalysis | undefined,
    pageCount: number,
    signal?: AbortSignal,
  ): Promise<{
    candidate: PdfStructuralCandidate | null;
    diagnostic: PdfStructuralCandidateDiagnostic;
  }> {
    throwIfCompressionCancelled(signal);
    const jpegQuality = this.getJpegQuality(level);
    const output = await this.qpdf.optimizeStructuralCandidate(
      source,
      kind,
      jpegQuality,
      undefined,
      this.qpdfResourceGuard.profile(source.size, pageCount, forensic).optimizationProfile,
    );

    throwIfCompressionCancelled(signal);

    if (!output || output.size <= 0) {
      return {
        candidate: null,
        diagnostic: {
          kind,
          status: 'failed',
          reason: 'EMPTY_OUTPUT',
          inputBytes: source.size,
          outputBytes: output?.size ?? 0,
          durationMs: 0,
        },
      };
    }

    const structural = await this.validateCandidate(source, output, signal);
    if (!structural.valid) {
      return {
        candidate: null,
        diagnostic: {
          kind,
          status: 'rejected',
          reason: structural.reason ?? 'UNKNOWN',
          inputBytes: source.size,
          outputBytes: output.size,
          durationMs: 0,
        },
      };
    }

    throwIfCompressionCancelled(signal);
    const semanticIntegrity = await this.semanticIntegrity.validate(source, output, forensic);
    throwIfCompressionCancelled(signal);
    const valid = semanticIntegrity.status === 'passed';
    const reductionBytes = Math.max(0, source.size - output.size);

    const candidate: PdfStructuralCandidate = {
      kind,
      file: output,
      inputBytes: source.size,
      outputBytes: output.size,
      reductionBytes,
      reductionPercent: source.size > 0
        ? (reductionBytes / source.size) * 100
        : 0,
      valid,
      semanticIntegrity,
      durationMs: 0,
    };

    return {
      candidate,
      diagnostic: {
        kind,
        status: valid ? 'generated' : 'rejected',
        reason: valid && output.size < source.size
          ? undefined
          : valid
            ? 'CANDIDATE_NOT_SMALLER'
            : 'SEMANTIC_INTEGRITY_FAILED',
        inputBytes: source.size,
        outputBytes: output.size,
        durationMs: 0,
      },
    };
  }

  private selectCandidates(
    forensic: PdfForensicAnalysis | undefined,
    level: 'light' | 'recommended' | 'strong',
    maxCandidates: 0 | 1 | 2 | 3 = 3,
    allowImageOptimization = true,
  ): PdfStructuralCandidateKind[] {
    const kinds: PdfStructuralCandidateKind[] = ['baseline'];

    if (!forensic) {
      kinds.push('resource-prune-and-coalesce');
      if (level !== 'light') kinds.push('image-resource');
      return kinds;
    }

    if (
      forensic.duplicateStreamGroupCount > 0 ||
      forensic.duplicatePageContentStreamGroupCount > 0
    ) {
      kinds.push('content-coalesce');
      kinds.push('resource-prune-and-coalesce');
    } else {
      kinds.push('resource-prune');
    }

    // qpdf only keeps image recompression when it makes the image smaller.
    // It does not resample images, so this remains a bounded resource candidate.
    if (
      allowImageOptimization &&
      forensic.uniqueImageResourceCount > 0 &&
      forensic.imageBytes > 0 &&
      level !== 'light'
    ) {
      kinds.push('image-resource');
    }

    return [...new Set(kinds)].slice(0, maxCandidates);
  }

  private allKinds(): PdfStructuralCandidateKind[] {
    return [
      'baseline',
      'resource-prune',
      'content-coalesce',
      'resource-prune-and-coalesce',
      'image-resource',
    ];
  }

  private getJpegQuality(level: 'light' | 'recommended' | 'strong'): number {
    switch (level) {
      case 'light': return 88;
      case 'recommended': return 80;
      case 'strong': return 65;
    }
  }

  private async validateCandidate(
    source: File,
    candidate: File,
    signal?: AbortSignal,
  ): Promise<PdfStructuralValidationResult> {
    try {
      throwIfCompressionCancelled(signal);
      const [sourceBytes, candidateBytes] = await Promise.all([
        source.arrayBuffer(),
        candidate.arrayBuffer(),
      ]);
      throwIfCompressionCancelled(signal);

      const sourcePdf = await PDFDocument.load(sourceBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      const outputPdf = await PDFDocument.load(candidateBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });

      try {
        throwIfCompressionCancelled(signal);
        if (sourcePdf.getPageCount() !== outputPdf.getPageCount()) {
          return { valid: false, reason: 'PAGE_COUNT_MISMATCH' };
        }

        const sourcePages = sourcePdf.getPages();
        const outputPages = outputPdf.getPages();

        for (let index = 0; index < sourcePages.length; index += 1) {
          throwIfCompressionCancelled(signal);
          const sourcePage = sourcePages[index];
          const outputPage = outputPages[index];

          const sourceRotation =
            ((sourcePage.getRotation().angle % 360) + 360) % 360;
          const outputRotation =
            ((outputPage.getRotation().angle % 360) + 360) % 360;

          if (
            Math.abs(sourcePage.getWidth() - outputPage.getWidth()) > 0.01 ||
            Math.abs(sourcePage.getHeight() - outputPage.getHeight()) > 0.01
          ) {
            return { valid: false, reason: 'PAGE_GEOMETRY_MISMATCH' };
          }

          if (sourceRotation !== outputRotation) {
            return { valid: false, reason: 'PAGE_ROTATION_MISMATCH' };
          }
        }

        return { valid: true, reason: null };
      } finally {
        sourcePdf.flush?.();
        outputPdf.flush?.();
      }
    } catch (error) {
      if (error instanceof CompressionCancelledError) throw error;
      return { valid: false, reason: 'PARSE_FAILED' };
    }
  }

}

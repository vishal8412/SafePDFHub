import { LARGE_COMPRESSION_THRESHOLD } from '../compression/large/large-compression-policy';
import { PdfNativeOptimizationService } from '../compression/pdf-native-optimization.service';
import { Injectable } from '@angular/core';
import { PDFDict, PDFDocument, PDFObjectCopier, PDFPage } from 'pdf-lib';
import { PdfFileAnalysis, PageAnalysis } from '../compression/pdf-analysis.models';
import { CompressionPlan } from '../compression/compression-plan';
import { PdfAnalyzer } from '../compression/pdf-analyzer.service';
import { CompressionPlanner } from '../compression/compression-planner';
import { PdfPageRendererService } from '../compression/pdf-page-renderer.service';
import { PdfPageEmbedderService, PdfPageGeometry } from '../compression/pdf-page-embedder.service';
import { PdfCompressionWorkerService } from '../compression/pdf-compression-worker.service';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { QpdfWasmPrototypeService } from '../qpdf/qpdf-wasm-prototype.service';
import { PdfStructuralOptimizationService } from '../compression/pdf-structural-optimization.service';
import { PdfImageOptimizationService } from '../compression/pdf-image-optimization.service';
import { PdfImageOptimizationCandidate } from '../compression/pdf-image-optimization.models';
import { PdfCandidateCertificationService } from '../compression/pdf-candidate-certification.service';
import {
  CompressionCandidateStage,
  CompressionCandidateTelemetry,
  CompressionExecutionTelemetry,
} from '../compression/compression-telemetry.models';
import { CompressionCancelledError, throwIfCompressionCancelled } from '../compression/compression-cancellation';
import { CompressionResourceGuardService } from '../compression/compression-resource-guard.service';
import { QpdfWasmResourceGuardService } from '../qpdf/qpdf-wasm-resource-guard.service';
import {
  PdfQpdfAttemptDecision,
  PdfStructuralCandidateDiagnostic,
} from '../compression/pdf-structural-optimization.models';


@Injectable({ providedIn: 'root' })
export class CompressEngine {
  constructor(
    private readonly pdfAnalyzer: PdfAnalyzer,
    private readonly compressionPlanner: CompressionPlanner,
    private readonly pageRenderer: PdfPageRendererService,
    private readonly pageEmbedder: PdfPageEmbedderService,
    private readonly compressionWorker: PdfCompressionWorkerService,
    private readonly capability: LocalProcessingCapabilityService,
    private readonly pdfJsLoader: PdfJsLoaderService,
    private readonly qpdf: QpdfWasmPrototypeService,
    private readonly structuralOptimizer: PdfStructuralOptimizationService,
    private readonly imageOptimizer: PdfImageOptimizationService,
    private readonly candidateCertification: PdfCandidateCertificationService,
    private readonly resourceGuard: CompressionResourceGuardService,
    private readonly qpdfResourceGuard: QpdfWasmResourceGuardService,
    private readonly nativeOptimizer: PdfNativeOptimizationService,
  ) {}

  /**
   * V2.8 keeps candidate telemetry separate from the compression decision.
   * Telemetry never stores PDF bytes and never weakens V2.7/V2.6 certification.
   */
  private readonly nativeMetadataPreserved = new WeakSet<File>();

  lastExecutionTelemetry: CompressionExecutionTelemetry | null = null;
  private activeAbortController: AbortController | null = null;

  async compress(
    file: File,
    level: 'light' | 'recommended' | 'strong',
    plan: CompressionPlan,
    cachedAnalysis: PdfFileAnalysis,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    if (file.size > LARGE_COMPRESSION_THRESHOLD) throw new Error('Use the disk-backed compression path for this large PDF.');
    this.cancel();
    const controller = new AbortController();
    this.activeAbortController = controller;
    const signal = controller.signal;
    const executionStartedAt = performance.now();
    this.lastExecutionTelemetry = null;

    const telemetryCandidates: CompressionCandidateTelemetry[] = [];
    let structuralDiagnostics: PdfStructuralCandidateDiagnostic[] = [];
    let structuralStageEntered = false;
    let structuralStageCompleted = false;
    let structuralQpdfAttemptDecision: PdfQpdfAttemptDecision = {
      scope: 'structural',
      state: 'not-attempted',
      reason: 'STRUCTURAL_STAGE_NOT_ENTERED',
      attemptedKinds: [],
      skippedKinds: [],
    };
    const telemetryByCandidate = new Map<File, CompressionCandidateTelemetry>();
    const telemetryParentByCandidate = new Map<File, File>();
    const candidateFingerprints = new Map<File, string>();
    let lastProgress = 0;
    const emitProgress = (progress: number): void => {
      const normalized = Math.max(0, Math.min(100, Math.round(progress)));
      lastProgress = Math.max(lastProgress, normalized);
      onProgress?.(lastProgress);
    };
    const alreadyCompressed = this.detectAlreadyCompressed(file.size, cachedAnalysis.pages);

    throwIfCompressionCancelled(signal);

    if (alreadyCompressed && !plan.targetBytes && (cachedAnalysis.analysis.imageCount === 0 || file.size < 100_000)) {
      // R1.1: this is a deliberate, certified fast path. The structural qpdf
      // stage is not applicable because the source is already below the
      // per-page compression heuristic. Telemetry must distinguish this from
      // an unexplained structural-stage failure.
      structuralQpdfAttemptDecision = {
        scope: 'structural',
        state: 'not-attempted',
        reason: 'ALREADY_COMPRESSED_FAST_PATH',
        attemptedKinds: [],
        skippedKinds: [],
      };
      const startedAt = performance.now();
      let output = await this.safeCompress(file, level, emitProgress, signal);
      const normalizedFastPath = await this.prepareCandidatesForCertification(
        file,
        [output],
        telemetryByCandidate,
        telemetryParentByCandidate,
        signal,
      );
      output = normalizedFastPath[0] ?? file;
      const candidateTelemetry = this.createCandidateTelemetry(
        'strategy',
        'safe/already-compressed',
        file.size,
        output.size,
        output !== file,
        'not-certified',
        performance.now() - startedAt,
        output !== file,
      );
      telemetryCandidates.push(candidateTelemetry);
      telemetryParentByCandidate.set(output, file);

      // V2.9 hardening: the already-compressed fast path must obey the same
      // final-integrity gate as every other candidate path. A smaller safe
      // output is never selected merely because the planner classified the
      // source as already compressed.
      const certification = await this.candidateCertification.certifySmallest(
        file,
        [output],
        progress => emitProgress(progress),
        signal,
        level,
      );
      throwIfCompressionCancelled(signal);
      const evaluation = certification.evaluations[0];
      if (evaluation) {
        candidateTelemetry.candidateFingerprint = evaluation.fingerprint;
        candidateTelemetry.parentFingerprint = certification.sourceFingerprint;
        candidateTelemetry.certification = evaluation.duplicateOfFingerprint
          ? 'duplicate-skipped'
          : evaluation.result.status === 'passed'
            ? 'passed'
            : 'rejected';
        candidateTelemetry.certificationReason = evaluation.result.reason;
        candidateTelemetry.certificationPagesChecked = evaluation.result.pagesChecked;
        candidateTelemetry.certificationTotalPages = evaluation.result.totalPages;
      }

      const selected = certification.selected ?? file;
      this.lastExecutionTelemetry = this.createExecutionTelemetry(
        file,
        selected,
        executionStartedAt,
        telemetryCandidates,
        {
          candidatesConsidered: certification.candidatesConsidered,
          uniqueCandidatesCertified: certification.uniqueCandidatesCertified,
          cacheHits: certification.cacheHits,
          duplicateCandidatesSkipped: certification.duplicateCandidatesSkipped,
          durationMs: certification.durationMs,
        },
        certification.selected ? candidateTelemetry.stage : null,
        certification.selected ? candidateTelemetry.label : null,
        structuralDiagnostics,
        structuralQpdfAttemptDecision,
        false,
        false,
      );
      emitProgress(100);
      this.activeAbortController = null;
      return selected;
    }

    throwIfCompressionCancelled(signal);
    const structural = plan.targetBytes ? {
      candidates: [], selected: null, diagnostics: [], qpdfAttemptDecision: undefined,
    } : await this.structuralOptimizer.optimize(
      file,
      cachedAnalysis.forensic,
      level,
      progress => emitProgress(Math.round(progress * 0.30)),
      signal,
      cachedAnalysis.pages,
    );

    structuralStageEntered = !plan.targetBytes;
    structuralStageCompleted = !plan.targetBytes;

    for (const candidate of structural.candidates) {
      throwIfCompressionCancelled(signal);
      const telemetry = this.createCandidateTelemetry(
        'structural',
        candidate.kind,
        candidate.inputBytes,
        candidate.outputBytes,
        true,
        'not-certified',
        candidate.durationMs,
        candidate.valid,
      );
      telemetryCandidates.push(telemetry);
      telemetryByCandidate.set(candidate.file, telemetry);
      telemetryParentByCandidate.set(candidate.file, file);
    }

    structuralDiagnostics = structural.diagnostics;
    structuralQpdfAttemptDecision = structural.qpdfAttemptDecision ?? structuralQpdfAttemptDecision;
    const structuralCandidate = structural.selected?.file ?? null;
    throwIfCompressionCancelled(signal);
    const structuralBase = structuralCandidate ?? file;

    // V2.11: explore the image optimization branch from both the original
    // source and the best structural candidate. Structural rewrites can change
    // the representation enough that optimizing only the structurally reduced
    // file can miss a smaller image candidate available from the source. The
    // branches remain independent candidates and the final certification gate
    // still decides which result is actually eligible.
    const imageSources: Array<{
      file: File;
      label: 'source' | 'structural';
      forensic: PdfFileAnalysis['forensic'];
      pageCount: number;
    }> = [{
      file,
      label: 'source',
      forensic: cachedAnalysis.forensic,
      pageCount: cachedAnalysis.pages,
    }];

    if (cachedAnalysis.forensic && structuralCandidate && structuralCandidate !== file) {
      // V2.12: forensic image/resource facts are tied to the exact PDF bytes
      // they describe. A qpdf structural rewrite can change indirect-object
      // identities, image filters, byte totals, and resource topology, so the
      // source forensic snapshot must never be reused for the structural branch.
      // If branch-specific analysis is unavailable, skip that optional image
      // branch rather than making a decision from stale forensic data.
      throwIfCompressionCancelled(signal);
      const structuralForensic = await this.analyzeBranchForensic(structuralCandidate, signal);
      if (structuralForensic) {
        imageSources.push({
          file: structuralCandidate,
          label: 'structural',
          forensic: structuralForensic,
          pageCount: cachedAnalysis.pages,
        });
      }
    }

    const imageCandidates: PdfImageOptimizationCandidate[] = [];
    const imageProgressShare = 15 / Math.max(1, imageSources.length);

    for (let sourceIndex = 0; sourceIndex < imageSources.length; sourceIndex += 1) {
      throwIfCompressionCancelled(signal);
      const imageSource = imageSources[sourceIndex];
      if (level === 'light' || plan.targetBytes) continue;
      const imageOptimization = await this.imageOptimizer.optimize(
        imageSource.file,
        imageSource.forensic,
        level,
        progress => emitProgress(
          30 + Math.round((sourceIndex * imageProgressShare) + (progress * imageProgressShare / 100)),
        ),
        signal,
        imageSource.pageCount,
      );

      for (const candidate of imageOptimization.candidates) {
        const telemetry = this.createCandidateTelemetry(
          'image',
          `jpeg-quality-${candidate.quality}/${imageSource.label}`,
          candidate.inputBytes,
          candidate.outputBytes,
          true,
          'not-certified',
          candidate.durationMs,
          candidate.valid,
        );
        telemetryCandidates.push(telemetry);
        telemetryByCandidate.set(candidate.file, telemetry);
        telemetryParentByCandidate.set(candidate.file, imageSource.file);
        imageCandidates.push(candidate);
      }
    }

    const imageCandidate = imageCandidates
      .filter(candidate => candidate.valid && candidate.outputBytes < candidate.inputBytes)
      .sort((a, b) => a.outputBytes - b.outputBytes)[0]?.file ?? null;

    throwIfCompressionCancelled(signal);
    const optimizedBase = [structuralBase, imageCandidate]
      .filter((candidate): candidate is File => candidate !== null)
      .sort((a, b) => a.size - b.size)[0] ?? file;

    const budget = this.capability.budget;
    const resourceProfile = this.resourceGuard.profile(file.size, cachedAnalysis.pages);
    const qpdfResourceProfile = this.qpdfResourceGuard.profile(
      file.size,
      cachedAnalysis.pages,
      cachedAnalysis.forensic,
    );
    const skipExpensiveLegacyStrategy =
      qpdfResourceProfile.risk === 'high' && !qpdfResourceProfile.allowPdfOutput;
    const useUnknownSafeFallback =
      qpdfResourceProfile.risk === 'unknown' && !qpdfResourceProfile.allowPdfOutput;

    // Production hardening: a high-risk workload has an observed qpdf output
    // boundary, so it must not be replaced by an equally expensive blind
    // full-document raster pass. Unknown-complexity workloads get one bounded
    // pdf-lib safe pass instead; that path does not invoke qpdf and still goes
    // through the same final certification/original-fallback gate.
    if (skipExpensiveLegacyStrategy || useUnknownSafeFallback) {
      telemetryCandidates.push(
        this.createCandidateTelemetry(
          'strategy',
          `skipped/${qpdfResourceProfile.risk}-qpdf-output-disabled`,
          file.size,
          file.size,
          false,
          'not-certified',
          0,
          null,
        ),
      );
    }

    // V2.13: legacy strategy compression is now explored from a bounded set
    // of independent candidate bases instead of only the single smallest
    // pre-strategy candidate. The previous V2.11/V2.12 pipeline could miss a
    // useful result when the structural and image branches had different
    // representations that respond differently to the legacy strategy.
    //
    // Keep this deliberately bounded to three bases so smart/strong raster
    // processing cannot grow into an unbounded branch matrix. The smallest base is always considered first; up to two distinct
    // alternatives are retained when they exist. Final V2.7/V2.6 certification remains the only selector.
    const strategySources = (skipExpensiveLegacyStrategy || level === 'light' || !!plan.targetBytes)
      ? []
      : useUnknownSafeFallback
        ? [{ file, label: 'unknown-safe' }]
        : await this.deduplicateStrategySources(
            this.buildStrategySources(
              file,
              optimizedBase,
              structuralBase,
              imageCandidate,
            ),
            telemetryCandidates,
            telemetryByCandidate,
            telemetryParentByCandidate,
            resourceProfile.maxStrategyBranches,
            signal,
          );
    const strategyCandidates: File[] = [];
    if (file.size <= budget.maxFileBytes && cachedAnalysis.pages <= budget.maxPages) {
      const nativeStartedAt = performance.now();
      const nativeCandidates = await this.nativeOptimizer.optimizeCandidates(file, signal, { level, targetBytes: plan.targetBytes });
      for (const nativeCandidate of nativeCandidates) {
      this.nativeMetadataPreserved.add(nativeCandidate);
      throwIfCompressionCancelled(signal);
      const nativeTelemetry = this.createCandidateTelemetry(
        'strategy', `native-${level}/worker`, file.size, nativeCandidate?.size ?? file.size,
        true, 'not-certified', performance.now() - nativeStartedAt, null,
      );
      telemetryCandidates.push(nativeTelemetry);
      if (nativeCandidate) {
        strategyCandidates.push(nativeCandidate);
        telemetryByCandidate.set(nativeCandidate, nativeTelemetry);
        telemetryParentByCandidate.set(nativeCandidate, file);
      }
    }
    }
    const strategyProgressShare = 50 / Math.max(1, strategySources.length);
    const budgetFallback = cachedAnalysis.pages > budget.maxPages || file.size > budget.maxFileBytes;

    for (let strategyIndex = 0; strategyIndex < strategySources.length; strategyIndex += 1) {
      throwIfCompressionCancelled(signal);
      const strategySource = strategySources[strategyIndex];
      const strategyStartedAt = performance.now();
      const progressOffset = 45 + Math.round(strategyIndex * strategyProgressShare);
      const progressScale = strategyProgressShare / 100;
      let strategyCandidate: File;

      if (budgetFallback || useUnknownSafeFallback || level === 'light') {
        // Budget/unknown-resource fallback uses one bounded pdf-lib pass.
        // Size alone must never select a candidate; final certification remains
        // authoritative. Unknown-resource mode deliberately avoids qpdf and
        // the expensive full-document raster strategy.
        strategyCandidate = await this.safeCompress(
          strategySource.file,
          level,
          progress => emitProgress(progressOffset + Math.round(progress * progressScale)),
          signal,
        );
      } else {
        switch (plan.strategy) {
          case 'safe':
            strategyCandidate = await this.safeCompress(
              strategySource.file,
              level,
              progress => emitProgress(progressOffset + Math.round(progress * progressScale)),
              signal,
            );
            break;
          case 'smart':
            strategyCandidate = await this.smartCompress(
              strategySource.file,
              plan,
              cachedAnalysis.pages,
              progress => emitProgress(progressOffset + Math.round(progress * progressScale)),
              signal,
            );
            break;
          case 'strong':
            strategyCandidate = await this.strongCompress(
              strategySource.file,
              plan,
              cachedAnalysis.pages,
              progress => emitProgress(progressOffset + Math.round(progress * progressScale)),
              signal,
            );
            break;
          default:
            strategyCandidate = await this.safeCompress(
              strategySource.file,
              level,
              progress => emitProgress(progressOffset + Math.round(progress * progressScale)),
              signal,
            );
        }
      }

      const strategyTelemetry = this.createCandidateTelemetry(
        'strategy',
        `${budgetFallback ? 'safe/budget-fallback' : useUnknownSafeFallback ? 'safe/unknown-qpdf-disabled' : plan.strategy}/${strategySource.label}`,
        strategySource.file.size,
        strategyCandidate.size,
        true,
        'not-certified',
        performance.now() - strategyStartedAt,
        strategyCandidate !== strategySource.file,
      );
      telemetryCandidates.push(strategyTelemetry);
      telemetryByCandidate.set(strategyCandidate, strategyTelemetry);
      telemetryParentByCandidate.set(strategyCandidate, strategySource.file);
      strategyCandidates.push(strategyCandidate);
    }

    throwIfCompressionCancelled(signal);
    const candidatesForCertification = await this.prepareCandidatesForCertification(
      file,
      [structuralCandidate, imageCandidate, ...strategyCandidates],
      telemetryByCandidate,
      telemetryParentByCandidate,
      signal,
    );
    const certification = await this.candidateCertification.certifySmallest(
      file,
      candidatesForCertification,
      progress => emitProgress(progress),
      signal,
      level,
    );

    throwIfCompressionCancelled(signal);
    candidateFingerprints.set(file, certification.sourceFingerprint);
    for (const evaluation of certification.evaluations) {
      candidateFingerprints.set(evaluation.candidate, evaluation.fingerprint);
      const telemetry = telemetryByCandidate.get(evaluation.candidate);
      if (!telemetry) continue;
      telemetry.candidateFingerprint = evaluation.fingerprint;
      telemetry.certification = evaluation.duplicateOfFingerprint
        ? 'duplicate-skipped'
        : evaluation.result.status === 'passed'
          ? 'passed'
          : 'rejected';
      if (evaluation.result.status === 'passed') telemetry.structurallyValid = true;
      telemetry.certificationReason = evaluation.result.reason;
      telemetry.certificationPagesChecked = evaluation.result.pagesChecked;
      telemetry.certificationTotalPages = evaluation.result.totalPages;
    }

    // V2.14: expose candidate lineage without retaining File/byte references in
    // telemetry. This makes the final report explain which exact candidate
    // representation each stage consumed, while keeping telemetry privacy-safe.
    for (const [candidate, telemetry] of telemetryByCandidate) {
      const parent = telemetryParentByCandidate.get(candidate);
      const parentFingerprint = parent ? candidateFingerprints.get(parent) : undefined;
      if (parentFingerprint) telemetry.parentFingerprint = parentFingerprint;
    }

    const selected = certification.selected ?? file;
    const selectedTelemetry = certification.selected
      ? telemetryByCandidate.get(certification.selected)
      : undefined;

    this.lastExecutionTelemetry = this.createExecutionTelemetry(
      file,
      selected,
      executionStartedAt,
      telemetryCandidates,
      {
        candidatesConsidered: certification.candidatesConsidered,
        uniqueCandidatesCertified: certification.uniqueCandidatesCertified,
        cacheHits: certification.cacheHits,
        duplicateCandidatesSkipped: certification.duplicateCandidatesSkipped,
        durationMs: certification.durationMs,
      },
      selectedTelemetry?.stage ?? null,
      selectedTelemetry?.label ?? null,
      structuralDiagnostics,
      structuralQpdfAttemptDecision,
      structuralStageEntered,
      structuralStageCompleted,
    );

    emitProgress(100);
    return selected;
  }


  /** Cancels the active compression operation and releases active workers. */
  cancel(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.compressionWorker.cancel();
    void this.qpdf.cancel();
  }

  private buildStrategySources(
    file: File,
    optimizedBase: File,
    structuralBase: File,
    imageCandidate: File | null,
    maxBranches: 1 | 2 | 3 = 3,
  ): Array<{ file: File; label: string }> {
    const candidates: Array<{ file: File; label: string }> = [
      {
        file: optimizedBase,
        label: optimizedBase === structuralBase
          ? 'structural'
          : optimizedBase === imageCandidate
            ? 'image'
            : 'source',
      },
    ];

    const alternatives: Array<{ file: File; label: string }> = [];
    if (structuralBase !== optimizedBase) {
      alternatives.push({ file: structuralBase, label: 'structural' });
    }
    if (imageCandidate && imageCandidate !== optimizedBase && imageCandidate !== structuralBase) {
      alternatives.push({ file: imageCandidate, label: 'image' });
    }

    // V2.15: preserve the original representation as a bounded third branch.
    // It is intentionally considered after the transformed branches so the
    // common case remains the smallest candidate plus one alternative, while
    // still allowing the legacy strategy to discover a source-native win that
    // image/structural preprocessing could hide.
    if (optimizedBase !== file) {
      alternatives.push({ file: file, label: 'source' });
    }

    alternatives.sort((a, b) => a.file.size - b.file.size);
    for (const alternative of alternatives) {
      if (candidates.length >= 3) break;
      if (!candidates.some(candidate => candidate.file === alternative.file)) {
        candidates.push(alternative);
      }
    }

    return candidates.slice(0, maxBranches);
  }


  /**
   * V2.16: eliminate byte-identical strategy inputs before invoking the
   * expensive legacy strategy. V2.15 already removes duplicate File object
   * references, but qpdf/pdf-lib can create distinct File objects containing
   * identical bytes. Running safe/smart/strong on both would waste CPU while
   * producing an equivalent candidate. This is only an execution optimization:
   * final V2.7/V2.6 certification remains authoritative.
   */
  private async deduplicateStrategySources(
    candidates: Array<{ file: File; label: string }>,
    telemetryCandidates: CompressionCandidateTelemetry[],
    telemetryByCandidate: Map<File, CompressionCandidateTelemetry>,
    telemetryParentByCandidate: Map<File, File>,
    maxBranches: 1 | 2 | 3,
    signal?: AbortSignal,
  ): Promise<Array<{ file: File; label: string }>> {
    const fingerprints = new Map<string, Array<{ file: File; label: string }>>();
    const unique: Array<{ file: File; label: string }> = [];

    for (const candidate of candidates) {
      throwIfCompressionCancelled(signal);
      const fingerprint = await this.fingerprintFile(candidate.file, signal);
      const bucket = fingerprints.get(fingerprint) ?? [];
      let duplicateOf: { file: File; label: string } | undefined;

      for (const existing of bucket) {
        if (await this.filesByteEqual(candidate.file, existing.file)) {
          duplicateOf = existing;
          break;
        }
      }

      if (duplicateOf) {
        const skippedTelemetry = this.createCandidateTelemetry(
          'strategy',
          `preflight-duplicate-skipped/${candidate.label}`,
          candidate.file.size,
          candidate.file.size,
          false,
          'duplicate-skipped',
          0,
          true,
        );
        skippedTelemetry.candidateFingerprint = fingerprint;
        skippedTelemetry.parentFingerprint = fingerprint;
        telemetryCandidates.push(skippedTelemetry);
        telemetryByCandidate.set(candidate.file, skippedTelemetry);
        telemetryParentByCandidate.set(candidate.file, duplicateOf.file);
        continue;
      }

      bucket.push(candidate);
      fingerprints.set(fingerprint, bucket);
      unique.push(candidate);
      if (unique.length >= maxBranches) break;
    }

    return unique;
  }

  private async filesByteEqual(first: File, second: File): Promise<boolean> {
    if (first.size !== second.size) return false;
    const [firstBytes, secondBytes] = await Promise.all([first.arrayBuffer(), second.arrayBuffer()]);
    const a = new Uint8Array(firstBytes);
    const b = new Uint8Array(secondBytes);
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return false;
    }
    return true;
  }

  private async fingerprintFile(file: File, signal?: AbortSignal): Promise<string> {
    throwIfCompressionCancelled(signal);
    const bytes = await file.arrayBuffer();
    throwIfCompressionCancelled(signal);
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // Deterministic, non-cryptographic fallback for environments without
      // Web Crypto. Certification still performs its authoritative SHA-256
      // fingerprinting later, so this fallback only controls preflight work.
      const view = new Uint8Array(bytes);
      let hash = 2166136261;
      for (const byte of view) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
      }
      return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${view.byteLength}`;
    }
  }

  private async analyzeBranchForensic(file: File, signal?: AbortSignal): Promise<PdfFileAnalysis['forensic']> {
    try {
      const analysis = await this.pdfAnalyzer.analyzeFile(file, signal);
      return analysis.forensic;
    } catch {
      throwIfCompressionCancelled(signal);
      return undefined;
    }
  }

  private createCandidateTelemetry(
    stage: CompressionCandidateStage,
    label: string,
    inputBytes: number,
    outputBytes: number,
    generated: boolean,
    certification: CompressionCandidateTelemetry['certification'],
    durationMs: number,
    structurallyValid: boolean | null,
  ): CompressionCandidateTelemetry {
    const reductionBytes = Math.max(0, inputBytes - outputBytes);
    return {
      stage,
      label,
      inputBytes,
      outputBytes,
      reductionBytes,
      reductionPercent: inputBytes > 0 ? (reductionBytes / inputBytes) * 100 : 0,
      generated,
      structurallyValid,
      certification,
      durationMs,
    };
  }

  private emptyCertificationTelemetry() {
    return {
      candidatesConsidered: 0,
      uniqueCandidatesCertified: 0,
      cacheHits: 0,
      duplicateCandidatesSkipped: 0,
      durationMs: 0,
    };
  }

  private createExecutionTelemetry(
    source: File,
    output: File,
    startedAt: number,
    candidates: CompressionCandidateTelemetry[],
    certification: ReturnType<CompressEngine['emptyCertificationTelemetry']>,
    selectedStage: CompressionCandidateStage | null = null,
    selectedLabel: string | null = null,
    structuralDiagnostics?: PdfStructuralCandidateDiagnostic[],
    structuralQpdfAttemptDecision?: PdfQpdfAttemptDecision,
    structuralStageEntered = false,
    structuralStageCompleted = false,
  ): CompressionExecutionTelemetry {
    const reductionBytes = Math.max(0, source.size - output.size);
    return {
      version: 1,
      originalBytes: source.size,
      finalBytes: output.size,
      reductionBytes,
      reductionPercent: source.size > 0 ? (reductionBytes / source.size) * 100 : 0,
      totalDurationMs: performance.now() - startedAt,
      returnedOriginal: output === source,
      selectedStage,
      selectedLabel,
      finalDecision: output === source ? 'original-fallback' : 'certified-candidate',
      finalDecisionReason: output === source
        ? (this.certificationReasonFromCandidates(candidates) ?? 'No certified smaller candidate was selected.')
        : null,
      structuralStage: {
        entered: structuralStageEntered,
        completed: structuralStageCompleted,
        decisionReason: structuralQpdfAttemptDecision?.reason ?? 'STRUCTURAL_STAGE_NOT_ENTERED',
      },
      candidates,
      certification,
      structuralDiagnostics,
      structuralQpdfAttemptDecision,
    };
  }

  private certificationReasonFromCandidates(candidates: CompressionCandidateTelemetry[]): string | null {
    const rejected = candidates
      .map(candidate => candidate.certificationReason)
      .filter((reason): reason is string => Boolean(reason));
    return rejected[0] ?? null;
  }

  async safeCompress(
    file: File,
    level: 'light' | 'recommended' | 'strong',
    onProgress?: (p: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    throwIfCompressionCancelled(signal);
    const existingPdfBytes = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(existingPdfBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    try {
      onProgress?.(20);
      // Keep document metadata intact. Safe compression should optimize the
      // PDF structure without silently changing document identity metadata.
      onProgress?.(40);

      throwIfCompressionCancelled(signal);
      const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: this.compressionPlanner.getObjectsPerTick(level),
        updateFieldAppearances: false,
      });

      if (compressedBytes.length < file.size) {
        const pdfLibCandidate = this.toPdfFile(file, compressedBytes);
        try {
          await this.validateOutput(pdfLibCandidate, pdfDoc, pdfDoc.getPageCount());
        } catch {
          return file;
        }
        throwIfCompressionCancelled(signal);
        const optimizedCandidate = level === 'light' ? null : await this.tryQpdfOptimize(pdfLibCandidate, 70, 98, this.getQpdfJpegQuality(level), onProgress, signal, this.qpdfProfileFor(pdfLibCandidate.size, pdfDoc.getPageCount()), this.qpdfResourceGuard.profile(pdfLibCandidate.size, pdfDoc.getPageCount()).allowPdfOutput);
        if (optimizedCandidate) {
          try {
            await this.validateOutput(optimizedCandidate, pdfDoc, pdfDoc.getPageCount());
          } catch {
            // Keep the already validated pdf-lib candidate.
          }
        }
        const best = this.pickSmallest(file, pdfLibCandidate, optimizedCandidate);
        onProgress?.(100);
        return best;
      }

      throwIfCompressionCancelled(signal);
      const optimizedOriginal = level === 'light' ? null : await this.tryQpdfOptimize(file, 70, 98, this.getQpdfJpegQuality(level), onProgress, signal, this.qpdfProfileFor(file.size, pdfDoc.getPageCount()), this.qpdfResourceGuard.profile(file.size, pdfDoc.getPageCount()).allowPdfOutput);
      if (optimizedOriginal) {
        try {
          await this.validateOutput(optimizedOriginal, pdfDoc, pdfDoc.getPageCount());
        } catch {
          return file;
        }
      }
      onProgress?.(100);
      return this.pickSmallest(file, optimizedOriginal);
    } finally {
      pdfDoc.flush?.();
    }
  }

  private async strongCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    onProgress?: (p: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    return this.rasterCompress(file, plan, totalPages, true, onProgress, signal);
  }

  private async smartCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    onProgress?: (p: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    return this.rasterCompress(file, plan, totalPages, false, onProgress, signal);
  }

  private async rasterCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    strong: boolean,
    onProgress?: (p: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    throwIfCompressionCancelled(signal);
    const { sourcePdf, pdf } = await this.loadSourcePdf(file);
    const newPdf = await PDFDocument.create({ updateMetadata: false });
    this.copyDocumentMetadata(sourcePdf, newPdf);

    try {
      let quality = plan.quality;
      let maxWidth = plan.maxWidth;
      let maxHeight = plan.maxHeight;

      if (strong && totalPages > 1000) {
        quality *= 0.9;
        maxWidth *= 0.8;
        maxHeight *= 0.8;
      }

      for (let i = 1; i <= totalPages; i++) {
        throwIfCompressionCancelled(signal);
        const page = await pdf.getPage(i);
        const sourcePage = sourcePdf.getPage(i - 1);

        try {
          const analysis = await this.pdfAnalyzer.analyzePage(page);

          if (!analysis.shouldRasterize) {
            await this.copyOriginalPage(sourcePdf, newPdf, i - 1);
          } else {
            await this.compressPage(page, sourcePage, newPdf, plan, analysis, quality, maxWidth, maxHeight, signal);
          }

          throwIfCompressionCancelled(signal);
        onProgress?.(Math.round((i / totalPages) * 100));
        } finally {
          try { page.cleanup(); } catch { /* best effort */ }
        }
      }

      return await this.finalizeAndValidate(
        file,
        newPdf,
        sourcePdf,
        totalPages,
        Math.round(Math.min(95, Math.max(40, plan.quality * 100))),
        onProgress,
        signal,
      );
    } finally {
      try { await pdf.destroy(); } catch { /* best effort */ }
      try { newPdf.flush?.(); } catch { /* best effort */ }
    }
  }

  private async compressPage(
    page: any,
    sourcePage: PDFPage,
    newPdf: PDFDocument,
    plan: CompressionPlan,
    analysis: PageAnalysis,
    quality: number,
    maxWidth: number,
    maxHeight: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
    const scale = this.compressionPlanner.getAdaptiveScale(plan, baseViewport, analysis);
    const renderWidth = Math.max(1, Math.floor(baseViewport.width * scale));
    const renderHeight = Math.max(1, Math.floor(baseViewport.height * scale));
    const ratio = Math.min(maxWidth / renderWidth, maxHeight / renderHeight, 1);
    const finalWidth = Math.max(1, Math.floor(renderWidth * ratio));
    const finalHeight = Math.max(1, Math.floor(renderHeight * ratio));
    const adaptiveQuality = this.compressionPlanner.getAdaptiveQuality(plan, analysis);

    throwIfCompressionCancelled(signal);
    const bitmap = await this.pageRenderer.renderToImageBitmap(page, finalWidth, finalHeight, signal);
    try {
      let bytes = await this.compressionWorker.encodeJpeg(
        bitmap,
        finalWidth,
        finalHeight,
        Math.min(quality, adaptiveQuality),
        signal,
      );

      if (!bytes) {
        // encodeJpeg transfers/consumes the bitmap when a worker is available.
        // If the worker is unavailable, render a fresh JPEG on the main thread.
        bytes = await this.pageRenderer.renderToJpeg(page, finalWidth, finalHeight, Math.min(quality, adaptiveQuality), signal);
      }

      throwIfCompressionCancelled(signal);
      const geometry = this.getPageGeometry(sourcePage);
      await this.pageEmbedder.addJpegPage(newPdf, bytes, geometry);
    } finally {
      try { bitmap.close(); } catch { /* best effort */ }
    }
  }

  private async copyOriginalPage(sourcePdf: PDFDocument, targetPdf: PDFDocument, pageIndex: number): Promise<void> {
    const copiedPages = await targetPdf.copyPages(sourcePdf, [pageIndex]);
    targetPdf.addPage(copiedPages[0]);
  }

  private getPageGeometry(sourcePage: PDFPage): PdfPageGeometry {
    const page = sourcePage as PDFPage & {
      getMediaBox?: () => { x: number; y: number; width: number; height: number };
      getCropBox?: () => { x: number; y: number; width: number; height: number };
    };

    const mediaBox = page.getMediaBox?.();
    const cropBox = page.getCropBox?.();
    return {
      width: sourcePage.getWidth(),
      height: sourcePage.getHeight(),
      rotation: sourcePage.getRotation().angle,
      mediaBox,
      cropBox,
    };
  }

  private async loadSourcePdf(file: File) {
    const pdfjs = await this.pdfJsLoader.load();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    return { pdf, sourcePdf };
  }

  /**
   * R7.5.3: normalize candidate metadata after the candidate PDF has been
   * serialized once. Metadata preservation is intentionally a post-generation
   * operation so every candidate branch (structural, image, safe, smart,
   * strong, and qpdf-derived) receives the same source-Info contract.
   *
   * The source Info dictionary is copied as PDF objects rather than rebuilt
   * through high-level setters. This avoids value normalization and preserves
   * the exact presence/absence of the source document's Info entries.
   */
  private async prepareCandidatesForCertification(
    sourceFile: File,
    candidates: readonly (File | null)[],
    telemetryByCandidate: Map<File, CompressionCandidateTelemetry>,
    telemetryParentByCandidate: Map<File, File>,
    signal?: AbortSignal,
  ): Promise<Array<File | null>> {
    throwIfCompressionCancelled(signal);
    // Returning the original requires no metadata rewrite or extra parse.
    if (!candidates.some(candidate => candidate && candidate !== sourceFile && candidate.size < sourceFile.size && !this.nativeMetadataPreserved.has(candidate))) {
      return [...candidates];
    }
    const sourceBytes = await sourceFile.arrayBuffer();
    throwIfCompressionCancelled(signal);
    const sourcePdf = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    try {
      const normalized = new Map<File, File>();
      const output: Array<File | null> = [];

      for (const candidate of candidates) {
        throwIfCompressionCancelled(signal);

        if (!candidate || candidate === sourceFile || candidate.size >= sourceFile.size || this.nativeMetadataPreserved.has(candidate)) {
          output.push(candidate);
          continue;
        }

        const cached = normalized.get(candidate);
        if (cached) {
          output.push(cached);
          continue;
        }

        const normalizedCandidate = await this.preserveSourceMetadataOnCandidate(
          sourceFile,
          sourcePdf,
          candidate,
          signal,
        );
        normalized.set(candidate, normalizedCandidate);
        output.push(normalizedCandidate);

        if (normalizedCandidate !== candidate) {
          const telemetry = telemetryByCandidate.get(candidate);
          const parent = telemetryParentByCandidate.get(candidate);
          telemetryByCandidate.delete(candidate);
          telemetryParentByCandidate.delete(candidate);
          if (telemetry) {
            // Metadata serialization can change size. Telemetry describes the
            // exact bytes certified and downloaded, not the pre-normalized file.
            telemetry.outputBytes = normalizedCandidate.size;
            telemetry.reductionBytes = Math.max(0, telemetry.inputBytes - normalizedCandidate.size);
            telemetry.reductionPercent = telemetry.inputBytes > 0
              ? telemetry.reductionBytes / telemetry.inputBytes * 100 : 0;
            telemetryByCandidate.set(normalizedCandidate, telemetry);
          }
          if (parent) telemetryParentByCandidate.set(normalizedCandidate, parent);
        }
      }

      return output;
    } finally {
      sourcePdf.flush?.();
    }
  }

  private async preserveSourceMetadataOnCandidate(
    sourceFile: File,
    sourcePdf: PDFDocument,
    candidate: File,
    signal?: AbortSignal,
  ): Promise<File> {
    throwIfCompressionCancelled(signal);
    const candidateBytes = await candidate.arrayBuffer();
    const targetPdf = await PDFDocument.load(candidateBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    try {
      this.copyDocumentMetadata(sourcePdf, targetPdf);
      throwIfCompressionCancelled(signal);

      const serialized = await targetPdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
        updateFieldAppearances: false,
      });

      throwIfCompressionCancelled(signal);
      return this.toPdfFile(sourceFile, serialized);
    } finally {
      targetPdf.flush?.();
    }
  }

  private copyDocumentMetadata(source: PDFDocument, target: PDFDocument): void {
    const sourceInfo = source.context.lookupMaybe(source.context.trailerInfo.Info, PDFDict);
    const targetTrailerInfo = target.context.trailerInfo as { Info?: unknown };

    if (!sourceInfo) {
      // Exact metadata preservation also means preserving the absence of an
      // Info dictionary. Remove candidate-side metadata rather than allowing
      // a qpdf/pdf-lib branch to introduce identity fields that the source did
      // not contain.
      delete targetTrailerInfo.Info;
      return;
    }

    // Preserve the source Info dictionary as PDF objects instead of rebuilding
    // individual fields through the high-level setters. This is important for
    // certification because setters can normalize values (notably /Keywords)
    // and PDFDocument.create() normally injects its own Producer/CreationDate/
    // ModDate metadata. The fallback must not silently rewrite document identity.
    const infoCopy = PDFObjectCopier.for(source.context, target.context).copy(sourceInfo);
    target.context.trailerInfo.Info = target.context.register(infoCopy);
  }


  private async finalizeAndValidate(
    file: File,
    newPdf: PDFDocument,
    sourcePdf: PDFDocument,
    expectedPages: number,
    qpdfJpegQuality: number,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    throwIfCompressionCancelled(signal);
    const bytes = await newPdf.save({ useObjectStreams: true });
    const rasterCandidate = this.toPdfFile(file, bytes);

    if (rasterCandidate.size < file.size) {
      await this.validateOutput(rasterCandidate, sourcePdf, expectedPages);
      throwIfCompressionCancelled(signal);
      const optimizedRaster = await this.tryQpdfOptimize(rasterCandidate, 94, 99, qpdfJpegQuality, onProgress, signal, this.qpdfProfileFor(rasterCandidate.size, expectedPages), this.qpdfResourceGuard.profile(rasterCandidate.size, expectedPages).allowPdfOutput);
      if (optimizedRaster && optimizedRaster.size < rasterCandidate.size) {
        await this.validateOutput(optimizedRaster, sourcePdf, expectedPages);
      }
      const bestRaster = this.pickSmallest(rasterCandidate, optimizedRaster);
      await this.validateOutput(bestRaster, sourcePdf, expectedPages);
      return bestRaster;
    }

    // Rasterizing a mixed/text-heavy document can legitimately make it larger.
    // In that case, do not throw away a useful structural qpdf optimization.
    throwIfCompressionCancelled(signal);
    const optimizedOriginal = await this.tryQpdfOptimize(file, 70, 98, qpdfJpegQuality, onProgress, signal, this.qpdfProfileFor(file.size, expectedPages), this.qpdfResourceGuard.profile(file.size, expectedPages).allowPdfOutput);
    if (optimizedOriginal && optimizedOriginal.size < file.size) {
      await this.validateOutput(optimizedOriginal, sourcePdf, expectedPages);
    }
    return this.pickSmallest(file, optimizedOriginal);
  }

  private async tryQpdfOptimize(
    file: File,
    progressStart: number,
    progressEnd: number,
    jpegQuality: number,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    optimizationProfile: 'standard' | 'conservative' = 'standard',
    allowPdfOutput = true,
  ): Promise<File | null> {
    if (!allowPdfOutput) {
      return null;
    }

    try {
      throwIfCompressionCancelled(signal);
      const optimized = await this.qpdf.optimizeForCompression(file, jpegQuality, progress => {
        if (onProgress) {
          onProgress(progressStart + Math.round((progress / 100) * (progressEnd - progressStart)));
        }
      },
      undefined,
      optimizationProfile);
      throwIfCompressionCancelled(signal);
      return optimized.size > 0 ? optimized : null;
    } catch (error) {
      if (signal?.aborted || error instanceof CompressionCancelledError) throw error;
      return null;
    }
  }

  private qpdfProfileFor(fileBytes: number, pages: number): 'standard' | 'conservative' {
    return this.qpdfResourceGuard.profile(fileBytes, pages).optimizationProfile;
  }

  private getQpdfJpegQuality(level: 'light' | 'recommended' | 'strong'): number {
    switch (level) {
      case 'light':
        return 88;
      case 'recommended':
        return 80;
      case 'strong':
        return 65;
    }
  }

  private pickSmallest(source: File, ...candidates: Array<File | null | undefined>): File {
    return [source, ...candidates]
      .filter((candidate): candidate is File => Boolean(candidate))
      .reduce((best, candidate) => candidate.size < best.size ? candidate : best);
  }

  private async validateOutput(file: File, sourcePdf: PDFDocument, expectedPages: number): Promise<void> {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    try {
      if (pdf.getPageCount() !== expectedPages) {
        throw new Error(`Compression output page count mismatch: expected ${expectedPages}, received ${pdf.getPageCount()}.`);
      }
      const outputPages = pdf.getPages();
      const sourcePages = sourcePdf.getPages();
      for (let i = 0; i < outputPages.length; i++) {
        const page = outputPages[i];
        const sourcePage = sourcePages[i];
        if (!(page.getWidth() > 0) || !(page.getHeight() > 0)) {
          throw new Error('Compression output contains an invalid page size.');
        }
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const sourceRotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
        if (![0, 90, 180, 270].includes(rotation)) {
          throw new Error('Compression output contains an invalid page rotation.');
        }
        if (Math.abs(page.getWidth() - sourcePage.getWidth()) > 0.01 ||
            Math.abs(page.getHeight() - sourcePage.getHeight()) > 0.01 ||
            rotation !== sourceRotation) {
          throw new Error(`Compression output changed page geometry on page ${i + 1}.`);
        }
      }
    } finally {
      pdf.flush?.();
    }
  }

  private detectAlreadyCompressed(fileSize: number, pages: number): boolean {
    if (!pages) return false;
    return fileSize / pages < 15000;
  }

  private toPdfFile(source: File, bytes: Uint8Array): File {
    const cleanName = source.name.replace(/\.pdf$/i, '');
    return new File([new Uint8Array(bytes)], `${cleanName}-safepdfhub_compressed.pdf`, { type: 'application/pdf' });
  }
}

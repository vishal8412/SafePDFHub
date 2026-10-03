import { Injectable } from '@angular/core';

import { PdfForensicAnalysis } from '../compression/pdf-forensic.models';

export type QpdfWasmResourceRisk = 'low' | 'elevated' | 'high' | 'unknown';
export type QpdfWasmOptimizationProfile = 'standard' | 'conservative';

export const QPDF_WASM_RESOURCE_THRESHOLDS = {
  high: {
    fileAndPages: { fileBytes: 12 * 1024 * 1024, pages: 500 },
    fileBytes: 25 * 1024 * 1024,
    pages: 1_500,
    streamBytes: 64 * 1024 * 1024,
    imageBytes: 32 * 1024 * 1024,
    objectCount: 20_000,
  },
  elevated: {
    fileAndPages: { fileBytes: 8 * 1024 * 1024, pages: 300 },
    fileBytes: 12 * 1024 * 1024,
    pages: 1_000,
    streamBytes: 32 * 1024 * 1024,
    imageBytes: 16 * 1024 * 1024,
    objectCount: 10_000,
  },
} as const;

export type QpdfWasmResourceEvidenceQuality = 'complete' | 'partial' | 'metadata-only';

export interface QpdfWasmResourceProfile {
  risk: QpdfWasmResourceRisk;
  evidenceQuality: QpdfWasmResourceEvidenceQuality;
  unknownSignals: readonly ('streamBytes' | 'imageBytes' | 'objectCount')[];
  optimizationProfile: QpdfWasmOptimizationProfile;
  maxStructuralCandidates: 0 | 1 | 2 | 3;
  allowImageOptimization: boolean;
  allowPdfOutput: boolean;
  reason: string | null;
}

/**
 * Browser-side qpdf/WASM resource guard.
 *
 * qpdf-run copies input bytes before transferring them to its worker and
 * returns clean output copies. qpdf itself can also expand PDF structures
 * while parsing/recompressing them. Consequently, file byte size alone is
 * not a complete memory signal. This guard uses deterministic document-size
 * and forensic complexity thresholds to reduce optional qpdf fan-out and
 * avoid known high-risk operations on large browser workloads.
 *
 * This is a safety gate, not a claim that the thresholds predict exact peak
 * WASM memory. Actual qpdf runtime diagnostics remain authoritative.
 */
@Injectable({ providedIn: 'root' })
export class QpdfWasmResourceGuardService {
  profile(
    fileBytes: number,
    pages = 0,
    forensic?: PdfForensicAnalysis,
  ): QpdfWasmResourceProfile {
    const safeBytes = Math.max(0, fileBytes);
    const safePages = Math.max(0, pages);
    const forensicAvailable = Boolean(forensic);
    const forensicComplete = forensicAvailable && forensic?.partial === false;
    const evidenceQuality: QpdfWasmResourceEvidenceQuality = !forensicAvailable
      ? 'metadata-only'
      : forensicComplete
        ? 'complete'
        : 'partial';
    const unknownSignals: Array<'streamBytes' | 'imageBytes' | 'objectCount'> = [];
    if (!forensicAvailable || forensic?.partial) {
      unknownSignals.push('streamBytes', 'imageBytes', 'objectCount');
    }
    const streamBytes = forensicAvailable ? Math.max(0, forensic?.streamBytes ?? 0) : 0;
    const imageBytes = forensicAvailable ? Math.max(0, forensic?.imageBytes ?? 0) : 0;
    const objectCount = forensicAvailable ? Math.max(0, forensic?.objectCount ?? 0) : 0;

    const high =
      (safeBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.fileBytes &&
        safePages >= QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.pages) ||
      safeBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.high.fileBytes ||
      safePages >= QPDF_WASM_RESOURCE_THRESHOLDS.high.pages ||
      streamBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.high.streamBytes ||
      imageBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.high.imageBytes ||
      objectCount >= QPDF_WASM_RESOURCE_THRESHOLDS.high.objectCount;

    // Production hardening: incomplete forensic evidence is not evidence of a
    // low-complexity PDF. qpdf PDF-output generation is therefore disabled for
    // the unknown class. The compression pipeline can still use its native
    // pdf-lib/raster fallback and final certification path.
    if (!forensicComplete) {
      return {
        risk: 'unknown',
        evidenceQuality,
        unknownSignals,
        optimizationProfile: 'conservative',
        maxStructuralCandidates: 0,
        allowImageOptimization: false,
        allowPdfOutput: false,
        reason: 'qpdf WASM resource complexity is unknown because forensic evidence is incomplete; qpdf PDF-output generation is disabled and SafePDFHub must use the certified non-qpdf fallback.',
      };
    }

    if (high) {
      return {
        risk: 'high',
        evidenceQuality,
        unknownSignals,
        optimizationProfile: 'conservative',
        maxStructuralCandidates: 1,
        allowImageOptimization: false,
        allowPdfOutput: false,
        reason: 'qpdf WASM high-memory workload guard: browser qpdf PDF-output generation is disabled for this workload after the R5 baseline-output OOM evidence; image recompression and candidate fan-out are also disabled.',
      };
    }

    const elevated =
      (safeBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.fileAndPages.fileBytes &&
        safePages >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.fileAndPages.pages) ||
      safeBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.fileBytes ||
      safePages >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.pages ||
      streamBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.streamBytes ||
      imageBytes >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.imageBytes ||
      objectCount >= QPDF_WASM_RESOURCE_THRESHOLDS.elevated.objectCount;

    if (elevated) {
      return {
        risk: 'elevated',
        evidenceQuality,
        unknownSignals,
        optimizationProfile: 'conservative',
        maxStructuralCandidates: 2,
        allowImageOptimization: true,
        allowPdfOutput: true,
        reason: 'qpdf WASM elevated-memory workload guard: conservative qpdf flags and bounded candidate fan-out are used.'
      };
    }

    return {
      risk: 'low',
      evidenceQuality,
      unknownSignals,
      optimizationProfile: 'standard',
      maxStructuralCandidates: 3,
      allowImageOptimization: true,
      allowPdfOutput: true,
      reason: null,
    };
  }

  isLikelyMemoryExhaustion(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /(?:out[ -]?of[ -]?memory|\boom\b|memory exhaustion|cannot enlarge memory|aborted\(oom\))/i.test(message);
  }
}

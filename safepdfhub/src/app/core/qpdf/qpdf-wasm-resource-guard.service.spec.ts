import { describe, expect, it } from 'vitest';
import { QpdfWasmResourceGuardService, QPDF_WASM_RESOURCE_THRESHOLDS } from './qpdf-wasm-resource-guard.service';
import type { PdfForensicAnalysis } from '../compression/pdf-forensic.models';

describe('QpdfWasmResourceGuardService', () => {
  it('classifies the authoritative 15 MB / 842-page workload as high risk when forensic evidence is complete', () => {
    const service = new QpdfWasmResourceGuardService();
    const profile = service.profile(15 * 1024 * 1024, 842, {
      partial: false,
      streamBytes: 0,
      imageBytes: 0,
      objectCount: 0,
    } as PdfForensicAnalysis);

    expect(profile.risk).toBe('high');
    expect(profile.optimizationProfile).toBe('conservative');
    expect(profile.maxStructuralCandidates).toBe(1);
    expect(profile.allowImageOptimization).toBe(false);
    expect(profile.allowPdfOutput).toBe(false);
  });

  it('classifies missing forensic evidence as unknown and disables qpdf output', () => {
    const service = new QpdfWasmResourceGuardService();
    const profile = service.profile(500_000, 10);

    expect(profile.risk).toBe('unknown');
    expect(profile.optimizationProfile).toBe('conservative');
    expect(profile.evidenceQuality).toBe('metadata-only');
    expect(profile.unknownSignals).toEqual(['streamBytes', 'imageBytes', 'objectCount']);
    expect(profile.maxStructuralCandidates).toBe(0);
    expect(profile.allowImageOptimization).toBe(false);
    expect(profile.allowPdfOutput).toBe(false);
  });


  it('does not treat partial forensic zeros as measured resource evidence', () => {
    const service = new QpdfWasmResourceGuardService();
    const forensic = {
      partial: true,
      fileSize: 1,
      pageCount: 1,
      streamBytes: 0,
      imageBytes: 0,
      objectCount: 0,
    } as PdfForensicAnalysis;

    const profile = service.profile(500_000, 10, forensic);
    expect(profile.risk).toBe('unknown');
    expect(profile.evidenceQuality).toBe('partial');
    expect(profile.unknownSignals).toEqual(['streamBytes', 'imageBytes', 'objectCount']);
    expect(profile.optimizationProfile).toBe('conservative');
    expect(profile.maxStructuralCandidates).toBe(0);
    expect(profile.allowImageOptimization).toBe(false);
    expect(profile.allowPdfOutput).toBe(false);
  });
  it('preserves the evidence-informed threshold constants used by the production guard', () => {
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages).toEqual({
      fileBytes: 12 * 1024 * 1024,
      pages: 500,
    });
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.fileBytes).toBe(25 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.pages).toBe(1_500);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.streamBytes).toBe(64 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.imageBytes).toBe(32 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.high.objectCount).toBe(20_000);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.fileAndPages).toEqual({
      fileBytes: 8 * 1024 * 1024,
      pages: 300,
    });
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.fileBytes).toBe(12 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.pages).toBe(1_000);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.streamBytes).toBe(32 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.imageBytes).toBe(16 * 1024 * 1024);
    expect(QPDF_WASM_RESOURCE_THRESHOLDS.elevated.objectCount).toBe(10_000);
  });


  it('classifies forensic threshold crossings as high risk without changing the documented values', () => {
    const service = new QpdfWasmResourceGuardService();
    const forensic = (overrides: Partial<PdfForensicAnalysis>): PdfForensicAnalysis => ({
      version: 1,
      fileSize: 1,
      pdfHeader: '%PDF-1.7',
      pageCount: 1,
      sampledPageCount: 1,
      objectCount: 0,
      streamObjectCount: 0,
      streamBytes: 0,
      uniqueStreamCount: 0,
      duplicateStreamGroupCount: 0,
      duplicateStreamBytes: 0,
      pageContentStreamCount: 0,
      pageContentStreamBytes: 0,
      uniquePageContentStreamCount: 0,
      duplicatePageContentStreamGroupCount: 0,
      duplicatePageContentBytes: 0,
      imageResourceCount: 0,
      uniqueImageResourceCount: 0,
      imageBytes: 0,
      imageReferenceCount: 0,
      imageOperatorCount: 0,
      imagePages: 0,
      sampledImageAreaRatio: 0,
      fontResourceCount: 0,
      formXObjectCount: 0,
      patternResourceCount: 0,
      shadingResourceCount: 0,
      duplicateStreams: [],
      duplicatePageContentStreams: [],
      imageResources: [],
      sampledPages: [],
      metadata: { title: null, author: null, subject: null, creator: null, producer: null },
      partial: false,
      ...overrides,
    });

    expect(service.profile(1, 1, forensic({ streamBytes: 64 * 1024 * 1024 })).risk).toBe('high');
    expect(service.profile(1, 1, forensic({ imageBytes: 32 * 1024 * 1024 })).risk).toBe('high');
    expect(service.profile(1, 1, forensic({ objectCount: 20_000 })).risk).toBe('high');
    expect(service.profile(1, 1, forensic({ streamBytes: 32 * 1024 * 1024 })).risk).toBe('elevated');
    expect(service.profile(1, 1, forensic({ imageBytes: 16 * 1024 * 1024 })).risk).toBe('elevated');
    expect(service.profile(1, 1, forensic({ objectCount: 10_000 })).risk).toBe('elevated');
  });

  it('detects common WASM memory exhaustion diagnostics', () => {
    const service = new QpdfWasmResourceGuardService();
    expect(service.isLikelyMemoryExhaustion(new Error('Aborted(OOM). Build with -sASSERTIONS for more info.'))).toBe(true);
    expect(service.isLikelyMemoryExhaustion(new Error('QPDF failed'))).toBe(false);
  });
});

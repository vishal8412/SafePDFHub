import { describe, expect, it, vi } from 'vitest';
import { PdfImageOptimizationService } from './pdf-image-optimization.service';
import { QpdfWasmPrototypeService } from '../qpdf/qpdf-wasm-prototype.service';
import { PdfVisualFidelityService } from './pdf-visual-fidelity.service';
import { PdfForensicAnalysis } from './pdf-forensic.models';
import { PdfSemanticIntegrityService } from './pdf-semantic-integrity.service';
import { QpdfWasmResourceGuardService } from '../qpdf/qpdf-wasm-resource-guard.service';




function semanticMock() {
  return { validate: vi.fn(async () => ({
    status: 'passed', sampledPages: [1, 2], pages: [],
    metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, reason: null,
  })) } as unknown as PdfSemanticIntegrityService;
}

function file(size: number): File {
  return new File([new Uint8Array(size)], 'fixture.pdf', { type: 'application/pdf' });
}

function forensic(overrides: Partial<PdfForensicAnalysis> = {}): PdfForensicAnalysis {
  return {
    version: 1,
    fileSize: 100_000,
    pdfHeader: '%PDF-1.7',
    pageCount: 2,
    sampledPageCount: 2,
    objectCount: 100,
    streamObjectCount: 50,
    streamBytes: 80_000,
    uniqueStreamCount: 45,
    duplicateStreamGroupCount: 5,
    duplicateStreamBytes: 10_000,
    pageContentStreamCount: 10,
    pageContentStreamBytes: 20_000,
    uniquePageContentStreamCount: 6,
    duplicatePageContentStreamGroupCount: 4,
    duplicatePageContentBytes: 8_000,
    imageResourceCount: 3,
    uniqueImageResourceCount: 2,
    imageBytes: 60_000,
    imageReferenceCount: 3,
    imageOperatorCount: 3,
    imagePages: 2,
    sampledImageAreaRatio: 0.45,
    fontResourceCount: 4,
    formXObjectCount: 2,
    patternResourceCount: 0,
    shadingResourceCount: 0,
    duplicateStreams: [],
    duplicatePageContentStreams: [],
    imageResources: [
      { key: '1 0 R', width: 1200, height: 800, filter: 'FlateDecode', bytes: 50_000, references: 2, sampled: false },
      { key: '2 0 R', width: 800, height: 600, filter: 'DCTDecode', bytes: 10_000, references: 1, sampled: false },
    ],
    sampledPages: [],
    metadata: { title: null, author: null, subject: null, creator: null, producer: null },
    partial: false,
    ...overrides,
  };
}

describe('PdfImageOptimizationService — V2.3', () => {
  it('uses a forensic-driven quality ladder and selects the smallest valid candidate', async () => {
    const source = file(1000);
    const outputs = new Map([
      [84, file(900)],
      [76, file(780)],
      [68, file(820)],
    ]);
    const qpdf = {
      optimizeImageCandidate: vi.fn(async (_file: File, quality: number) => outputs.get(quality) ?? file(950)),
    } as unknown as QpdfWasmPrototypeService;

    const visual = { validate: vi.fn(async () => ({ status: 'passed', sampledPages: [1, 2], pages: [], maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, meanAbsoluteError: 0, thresholdMeanAbsoluteError: 0.025, thresholdChangedPixelRatio: 0.15, reason: null })) } as unknown as PdfVisualFidelityService;
    const service = new PdfImageOptimizationService(qpdf, visual, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue(true);
    const result = await service.optimize(source, forensic(), 'recommended');

    expect(result.risk).toBe('high');
    expect(result.attemptedQualities).toEqual([84, 76, 68]);
    expect(result.selected?.quality).toBe(76);
    expect(result.selected?.outputBytes).toBe(780);
  });

  it('skips image optimization when all images are already JPEG resources', async () => {
    const qpdf = { optimizeImageCandidate: vi.fn() } as unknown as QpdfWasmPrototypeService;
    const visual = { validate: vi.fn(async () => ({ status: 'passed', sampledPages: [1, 2], pages: [], maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, meanAbsoluteError: 0, thresholdMeanAbsoluteError: 0.025, thresholdChangedPixelRatio: 0.15, reason: null })) } as unknown as PdfVisualFidelityService;
    const service = new PdfImageOptimizationService(qpdf, visual, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue(true);
    const result = await service.optimize(
      file(1000),
      forensic({ imageResources: [
        { key: '1 0 R', width: 100, height: 100, filter: 'DCTDecode', bytes: 900, references: 1, sampled: false },
      ], uniqueImageResourceCount: 1, imageResourceCount: 1 }),
      'strong',
    );

    expect(result.eligible).toBe(false);
    expect(result.selected).toBeNull();
    expect(qpdf.optimizeImageCandidate).not.toHaveBeenCalled();
  });

  it('continues when one quality candidate fails', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeImageCandidate: vi.fn(async (_file: File, quality: number) => {
        if (quality === 76) throw new Error('quality candidate failure');
        return file(quality === 84 ? 900 : 850);
      }),
    } as unknown as QpdfWasmPrototypeService;

    const visual = { validate: vi.fn(async () => ({ status: 'passed', sampledPages: [1, 2], pages: [], maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, meanAbsoluteError: 0, thresholdMeanAbsoluteError: 0.025, thresholdChangedPixelRatio: 0.15, reason: null })) } as unknown as PdfVisualFidelityService;
    const service = new PdfImageOptimizationService(qpdf, visual, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue(true);
    const result = await service.optimize(source, forensic(), 'recommended');

    expect(result.candidates.length).toBe(2);
    expect(result.selected?.outputBytes).toBe(850);
  });

  it('does not select a candidate that is not smaller than the source', async () => {
    const qpdf = {
      optimizeImageCandidate: vi.fn(async () => file(1000)),
    } as unknown as QpdfWasmPrototypeService;
    const visual = { validate: vi.fn(async () => ({ status: 'passed', sampledPages: [1, 2], pages: [], maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, meanAbsoluteError: 0, thresholdMeanAbsoluteError: 0.025, thresholdChangedPixelRatio: 0.15, reason: null })) } as unknown as PdfVisualFidelityService;
    const service = new PdfImageOptimizationService(qpdf, visual, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue(true);
    const result = await service.optimize(file(1000), forensic(), 'recommended');

    expect(result.selected).toBeNull();
  });
});

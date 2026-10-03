import { describe, expect, it, vi } from 'vitest';
import { PdfStructuralOptimizationService } from './pdf-structural-optimization.service';
import { QpdfStructuralCandidateError, QpdfWasmPrototypeService } from '../qpdf/qpdf-wasm-prototype.service';
import { PdfForensicAnalysis } from './pdf-forensic.models';
import { PdfSemanticIntegrityService } from './pdf-semantic-integrity.service';
import { QpdfWasmResourceGuardService } from '../qpdf/qpdf-wasm-resource-guard.service';



function forensic(
  overrides: Partial<PdfForensicAnalysis> = {},
): PdfForensicAnalysis {
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
    imageResourceCount: 6,
    uniqueImageResourceCount: 4,
    imageBytes: 30_000,
    imageReferenceCount: 6,
    imageOperatorCount: 6,
    imagePages: 2,
    sampledImageAreaRatio: 0.3,
    fontResourceCount: 4,
    formXObjectCount: 2,
    patternResourceCount: 0,
    shadingResourceCount: 0,
    duplicateStreams: [],
    duplicatePageContentStreams: [],
    imageResources: [],
    sampledPages: [],
    metadata: {
      title: null,
      author: null,
      subject: null,
      creator: null,
      producer: null,
    },
    partial: false,
    ...overrides,
  };
}


function semanticMock() {
  return { validate: vi.fn(async () => ({
    status: 'passed', sampledPages: [1, 2], pages: [],
    metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, reason: null,
  })) } as unknown as PdfSemanticIntegrityService;
}

function file(size: number): File {
  return new File([new Uint8Array(size)], 'fixture.pdf', {
    type: 'application/pdf',
  });
}

describe('PdfStructuralOptimizationService — V2.2', () => {
  it('does not execute qpdf PDF-output candidates for the R5-confirmed high-risk workload', async () => {
    const source = file(15 * 1024 * 1024);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => file(14 * 1024 * 1024)),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(source, forensic({ pageCount: 842 }), 'recommended', undefined, undefined, 842);

    expect(qpdf.optimizeStructuralCandidate).not.toHaveBeenCalled();
    expect(result.attemptedKinds).toEqual([]);
    expect(result.skippedKinds.length).toBe(5);
    expect(result.selected).toBeNull();
    expect(result.diagnostics).toHaveLength(5);
    expect(result.diagnostics.every(diagnostic => diagnostic.reason === 'QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD')).toBe(true);
    expect(result.diagnostics.every(diagnostic => diagnostic.resourceRisk === 'high')).toBe(true);
    expect(result.diagnostics.every(diagnostic => diagnostic.optimizationProfile === 'conservative')).toBe(true);
    expect(result.qpdfAttemptDecision).toMatchObject({
      scope: 'structural',
      state: 'guard-blocked',
      reason: 'RESOURCE_GUARD_BLOCKED',
    });
  });

  it('blocks qpdf output when forensic evidence is unavailable instead of assuming low risk', async () => {
    const source = file(500_000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => file(450_000)),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(source, undefined, 'recommended', undefined, undefined, 20);

    expect(qpdf.optimizeStructuralCandidate).not.toHaveBeenCalled();
    expect(result.qpdfAttemptDecision).toMatchObject({
      state: 'guard-blocked',
      reason: 'RESOURCE_GUARD_BLOCKED',
    });
    expect(result.diagnostics.every(diagnostic => diagnostic.resourceRisk === 'unknown')).toBe(true);
    expect(result.diagnostics.every(diagnostic => diagnostic.reason === 'QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD')).toBe(true);
  });

  it('records an explicit structural qpdf attempt decision when candidates are selected', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => file(900)),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(source, forensic(), 'light');

    expect(result.qpdfAttemptDecision).toMatchObject({
      scope: 'structural',
      state: 'attempted',
      reason: 'QPDF_ATTEMPTED',
    });
    expect(result.qpdfAttemptDecision?.attemptedKinds.length).toBeGreaterThan(0);
  });

  it('selects forensic-driven structural candidates and chooses the smallest valid output', async () => {
    const source = file(1000);
    const outputs = new Map([
      ['baseline', file(900)],
      ['content-coalesce', file(850)],
      ['resource-prune-and-coalesce', file(800)],
      ['image-resource', file(820)],
    ]);

    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async (
        _file: File,
        kind: string,
      ) => outputs.get(kind as string) ?? file(950)),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(
      source,
      forensic(),
      'recommended',
    );

    expect(qpdf.optimizeStructuralCandidate).toHaveBeenCalled();
    expect(result.attemptedKinds).toContain('baseline');
    expect(result.attemptedKinds).toContain('content-coalesce');
    expect(result.attemptedKinds).toContain('resource-prune-and-coalesce');
    expect(result.selected?.outputBytes).toBe(800);
    expect(result.diagnostics.length).toBe(result.attemptedKinds.length);
    expect(result.diagnostics.every(diagnostic => diagnostic.inputBytes === source.size)).toBe(true);
  });

  it('never selects a candidate that is not smaller than the source', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => file(1000)),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(
      source,
      forensic({
        duplicateStreamGroupCount: 0,
        duplicatePageContentStreamGroupCount: 0,
        uniqueImageResourceCount: 0,
        imageBytes: 0,
      }),
      'light',
    );

    expect(result.selected).toBeNull();
    expect(result.candidates.every(candidate => candidate.valid)).toBe(true);
  });

  it('continues safely when one structural candidate fails', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async (
        _file: File,
        kind: string,
      ) => {
        if (kind === 'content-coalesce') {
          throw new Error('candidate failure');
        }
        return file(kind === 'baseline' ? 950 : 900);
      }),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(
      source,
      forensic(),
      'recommended',
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.selected).not.toBeNull();
    expect(result.diagnostics.some(diagnostic => diagnostic.kind === 'content-coalesce')).toBe(true);
  });

  it('records a qpdf execution failure with privacy-safe diagnostics', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => {
        throw new QpdfStructuralCandidateError(
          'baseline',
          {
            ok: false,
            outputs: {},
            stdout: [],
            stderr: ['qpdf error'],
            warnings: ['warning'],
            exitCode: 2,
            durationMs: 10,
          },
          'qpdf failed',
        );
      }),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(source, forensic({
      duplicateStreamGroupCount: 0,
      duplicatePageContentStreamGroupCount: 0,
      uniqueImageResourceCount: 0,
      imageBytes: 0,
    }), 'light');

    expect(result.selected).toBeNull();
    expect(result.diagnostics[0]?.reason).toBe('QPDF_EXECUTION_FAILED');
    expect(result.diagnostics[0]?.qpdfExitCode).toBe(2);
    expect(result.diagnostics[0]?.qpdfErrorCount).toBe(1);
    expect(result.diagnostics[0]?.qpdfWarningCount).toBe(1);
  });

  it('records runner failure name, phase, and sanitized message', async () => {
    const source = file(1000);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => {
        throw new QpdfStructuralCandidateError(
          'baseline',
          null,
          '<path>',
          'QPDF_RUN_FAILED',
          {
            phase: 'runner-run',
            name: 'Error',
            message: '<path>',
          },
        );
      }),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(source, forensic({
      duplicateStreamGroupCount: 0,
      duplicatePageContentStreamGroupCount: 0,
      uniqueImageResourceCount: 0,
      imageBytes: 0,
    }), 'light');

    expect(result.diagnostics[0]?.reason).toBe('QPDF_RUN_FAILED');
    expect(result.diagnostics[0]?.runtimeErrorPhase).toBe('runner-run');
    expect(result.diagnostics[0]?.runtimeErrorName).toBe('Error');
    expect(result.diagnostics[0]?.runtimeErrorMessage).toBe('<path>');
    expect(JSON.stringify(result.diagnostics)).not.toContain('qpdf error');
  });
  it('stops structural qpdf fan-out after a memory exhaustion failure', async () => {
    const source = file(1024 * 1024);
    const qpdf = {
      optimizeStructuralCandidate: vi.fn(async () => {
        throw new QpdfStructuralCandidateError(
          'baseline',
          null,
          'Aborted(OOM). Build with -sASSERTIONS for more info.',
          'QPDF_MEMORY_EXHAUSTED',
          {
            phase: 'runner-run',
            name: 'QpdfRunError',
            message: 'Aborted(OOM). Build with -sASSERTIONS for more info.',
          },
        );
      }),
    } as unknown as QpdfWasmPrototypeService;

    const service = new PdfStructuralOptimizationService(qpdf, semanticMock(), new QpdfWasmResourceGuardService());
    // Isolate candidate scheduling here; real PDF parsing is covered by the browser integrity tests.
    vi.spyOn(service as any, 'validateCandidate').mockResolvedValue({ valid: true });
    const result = await service.optimize(
      source,
      forensic({ pageCount: 10 }),
      'strong',
    );

    expect(qpdf.optimizeStructuralCandidate).toHaveBeenCalledTimes(1);
    expect(result.diagnostics[0]?.reason).toBe('QPDF_MEMORY_EXHAUSTED');
    expect(result.diagnostics[0]?.resourceRisk).toBe('low');
    expect(result.diagnostics[0]?.optimizationProfile).toBe('standard');
  });

});

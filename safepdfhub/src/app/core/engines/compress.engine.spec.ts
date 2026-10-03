import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { CompressEngine } from './compress.engine';
import { CompressionPlan } from '../compression/compression-plan';
import { PdfFileAnalysis } from '../compression/pdf-analysis.models';

function makeFile(name = 'fixture.pdf'): File {
  return new File([new Uint8Array(100_000)], name, { type: 'application/pdf' });
}

function makeAnalysis(
  pages = 2,
  type: PdfFileAnalysis['type'] = 'mixed',
  forensic?: PdfFileAnalysis['forensic'],
): PdfFileAnalysis {
  return {
    type,
    pages,
    analysis: {
      type,
      avgTextDensity: 100,
      largePages: false,
      imageHeavy: true,
      imageRatio: 0.5,
      imageCount: pages,
      vectorOperatorCount: 20,
      pagesAnalyzed: Math.min(pages, 8),
    },
    forensic,
  };
}

function makePlan(strategy: CompressionPlan['strategy']): CompressionPlan {
  return {
    strategy,
    quality: 0.8,
    scale: 0.85,
    maxWidth: 1400,
    maxHeight: 1900,
    estimatedReduction: 25,
  };
}

function makeEngine(deps: Partial<Record<string, unknown>> = {}): CompressEngine {
  return new CompressEngine(
    deps['analyzer'] as never,
    deps['planner'] as never,
    deps['renderer'] as never,
    deps['embedder'] as never,
    (deps['worker'] ?? { cancel: vi.fn() }) as never,
    (deps['capability'] ?? {
      budget: {
        maxPages: 40_000,
        maxFileBytes: 100 * 1024 * 1024,
      },
    }) as never,
    deps['pdfJsLoader'] as never,
    (deps['qpdf'] ?? {
      optimizeForCompression: vi.fn(async (file: File) => file),
      cancel: vi.fn(),
    }) as never,
    (deps['structural'] ?? {
      optimize: vi.fn(async () => ({
        inputBytes: 100_000,
        selected: null,
        candidates: [],
        attemptedKinds: [],
        skippedKinds: [],
        forensicDriven: false,
      })),
    }) as never,
    (deps['image'] ?? {
      optimize: vi.fn(async () => ({
        inputBytes: 100_000,
        risk: 'none',
        eligible: false,
        skippedReason: 'test',
        attemptedQualities: [],
        candidates: [],
        selected: null,
      })),
    }) as never,
    (deps['candidateCertification'] ?? {
      certifySmallest: vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => {
        const selected = candidates
          .filter((candidate): candidate is File => candidate !== null && candidate !== undefined)
          .sort((a, b) => a.size - b.size)[0] ?? null;
        return {
          sourceFingerprint: 'test-source',
          candidatesConsidered: selected ? 1 : 0,
          uniqueCandidatesCertified: selected ? 1 : 0,
          cacheHits: 0,
          duplicateCandidatesSkipped: 0,
          evaluations: [],
          selected,
          durationMs: 0,
        };
      }),
    }) as never,
    (deps['resourceGuard'] ?? {
      profile: vi.fn(() => ({
        fileBytes: 100_000,
        pages: 2,
        largeWorkload: false,
        highWorkload: false,
        maxStrategyBranches: 3 as const,
      })),
    }) as never,
    (deps['qpdfResourceGuard'] ?? {
      profile: vi.fn(() => ({
        risk: 'low' as const,
        evidenceQuality: 'complete' as const,
        unknownSignals: [] as const,
        optimizationProfile: 'standard' as const,
        maxStructuralCandidates: 3 as const,
        allowImageOptimization: true,
        allowPdfOutput: true,
        reason: null,
      })),
    }) as never,
    (deps['native'] ?? { optimizeCandidates: vi.fn(async () => []) }) as never,
  );
}

describe('CompressEngine — R7.5.3 unified metadata preservation', () => {
  it('preserves the complete source Info dictionary without pdf-lib default metadata', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.setTitle('GAO Report');
    source.setAuthor('Government Accountability Office');
    source.setSubject('Performance, Accountability & Fiscal Year 2021');
    source.setKeywords(['alpha,beta', 'gamma  delta']);
    source.setCreator('Original Creator');
    source.setProducer('Original Producer');
    source.setCreationDate(new Date('2021-11-15T12:34:56.000Z'));
    source.setModificationDate(new Date('2022-01-02T03:04:05.000Z'));

    const target = await PDFDocument.create({ updateMetadata: false });
    (makeEngine() as any).copyDocumentMetadata(source, target);

    expect(target.getTitle()).toBe(source.getTitle());
    expect(target.getAuthor()).toBe(source.getAuthor());
    expect(target.getSubject()).toBe(source.getSubject());
    expect(target.getKeywords()).toBe(source.getKeywords());
    expect(target.getCreator()).toBe(source.getCreator());
    expect(target.getProducer()).toBe(source.getProducer());
    expect(target.getCreationDate()?.toISOString()).toBe(source.getCreationDate()?.toISOString());
    expect(target.getModificationDate()?.toISOString()).toBe(source.getModificationDate()?.toISOString());
  });

  it('preserves metadata across the serialized candidate round trip', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([612, 792]);
    source.setTitle('Serialized GAO Report');
    source.setAuthor('Government Accountability Office');
    source.setSubject('Serialized metadata regression');
    source.setKeywords(['alpha,beta', 'gamma  delta']);
    source.setCreator('Original Creator');
    source.setProducer('Original Producer');
    source.setCreationDate(new Date('2021-11-15T12:34:56.000Z'));
    source.setModificationDate(new Date('2022-01-02T03:04:05.000Z'));

    const sourceBytes = await source.save({ updateFieldAppearances: false });
    const sourceFile = new File([new Uint8Array(sourceBytes)], 'source.pdf', { type: 'application/pdf' });

    const candidate = await PDFDocument.create({ updateMetadata: false });
    candidate.addPage([612, 792]);
    const candidateBytes = await candidate.save({ updateFieldAppearances: false });
    const candidateFile = new File([new Uint8Array(candidateBytes)], 'candidate.pdf', { type: 'application/pdf' });

    const engine = makeEngine();
    const normalized = await (engine as any).preserveSourceMetadataOnCandidate(
      sourceFile,
      source,
      candidateFile,
    );
    const reloaded = await PDFDocument.load(await normalized.arrayBuffer(), {
      updateMetadata: false,
    });

    expect(reloaded.getTitle()).toBe(source.getTitle());
    expect(reloaded.getAuthor()).toBe(source.getAuthor());
    expect(reloaded.getSubject()).toBe(source.getSubject());
    expect(reloaded.getKeywords()).toBe(source.getKeywords());
    expect(reloaded.getCreator()).toBe(source.getCreator());
    expect(reloaded.getProducer()).toBe(source.getProducer());
    expect(reloaded.getCreationDate()?.toISOString()).toBe(source.getCreationDate()?.toISOString());
    expect(reloaded.getModificationDate()?.toISOString()).toBe(source.getModificationDate()?.toISOString());
  });

  it('removes candidate metadata when the source has no Info dictionary', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([612, 792]);
    const sourceBytes = await source.save({ updateFieldAppearances: false });
    const sourceFile = new File([new Uint8Array(sourceBytes)], 'source.pdf', { type: 'application/pdf' });

    const candidate = await PDFDocument.create({ updateMetadata: false });
    candidate.addPage([612, 792]);
    candidate.setTitle('Candidate-only title');
    candidate.setProducer('Candidate-only producer');
    const candidateBytes = await candidate.save({ updateFieldAppearances: false });
    const candidateFile = new File([new Uint8Array(candidateBytes)], 'candidate.pdf', { type: 'application/pdf' });

    const engine = makeEngine();
    const normalized = await (engine as any).preserveSourceMetadataOnCandidate(
      sourceFile,
      source,
      candidateFile,
    );
    const reloaded = await PDFDocument.load(await normalized.arrayBuffer(), {
      updateMetadata: false,
    });

    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getProducer()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.getCreator()).toBeUndefined();
    expect(reloaded.getCreationDate()).toBeUndefined();
    expect(reloaded.getModificationDate()).toBeUndefined();
  });

  it('does not inject pdf-lib identity metadata when the source has none', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    const target = await PDFDocument.create({ updateMetadata: false });

    (makeEngine() as any).copyDocumentMetadata(source, target);

    expect(target.getTitle()).toBeUndefined();
    expect(target.getAuthor()).toBeUndefined();
    expect(target.getSubject()).toBeUndefined();
    expect(target.getKeywords()).toBeUndefined();
    expect(target.getCreator()).toBeUndefined();
    expect(target.getProducer()).toBeUndefined();
    expect(target.getCreationDate()).toBeUndefined();
    expect(target.getModificationDate()).toBeUndefined();
  });
});

describe('CompressEngine — C6', () => {
  // These are orchestration tests using synthetic byte arrays. Metadata
  // serialization is exercised with real PDFs in the R7.5.3 suite above.
  beforeEach(() => {
    vi.spyOn(CompressEngine.prototype as any, 'prepareCandidatesForCertification')
      .mockImplementation(async (_source: unknown, candidates: unknown) => candidates);
  });
  afterEach(() => vi.restoreAllMocks());
  it('skips the expensive legacy strategy for a high-risk qpdf-output-disabled workload', async () => {
    const engine = makeEngine({
      qpdfResourceGuard: {
        profile: vi.fn(() => ({
          risk: 'high' as const,
          evidenceQuality: 'complete' as const,
          unknownSignals: [] as const,
          optimizationProfile: 'conservative' as const,
          maxStructuralCandidates: 1 as const,
          allowImageOptimization: false,
          allowPdfOutput: false,
          reason: 'R5 baseline-output OOM evidence',
        })),
      },
    });
    const safe = vi.spyOn(engine, 'safeCompress').mockImplementation(async file => file);
    const smart = vi.spyOn(engine as any, 'smartCompress');

    const result = await engine.compress(
      new File([new Uint8Array(15 * 1024 * 1024)], 'high-risk.pdf'),
      'recommended',
      makePlan('smart'),
      makeAnalysis(842),
    );

    expect(result.size).toBe(15 * 1024 * 1024);
    expect(safe).not.toHaveBeenCalled();
    expect(smart).not.toHaveBeenCalled();
    expect(engine.lastExecutionTelemetry?.returnedOriginal).toBe(true);
    expect(engine.lastExecutionTelemetry?.candidates.some(
      candidate => candidate.label === 'skipped/high-qpdf-output-disabled',
    )).toBe(true);
  });

  it('uses one bounded safe fallback for unknown qpdf resource complexity', async () => {
    const engine = makeEngine({
      qpdfResourceGuard: {
        profile: vi.fn(() => ({
          risk: 'unknown' as const,
          evidenceQuality: 'metadata-only' as const,
          unknownSignals: ['streamBytes', 'imageBytes', 'objectCount'] as const,
          optimizationProfile: 'conservative' as const,
          maxStructuralCandidates: 0 as const,
          allowImageOptimization: false,
          allowPdfOutput: false,
          reason: 'incomplete forensic evidence',
        })),
      },
    });
    const safe = vi.spyOn(engine, 'safeCompress').mockImplementation(async file => file);
    const smart = vi.spyOn(engine as any, 'smartCompress');

    const result = await engine.compress(
      makeFile(),
      'recommended',
      makePlan('smart'),
      makeAnalysis(),
    );

    expect(safe).toHaveBeenCalledOnce();
    expect(smart).not.toHaveBeenCalled();
    expect(result.size).toBe(100_000);
    expect(engine.lastExecutionTelemetry?.candidates.some(
      candidate => candidate.label === 'safe/unknown-qpdf-disabled/unknown-safe',
    )).toBe(true);
  });

  it('routes safe strategy through safe compression', async () => {
    const engine = makeEngine();
    const safe = vi.spyOn(engine, 'safeCompress').mockResolvedValue(makeFile('safe.pdf'));

    const result = await engine.compress(
      makeFile(),
      'recommended',
      makePlan('safe'),
      makeAnalysis(),
    );

    expect(safe).toHaveBeenCalledOnce();
    expect(result.name).toBe('safe.pdf');
  });

  it('routes smart and strong strategies through their raster pipelines', async () => {
    const engine = makeEngine();
    const smart = vi.spyOn(engine as any, 'smartCompress').mockResolvedValue(makeFile('smart.pdf'));
    const strong = vi.spyOn(engine as any, 'strongCompress').mockResolvedValue(makeFile('strong.pdf'));

    await expect(
      engine.compress(makeFile(), 'recommended', makePlan('smart'), makeAnalysis()),
    ).resolves.toHaveProperty('name', 'smart.pdf');

    await expect(
      engine.compress(makeFile(), 'strong', makePlan('strong'), makeAnalysis()),
    ).resolves.toHaveProperty('name', 'strong.pdf');

    expect(smart).toHaveBeenCalledOnce();
    expect(strong).toHaveBeenCalledOnce();
  });

  it('falls back to safe compression when the cached analysis exceeds capacity', async () => {
    const engine = makeEngine({
      capability: {
        budget: {
          maxPages: 1,
          maxFileBytes: 1_000_000,
        },
      },
    });
    const safe = vi.spyOn(engine, 'safeCompress').mockResolvedValue(makeFile('safe.pdf'));

    await engine.compress(
      makeFile(),
      'recommended',
      makePlan('smart'),
      makeAnalysis(2),
    );

    expect(safe).toHaveBeenCalledOnce();
  });

  it('does not rasterize an already-small-per-page PDF', async () => {
    const engine = makeEngine();
    const safe = vi.spyOn(engine, 'safeCompress').mockResolvedValue(makeFile('safe.pdf'));

    const tiny = new File([new Uint8Array(14_000)], 'tiny.pdf', { type: 'application/pdf' });

    await engine.compress(
      tiny,
      'recommended',
      makePlan('strong'),
      makeAnalysis(1),
    );

    expect(safe).toHaveBeenCalledOnce();
  });

  it('certifies the already-compressed fast-path candidate before returning it', async () => {
    const tiny = new File([new Uint8Array(14_000)], 'tiny.pdf', { type: 'application/pdf' });
    const safeFile = new File([new Uint8Array(9_000)], 'safe.pdf', { type: 'application/pdf' });
    const certifySmallest = vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
      sourceFingerprint: 'source-fp',
      candidatesConsidered: 1,
      uniqueCandidatesCertified: 1,
      cacheHits: 0,
      duplicateCandidatesSkipped: 0,
      evaluations: [{
        candidate: safeFile,
        fingerprint: 'candidate-fp',
        result: { status: 'passed', pagesChecked: 1, totalPages: 1, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1, reason: null },
        cacheHit: false,
        duplicateOfFingerprint: null,
      }],
      selected: safeFile,
      durationMs: 1,
    }));
    const engine = makeEngine({ candidateCertification: { certifySmallest } });
    vi.spyOn(engine, 'safeCompress').mockResolvedValue(safeFile);

    const result = await engine.compress(
      tiny,
      'recommended',
      makePlan('strong'),
      makeAnalysis(1),
    );

    expect(certifySmallest).toHaveBeenCalledOnce();
    expect(certifySmallest.mock.calls[0][1]).toEqual([safeFile]);
    expect(result).toBe(safeFile);
    expect(engine.lastExecutionTelemetry?.candidates[0]?.certification).toBe('passed');
    expect(engine.lastExecutionTelemetry?.candidates[0]?.candidateFingerprint).toBe('candidate-fp');
    expect(engine.lastExecutionTelemetry?.structuralStage.entered).toBe(false);
    expect(engine.lastExecutionTelemetry?.structuralStage.completed).toBe(false);
    expect(engine.lastExecutionTelemetry?.structuralStage.decisionReason).toBe('ALREADY_COMPRESSED_FAST_PATH');
    expect(engine.lastExecutionTelemetry?.finalDecision).toBe('certified-candidate');
  });

  it('re-analyzes the structural branch and routes branch-specific forensic data in V2.12', async () => {
    const source = makeFile('source.pdf');
    const structuralFile = new File([new Uint8Array(80_000)], 'structural.pdf', { type: 'application/pdf' });
    const imageFromSource = new File([new Uint8Array(70_000)], 'image-source.pdf', { type: 'application/pdf' });
    const imageFromStructural = new File([new Uint8Array(60_000)], 'image-structural.pdf', { type: 'application/pdf' });
    const sourceForensic = { uniqueImageResourceCount: 2, imageBytes: 60_000, sampledImageAreaRatio: 0.20, imageResources: [{ filter: '/FlateDecode' }, { filter: '/DCTDecode' }] } as any;
    const structuralForensic = { uniqueImageResourceCount: 1, imageBytes: 70_000, sampledImageAreaRatio: 0.42, imageResources: [{ filter: '/FlateDecode' }] } as any;

    const optimize = vi.fn()
      .mockResolvedValueOnce({
        inputBytes: source.size, risk: 'medium', eligible: true, skippedReason: null, attemptedQualities: [80],
        candidates: [{ quality: 80, file: imageFromSource, inputBytes: source.size, outputBytes: imageFromSource.size, reductionBytes: source.size - imageFromSource.size, reductionPercent: 30, valid: true, visualFidelity: null, semanticIntegrity: null, durationMs: 5 }],
        selected: null,
      })
      .mockResolvedValueOnce({
        inputBytes: structuralFile.size, risk: 'high', eligible: true, skippedReason: null, attemptedQualities: [76],
        candidates: [{ quality: 76, file: imageFromStructural, inputBytes: structuralFile.size, outputBytes: imageFromStructural.size, reductionBytes: structuralFile.size - imageFromStructural.size, reductionPercent: 25, valid: true, visualFidelity: null, semanticIntegrity: null, durationMs: 5 }],
        selected: null,
      });

    const analyzeFile = vi.fn(async (file: File) => ({
      type: 'mixed' as const,
      pages: 2,
      analysis: makeAnalysis(2).analysis,
      forensic: file === structuralFile ? structuralForensic : sourceForensic,
    }));

    const engine = makeEngine({
      analyzer: { analyzeFile },
      structural: { optimize: vi.fn(async () => ({
        inputBytes: source.size, selected: { kind: 'baseline', file: structuralFile, inputBytes: source.size, outputBytes: structuralFile.size, reductionBytes: source.size - structuralFile.size, reductionPercent: 20, valid: true, semanticIntegrity: null, durationMs: 5 }, candidates: [], attemptedKinds: ['baseline'], skippedKinds: [], forensicDriven: true,
      })) },
      image: { optimize },
      candidateCertification: { certifySmallest: vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
        sourceFingerprint: 'source-fp', candidatesConsidered: candidates.filter(Boolean).length, uniqueCandidatesCertified: candidates.filter(Boolean).length, cacheHits: 0, duplicateCandidatesSkipped: 0, evaluations: [], selected: imageFromStructural, durationMs: 1,
      })) },
    });

    vi.spyOn(engine, 'safeCompress').mockResolvedValue(new File([new Uint8Array(55_000)], 'strategy.pdf', { type: 'application/pdf' }));

    await engine.compress(source, 'recommended', makePlan('safe'), makeAnalysis(2, 'mixed', sourceForensic));

    expect(analyzeFile).toHaveBeenCalledOnce();
    expect(analyzeFile).toHaveBeenCalledWith(structuralFile, expect.any(AbortSignal));
    expect(optimize).toHaveBeenCalledTimes(2);
    expect(optimize.mock.calls[0]?.[0]).toBe(source);
    expect(optimize.mock.calls[0]?.[1]).toBe(sourceForensic);
    expect(optimize.mock.calls[1]?.[0]).toBe(structuralFile);
    expect(optimize.mock.calls[1]?.[1]).toBe(structuralForensic);
  });

  it('skips structural image optimization when branch forensic analysis fails in V2.12', async () => {
    const source = makeFile('source.pdf');
    const structuralFile = new File([new Uint8Array(80_000)], 'structural.pdf', { type: 'application/pdf' });
    const sourceForensic = { uniqueImageResourceCount: 1, imageBytes: 60_000, sampledImageAreaRatio: 0.20, imageResources: [{ filter: '/FlateDecode' }] } as any;
    const optimize = vi.fn(async (_file: File, _forensic?: unknown) => ({
      inputBytes: source.size, risk: 'medium', eligible: true, skippedReason: null, attemptedQualities: [80],
      candidates: [], selected: null,
    }));
    const analyzeFile = vi.fn(async () => { throw new Error('branch analysis failed'); });

    const engine = makeEngine({
      analyzer: { analyzeFile },
      structural: { optimize: vi.fn(async () => ({
        inputBytes: source.size, selected: { kind: 'baseline', file: structuralFile, inputBytes: source.size, outputBytes: structuralFile.size, reductionBytes: source.size - structuralFile.size, reductionPercent: 20, valid: true, semanticIntegrity: null, durationMs: 5 }, candidates: [], attemptedKinds: ['baseline'], skippedKinds: [], forensicDriven: true,
      })) },
      image: { optimize },
    });
    vi.spyOn(engine, 'safeCompress').mockResolvedValue(source);

    await engine.compress(source, 'recommended', makePlan('safe'), makeAnalysis(2, 'mixed', sourceForensic));

    expect(analyzeFile).toHaveBeenCalledOnce();
    expect(optimize).toHaveBeenCalledOnce();
    expect(optimize.mock.calls[0]?.[0]).toBe(source);
    expect(optimize.mock.calls[0]?.[1]).toBe(sourceForensic);
  });

  it('deduplicates byte-identical strategy inputs before legacy strategy execution in V2.16', async () => {
    const engine = makeEngine();
    const sharedBytes = new Uint8Array(54_000);
    const image = new File([sharedBytes], 'strategy-image.pdf', { type: 'application/pdf' });
    const structural = new File([sharedBytes], 'strategy-structural.pdf', { type: 'application/pdf' });
    const source = new File([new Uint8Array(57_000)], 'strategy-source.pdf', { type: 'application/pdf' });
    const strategyOutput = new File([new Uint8Array(40_000)], 'strategy-output.pdf', { type: 'application/pdf' });

    vi.spyOn(engine, 'safeCompress').mockResolvedValue(strategyOutput);
    const certification = vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
      sourceFingerprint: 'source-fp',
      candidatesConsidered: candidates.filter(Boolean).length,
      uniqueCandidatesCertified: candidates.filter(Boolean).length,
      cacheHits: 0,
      duplicateCandidatesSkipped: 0,
      evaluations: [],
      selected: strategyOutput,
      durationMs: 0,
    }));

    const engineWithCertification = makeEngine({
      structural: {
        optimize: vi.fn(async () => ({
          inputBytes: 100_000,
          selected: { file: structural, kind: 'resource-prune', inputBytes: 100_000, outputBytes: structural.size, valid: true, durationMs: 1 },
          candidates: [{ file: structural, kind: 'resource-prune', inputBytes: 100_000, outputBytes: structural.size, valid: true, durationMs: 1 }],
          attemptedKinds: ['resource-prune'],
          skippedKinds: [],
          forensicDriven: true,
        })),
      },
      image: {
        optimize: vi.fn(async () => ({
          inputBytes: 100_000,
          risk: 'none',
          eligible: true,
          skippedReason: null,
          attemptedQualities: [80],
          candidates: [{ file: image, quality: 80, inputBytes: 100_000, outputBytes: image.size, valid: true, durationMs: 1 }],
          selected: { file: image, quality: 80, inputBytes: 100_000, outputBytes: image.size, valid: true, durationMs: 1 },
        })),
      },
      analyzer: { analyzeFile: vi.fn(async () => makeAnalysis()) },
      candidateCertification: { certifySmallest: certification },
    });
    vi.spyOn(engineWithCertification, 'safeCompress').mockResolvedValue(strategyOutput);

    await engineWithCertification.compress(source, 'recommended', makePlan('safe'), makeAnalysis());

    expect(engineWithCertification.safeCompress).toHaveBeenCalledTimes(2);
    expect(certification).toHaveBeenCalled();
    expect(engineWithCertification.lastExecutionTelemetry?.candidates.some(candidate =>
      candidate.label === 'preflight-duplicate-skipped/image'
      && candidate.certification === 'duplicate-skipped',
    )).toBe(true);
  });

  it('explores a bounded source-preserving third legacy-strategy branch in V2.15', async () => {
    const source = makeFile('source.pdf');
    const structuralFile = new File([new Uint8Array(80_000)], 'structural.pdf', { type: 'application/pdf' });
    const imageFile = new File([new Uint8Array(60_000)], 'image.pdf', { type: 'application/pdf' });
    const firstStrategy = new File([new Uint8Array(54_000)], 'strategy-image.pdf', { type: 'application/pdf' });
    const secondStrategy = new File([new Uint8Array(58_000)], 'strategy-structural.pdf', { type: 'application/pdf' });
    const thirdStrategy = new File([new Uint8Array(57_000)], 'strategy-source.pdf', { type: 'application/pdf' });
    const sourceForensic = { uniqueImageResourceCount: 2, imageBytes: 60_000, sampledImageAreaRatio: 0.20, imageResources: [{ filter: '/FlateDecode' }] } as any;
    const structuralForensic = { uniqueImageResourceCount: 1, imageBytes: 50_000, sampledImageAreaRatio: 0.30, imageResources: [{ filter: '/FlateDecode' }] } as any;

    const analyzeFile = vi.fn(async () => makeAnalysis(2, 'mixed', structuralForensic));
    const structural = {
      optimize: vi.fn(async () => ({
        inputBytes: source.size,
        selected: { kind: 'baseline' as const, file: structuralFile, inputBytes: source.size, outputBytes: structuralFile.size, reductionBytes: source.size - structuralFile.size, reductionPercent: 20, valid: true, semanticIntegrity: null, durationMs: 5 },
        candidates: [{ kind: 'baseline' as const, file: structuralFile, inputBytes: source.size, outputBytes: structuralFile.size, reductionBytes: source.size - structuralFile.size, reductionPercent: 20, valid: true, semanticIntegrity: null, durationMs: 5 }],
        attemptedKinds: ['baseline' as const], skippedKinds: [], forensicDriven: true,
      })),
    };
    const image = {
      optimize: vi.fn(async () => ({
        inputBytes: source.size, risk: 'medium', eligible: true, skippedReason: null, attemptedQualities: [80],
        candidates: [{ quality: 80, file: imageFile, inputBytes: structuralFile.size, outputBytes: imageFile.size, reductionBytes: structuralFile.size - imageFile.size, reductionPercent: 25, valid: true, visualFidelity: null, semanticIntegrity: null, durationMs: 5 }], selected: imageFile,
      })),
    };
    const certifySmallest = vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
      sourceFingerprint: 'source-fp',
      candidatesConsidered: candidates.filter(Boolean).length,
      uniqueCandidatesCertified: candidates.filter(Boolean).length,
      cacheHits: 0, duplicateCandidatesSkipped: 0,
      evaluations: [...new Set(candidates.filter((candidate): candidate is File => !!candidate))].map((candidate, index) => ({
        candidate, fingerprint: `fp-${index + 1}`,
        result: { status: 'passed' as const, pagesChecked: 1, totalPages: 1, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1, reason: null },
        cacheHit: false, duplicateOfFingerprint: null,
      })),
      selected: firstStrategy, durationMs: 2,
    }));

    const engine = makeEngine({
      analyzer: { analyzeFile },
      structural,
      image,
      candidateCertification: { certifySmallest },
    });
    const safe = vi.spyOn(engine, 'safeCompress')
      .mockResolvedValueOnce(firstStrategy)
      .mockResolvedValueOnce(secondStrategy)
      .mockResolvedValueOnce(thirdStrategy);

    const result = await engine.compress(
      source,
      'recommended',
      makePlan('safe'),
      makeAnalysis(2, 'mixed', sourceForensic),
    );

    expect(safe).toHaveBeenCalledTimes(3);
    expect(safe.mock.calls[0]?.[0]).toBe(imageFile);
    expect(safe.mock.calls[1]?.[0]).toBe(structuralFile);
    expect(safe.mock.calls[2]?.[0]).toBe(source);
    expect(certifySmallest.mock.calls[0]?.[1]).toEqual([structuralFile, imageFile, firstStrategy, secondStrategy, thirdStrategy]);
    expect(result).toBe(firstStrategy);
    expect(engine.lastExecutionTelemetry?.candidates.filter(candidate => candidate.stage === 'strategy')).toHaveLength(3);
  });

  it('maps certification telemetry by candidate identity rather than output size', async () => {
    const source = makeFile();
    const first = new File([new Uint8Array(60_000)], 'first.pdf', { type: 'application/pdf' });
    const second = new File([new Uint8Array(60_000)], 'second.pdf', { type: 'application/pdf' });
    const certifySmallest = vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
      sourceFingerprint: 'source-fp',
      candidatesConsidered: 2,
      uniqueCandidatesCertified: 2,
      cacheHits: 0,
      duplicateCandidatesSkipped: 0,
      evaluations: [...new Set(candidates.filter((candidate): candidate is File => !!candidate))].map((candidate, index) => ({
        candidate,
        fingerprint: `fp-${index + 1}`,
        result: { status: index === 1 ? 'passed' as const : 'rejected' as const, pagesChecked: 1, totalPages: 1, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1, reason: index === 1 ? null : 'fixture rejection' },
        cacheHit: false,
        duplicateOfFingerprint: null,
      })),
      selected: second,
      durationMs: 2,
    }));
    const structural = {
      optimize: vi.fn(async () => ({
        inputBytes: source.size,
        selected: { file: first },
        candidates: [{
          kind: 'baseline' as const,
          file: first,
          inputBytes: source.size,
          outputBytes: first.size,
          reductionBytes: source.size - first.size,
          reductionPercent: 40,
          valid: true,
          semanticIntegrity: null,
          durationMs: 1,
        }],
        attemptedKinds: ['baseline' as const],
        skippedKinds: [],
        forensicDriven: false,
      })),
    };
    const engine = makeEngine({ structural, candidateCertification: { certifySmallest } });
    vi.spyOn(engine, 'safeCompress').mockResolvedValue(second);

    const result = await engine.compress(source, 'recommended', makePlan('safe'), makeAnalysis());

    expect(result).toBe(second);
    const telemetry = engine.lastExecutionTelemetry?.candidates ?? [];
    const firstTelemetry = telemetry.find(candidate => candidate.outputBytes === first.size && candidate.label === 'baseline');
    const strategyTelemetry = telemetry.find(candidate => candidate.stage === 'strategy' && candidate.certification === 'passed');
    expect(firstTelemetry?.candidateFingerprint).toBe('fp-1');
    expect(firstTelemetry?.certification).toBe('rejected');
    expect(firstTelemetry?.certificationReason).toBe('fixture rejection');
    expect(strategyTelemetry?.candidateFingerprint).toBe('fp-2');
    expect(strategyTelemetry?.certification).toBe('passed');
    expect(engine.lastExecutionTelemetry?.selectedLabel).toBe(strategyTelemetry?.label);
  });

  it('feeds a validated V2.2 structural candidate into the legacy strategy and compares it with the final result', async () => {
    const source = makeFile();
    const structuralFile = new File(
      [new Uint8Array(60_000)],
      'structural.pdf',
      { type: 'application/pdf' },
    );
    const strategyFile = new File(
      [new Uint8Array(70_000)],
      'strategy.pdf',
      { type: 'application/pdf' },
    );

    const structural = {
      optimize: vi.fn(async () => ({
        inputBytes: source.size,
        selected: {
          kind: 'baseline' as const,
          file: structuralFile,
          inputBytes: source.size,
          outputBytes: structuralFile.size,
          reductionBytes: source.size - structuralFile.size,
          reductionPercent: 40,
          valid: true,
          durationMs: 1,
        },
        candidates: [],
        attemptedKinds: ['baseline' as const],
        skippedKinds: [],
        forensicDriven: false,
      })),
    };

    const engine = makeEngine({ structural });
    const safe = vi.spyOn(engine, 'safeCompress').mockImplementation(
      async (file: File) => {
        expect(['structural.pdf', 'fixture.pdf']).toContain(file.name);
        return strategyFile;
      },
    );

    const result = await engine.compress(
      source,
      'recommended',
      makePlan('safe'),
      makeAnalysis(),
    );

    expect(structural.optimize).toHaveBeenCalledOnce();
    expect(safe.mock.calls[0][0].name).toBe('structural.pdf');
    expect(result.name).toBe('structural.pdf');
    expect(result.size).toBe(60_000);
  });

  it('feeds the selected V2.3 image candidate into the legacy strategy and compares all actual candidates', async () => {
    const source = makeFile();
    const structuralFile = new File([new Uint8Array(80_000)], 'structural.pdf', { type: 'application/pdf' });
    const imageFile = new File([new Uint8Array(60_000)], 'image.pdf', { type: 'application/pdf' });
    const strategyFile = new File([new Uint8Array(70_000)], 'strategy.pdf', { type: 'application/pdf' });

    const structural = {
      optimize: vi.fn(async () => ({
        inputBytes: source.size,
        selected: {
          kind: 'baseline' as const,
          file: structuralFile,
          inputBytes: source.size,
          outputBytes: structuralFile.size,
          reductionBytes: source.size - structuralFile.size,
          reductionPercent: 20,
          valid: true,
          durationMs: 1,
        },
        candidates: [],
        attemptedKinds: ['baseline' as const],
        skippedKinds: [],
        forensicDriven: true,
      })),
    };
    const image = {
      optimize: vi.fn(async (file: File) => ({
        inputBytes: file.size,
        risk: 'medium' as const,
        eligible: true,
        skippedReason: null,
        attemptedQualities: [88, 80, 72],
        candidates: [{ file: imageFile, quality: 72, inputBytes: source.size, outputBytes: imageFile.size, valid: true, durationMs: 1 }],
        selected: {
          quality: 72,
          file: imageFile,
          inputBytes: file.size,
          outputBytes: imageFile.size,
          reductionBytes: file.size - imageFile.size,
          reductionPercent: 25,
          valid: true,
          durationMs: 2,
        },
      })),
    };

    const engine = makeEngine({ structural, image });
    const safe = vi.spyOn(engine, 'safeCompress').mockImplementation(async (file: File) => {
      expect(['image.pdf', 'structural.pdf', 'fixture.pdf']).toContain(file.name);
      return strategyFile;
    });

    const result = await engine.compress(
      source,
      'recommended',
      makePlan('safe'),
      makeAnalysis(),
    );

    expect(structural.optimize).toHaveBeenCalledOnce();
    expect(image.optimize).toHaveBeenCalledOnce();
    expect(safe.mock.calls[0][0].name).toBe('image.pdf');
    expect(result.name).toBe('image.pdf');
    expect(result.size).toBe(60_000);
  });

  it('selects a smaller qpdf candidate when raster output is not economical', async () => {
    const engine = makeEngine({
      qpdf: {
        optimizeForCompression: vi.fn(async () => new File([new Uint8Array(40_000)], 'optimized.pdf', { type: 'application/pdf' })),
      },
    });
    const source = new File([new Uint8Array(100_000)], 'input.pdf', { type: 'application/pdf' });
    const optimized = await (engine as any).tryQpdfOptimize(source, 70, 98, 80);
    const selected = (engine as any).pickSmallest(source, optimized);

    expect(optimized?.size).toBe(40_000);
    expect(selected.size).toBe(40_000);
  });

  it('uses the selected compression level to control qpdf JPEG quality', async () => {
    const optimizeForCompression = vi.fn(async (file: File, quality: number) => {
      expect(quality).toBe(65);
      return file;
    });
    const engine = makeEngine({
      qpdf: { optimizeForCompression },
    });

    await (engine as any).tryQpdfOptimize(makeFile(), 70, 98, 65);

    expect(optimizeForCompression).toHaveBeenCalledOnce();
    expect(optimizeForCompression.mock.calls[0][1]).toBe(65);
  });

  it('preserves page count, dimensions, and rotations through the raster validation path', async () => {
    const sourcePdf = await PDFDocument.create();
    const font = await sourcePdf.embedFont(StandardFonts.Helvetica);
    const geometries = [
      [595.28, 841.89, 0],
      [612, 792, 90],
      [700, 500, 180],
      [1000, 1400, 270],
    ] as const;

    for (const [width, height, rotation] of geometries) {
  const page = sourcePdf.addPage([width, height]);
  page.setRotation(degrees(rotation));

  // Make the valid source PDF materially larger than the mocked JPEG
  // output so the engine reaches the compressed-file path.
  for (let line = 0; line < 180; line++) {
    page.drawText(
      `Compression geometry regression fixture — page ${line + 1}`,
      {
        x: 24,
        y: Math.max(24, height - 24 - ((line % 70) * 10)),
        size: 8,
        font,
      },
    );
  }
}

    const sourceBytes = await sourcePdf.save();

const sourceBuffer = new ArrayBuffer(sourceBytes.byteLength);
new Uint8Array(sourceBuffer).set(sourceBytes);

const sourceFile = new File(
  [sourceBuffer],
  'geometry-fixture.pdf',
  { type: 'application/pdf' },
);

    const pdfPages = geometries.map(([width, height]) => ({
      getViewport: () => ({ width, height }),
      cleanup: vi.fn(),
    }));

    const fakePdf = {
      getPage: vi.fn(async (index: number) => pdfPages[index - 1]),
      destroy: vi.fn(async () => undefined),
    };

    const analyzer = {
      analyzePage: vi.fn(async (_page: unknown, index?: number) => ({
        type: 'mixed' as const,
        textDensity: 10,
        imageCount: 1,
        vectorOperatorCount: 5,
        estimatedImageArea: 500,
        estimatedPhotoPage: true,
        shouldRasterize: true,
      })),
    };

    const renderer = {
      renderToImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
    };

    const worker = {
      encodeJpeg: vi.fn(async () => new Uint8Array([1, 2, 3])),
    };

    const embedder = {
      addJpegPage: vi.fn(async (pdf: PDFDocument, _bytes: Uint8Array, geometry: {
        width: number;
        height: number;
        rotation: number;
      }) => {
        const page = pdf.addPage([geometry.width, geometry.height]);
        page.setRotation(degrees(geometry.rotation));
        return page;
      }),
    };

    const engine = makeEngine({
      analyzer,
      planner: { getAdaptiveScale: () => 0.85, getAdaptiveQuality: () => 0.8, getObjectsPerTick: () => 50 },
      renderer,
      embedder,
      worker,
      capability: { budget: { maxPages: 100, maxFileBytes: 100_000_000 } },
      pdfJsLoader: {},
    });

    vi.spyOn(engine as any, 'loadSourcePdf').mockResolvedValue({
      sourcePdf,
      pdf: fakePdf,
    });

    const result = await (engine as any).rasterCompress(
      sourceFile,
      makePlan('smart'),
      geometries.length,
      false,
    );

    const output = await PDFDocument.load(await result.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    expect(output.getPageCount()).toBe(geometries.length);
    expect(output.getPages().map((page) => [
      page.getWidth(),
      page.getHeight(),
      page.getRotation().angle,
    ])).toEqual(geometries.map(([width, height, rotation]) => [width, height, rotation]));
    expect(result.name).toContain('-safepdfhub_compressed.pdf');
  });

  it('keeps compression progress monotonic and records candidate lineage in V2.14', async () => {
    const source = makeFile('source.pdf');
    const structuralFile = new File([new Uint8Array(80_000)], 'structural.pdf', { type: 'application/pdf' });
    const imageFile = new File([new Uint8Array(70_000)], 'image.pdf', { type: 'application/pdf' });
    const strategyFile = new File([new Uint8Array(60_000)], 'strategy.pdf', { type: 'application/pdf' });
    const sourceForensic = { uniqueImageResourceCount: 1, imageBytes: 50_000 } as any;
    const structuralForensic = { uniqueImageResourceCount: 1, imageBytes: 40_000 } as any;
    const progress: number[] = [];

    const engine = makeEngine({
      structural: { optimize: vi.fn(async () => ({
        inputBytes: source.size,
        selected: { kind: 'content-coalesce', file: structuralFile, inputBytes: source.size, outputBytes: structuralFile.size, reductionBytes: source.size - structuralFile.size, reductionPercent: 20, valid: true, semanticIntegrity: null, durationMs: 1 },
        candidates: [], attemptedKinds: [], skippedKinds: [], forensicDriven: true,
      })) },
      analyzer: { analyzeFile: vi.fn(async () => ({ type: 'mixed' as const, pages: 2, analysis: makeAnalysis(2).analysis, forensic: structuralForensic })) },
      image: { optimize: vi.fn(async () => ({
        inputBytes: source.size, risk: 'medium', eligible: true, skippedReason: null, attemptedQualities: [80],
        candidates: [{ quality: 80, file: imageFile, inputBytes: source.size, outputBytes: imageFile.size, reductionBytes: source.size - imageFile.size, reductionPercent: 30, valid: true, visualFidelity: null, semanticIntegrity: null, durationMs: 1 }], selected: null,
      })) },
      candidateCertification: { certifySmallest: vi.fn(async (_source: File, candidates: readonly (File | null | undefined)[]) => ({
        sourceFingerprint: 'source-fp', candidatesConsidered: 3, uniqueCandidatesCertified: 3, cacheHits: 0, duplicateCandidatesSkipped: 0,
        evaluations: [
          { candidate: strategyFile, fingerprint: 'strategy-fp', result: { status: 'passed', pagesChecked: 1, totalPages: 2, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1 }, cacheHit: false, duplicateOfFingerprint: null },
          { candidate: imageFile, fingerprint: 'image-fp', result: { status: 'passed', pagesChecked: 1, totalPages: 2, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1 }, cacheHit: false, duplicateOfFingerprint: null },
          { candidate: structuralFile, fingerprint: 'structural-fp', result: { status: 'passed', pagesChecked: 1, totalPages: 2, metadataMatched: true, pageGeometryMatched: true, pageCountMatched: true, pages: [], durationMs: 1 }, cacheHit: false, duplicateOfFingerprint: null },
        ], selected: strategyFile, durationMs: 1,
      })) },
    });

    vi.spyOn(engine, 'safeCompress').mockImplementation(async (file, _level, cb) => {
      cb?.(100);
      return strategyFile;
    });

    const result = await engine.compress(
      source,
      'recommended',
      makePlan('safe'),
      makeAnalysis(2, 'mixed', sourceForensic),
      value => progress.push(value),
    );

    expect(result).toBe(strategyFile);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
    expect(engine.lastExecutionTelemetry?.candidates.some(candidate => candidate.parentFingerprint === 'source-fp')).toBe(true);
  });

});

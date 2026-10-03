import { describe, expect, it, vi } from 'vitest';
import { CompressionFacade } from './compress.facade';
import { CompressionState } from './compression.state';
import { CompressionPlan } from './compression-plan';
import { PdfFileAnalysis } from './pdf-analysis.models';

const plan: CompressionPlan = {
  strategy: 'smart',
  quality: 0.8,
  scale: 0.85,
  maxWidth: 1400,
  maxHeight: 1900,
  estimatedReduction: 25,
};

const analysis: PdfFileAnalysis = {
  type: 'mixed',
  pages: 3,
  analysis: {
    type: 'mixed',
    avgTextDensity: 100,
    largePages: false,
    imageHeavy: true,
    imageRatio: 0.66,
    imageCount: 3,
    vectorOperatorCount: 20,
    pagesAnalyzed: 3,
  },
};

function makeFile(name = 'input.pdf', size = 100_000): File {
  const file = new File([new Uint8Array(size)], name, { type: 'application/pdf' });
  return file;
}

describe('CompressionFacade — C6', () => {
  it('caches file analysis and reuses it for the compression call', async () => {
    const analyzer = {
      analyzeFile: vi.fn(async () => analysis),
    };
    const planner = {
      createPlan: vi.fn(() => plan),
    };
    const engine = {
      cancel: vi.fn(),
      compress: vi.fn(async (
        _file: File,
        _level: 'light' | 'recommended' | 'strong',
        _plan: CompressionPlan,
        cached: PdfFileAnalysis,
        onProgress?: (progress: number) => void,
      ) => {
        expect(cached).toBe(analysis);
        onProgress?.(42);
        return makeFile('input-safepdfhub_compressed.pdf', 60_000);
      }),
    };

    const state = new CompressionState();
    const facade = new CompressionFacade(
      analyzer as never,
      engine as never,
      planner as never,
      state,
    );

    const input = makeFile();
    await facade.analyze(input);
    await facade.compress(input);

    expect(analyzer.analyzeFile).toHaveBeenCalledOnce();
    expect(engine.compress).toHaveBeenCalledOnce();
    expect(state.analysisResult).toBe(analysis);
    expect(state.progress).toBe(100);
    expect(state.stage).toBe('complete');
    expect(state.originalSize).toBe(input.size);
    expect(state.finalSize).toBe(60_000);
    expect(state.reduction).toBe(40);
    expect(state.reductionBytes).toBe(input.size - 60_000);
    expect(state.compressionResult?.finalSize).toBe(60_000);
    expect(state.compressionResult?.reductionBytes).toBe(input.size - 60_000);
    expect(state.compressionResult?.pagesTotal).toBe(3);
    expect(state.compressionResult?.strategy).toBe('smart');
    expect(state.compressionResult?.returnedOriginal).toBe(false);
    expect(state.compressedFile?.name).toBe('input-safepdfhub_compressed.pdf');
    expect(state.compressing).toBe(false);
  });

  it('keeps planner estimates separate from authoritative execution results', async () => {
    const analyzer = {
      analyzeFile: vi.fn(async () => analysis),
    };
    const planner = {
      createPlan: vi.fn(() => plan),
    };
    const state = new CompressionState();
    const facade = new CompressionFacade(
      analyzer as never,
      {
        cancel: vi.fn(),
      compress: vi.fn(async (
          file: File,
          _level: 'light' | 'recommended' | 'strong',
          _plan: CompressionPlan,
          _cached: PdfFileAnalysis,
          onProgress?: (progress: number) => void,
        ) => {
          onProgress?.(100);
          return new File([new Uint8Array(4_000)], 'result.pdf', { type: 'application/pdf' });
        }),
      } as never,
      planner as never,
      state,
    );

    const input = makeFile('estimate-separation.pdf', 10_000);
    await facade.analyze(input);
    expect(state.estimatedReduction).toBe(25);
    expect(state.estimatedFinalSize).toBeCloseTo((10_000 / 1024 / 1024) * 0.75);

    await facade.compress(input);

    expect(state.estimatedReduction).toBe(25);
    expect(state.estimatedFinalSize).toBeCloseTo((10_000 / 1024 / 1024) * 0.75);
    expect(state.finalSize).toBe(4_000);
    expect(state.reduction).toBe(60);
  });

  it('updates the estimate from the selected compression plan', async () => {
    const analyzer = {
      analyzeFile: vi.fn(async () => analysis),
    };
    const planner = {
      createPlan: vi.fn(() => plan),
    };
    const state = new CompressionState();

    const facade = new CompressionFacade(
      analyzer as never,
      { cancel: vi.fn(),
      compress: vi.fn() } as never,
      planner as never,
      state,
    );

    const input = makeFile('estimate.pdf', 10 * 1024 * 1024);
    const estimate = await facade.analyze(input);

    expect(planner.createPlan).toHaveBeenCalledWith(
      analysis.analysis,
      analysis.pages,
      state.compressionLevel,
    );
    expect(estimate.estimatedReduction).toBe(25);
    expect(estimate.estimatedFinalSize).toBeCloseTo(7.5);
    expect(state.analyzedPdfType).toBe('mixed');
  });
});


describe('CompressionFacade operation ownership', () => {
  it('rejects a cancelled completion without publishing a result', async () => {
    let finish!: (file: File) => void;
    const engine = {
      cancel: vi.fn(),
      compress: vi.fn(() => new Promise<File>(resolve => { finish = resolve; })),
    };
    const state = new CompressionState();
    const facade = new CompressionFacade(
      { analyzeFile: vi.fn(async () => analysis) } as never,
      engine as never, { createPlan: () => plan } as never, state,
    );
    const file = makeFile();
    const run = facade.compress(file);
    await vi.waitFor(() => expect(engine.compress).toHaveBeenCalledOnce());
    facade.cancel();
    finish(file);
    await expect(run).rejects.toMatchObject({ name: 'CompressionCancelledError' });
    expect(state.compressedFile).toBeNull();
    expect(state.stage).toBe('analysis');
    expect(state.progress).toBe(0);
  });

  it('does not let an old cancelled operation stop or overwrite a replacement', async () => {
    const finishes: Array<(file: File) => void> = [];
    const engine = {
      cancel: vi.fn(),
      compress: vi.fn(() => new Promise<File>(resolve => finishes.push(resolve))),
    };
    const state = new CompressionState();
    const facade = new CompressionFacade(
      { analyzeFile: vi.fn(async () => analysis) } as never,
      engine as never, { createPlan: () => plan } as never, state,
    );
    const first = makeFile('first.pdf');
    const second = makeFile('second.pdf');
    const oldRun = facade.compress(first);
    await vi.waitFor(() => expect(finishes).toHaveLength(1));
    const newRun = facade.compress(second);
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    const cancels = engine.cancel.mock.calls.length;
    finishes[0](first);
    await expect(oldRun).rejects.toMatchObject({ name: 'CompressionCancelledError' });
    expect(engine.cancel).toHaveBeenCalledTimes(cancels);
    expect(state.compressing).toBe(true);
    finishes[1](second);
    await expect(newRun).resolves.toBe(second);
    expect(state.compressedFile).toBe(second);
  });
});

describe('Target-size runs', () => {
  it('uses decimal bytes, snapshots settings and reports a missed target from the actual file', async () => {
    const state = new CompressionState(); state.targetSizeMB = 1;
    const engine = { cancel: vi.fn(), compress: vi.fn(async (_file, level, executionPlan) => {
      expect(level).toBe('strong'); expect(executionPlan.targetBytes).toBe(1_000_000);
      state.targetSizeMB = 5;
      return makeFile('actual.pdf', 1_000_001);
    }) };
    const facade = new CompressionFacade({ analyzeFile: vi.fn(async () => analysis) } as never,
      engine as never, { createPlan: vi.fn(() => ({ ...plan })) } as never, state);
    await facade.compress(makeFile('input.pdf', 2_000_000));
    expect(state.compressionResult?.targetBytes).toBe(1_000_000);
    expect(state.compressionResult?.targetMet).toBe(false);
    expect(state.finalSize).toBe(1_000_001);
  });
  it('counts an exact-size result as meeting the target', async () => {
    const state = new CompressionState(); state.targetSizeMB = 2;
    const facade = new CompressionFacade({ analyzeFile: vi.fn(async () => analysis) } as never,
      { cancel: vi.fn(), compress: vi.fn(async () => makeFile('actual.pdf', 2_000_000)) } as never,
      { createPlan: vi.fn(() => ({ ...plan })) } as never, state);
    await facade.compress(makeFile('input.pdf', 3_000_000));
    expect(state.compressionResult?.targetMet).toBe(true);
  });
  it('rejects invalid targets before starting processing', async () => {
    const state = new CompressionState(); state.targetSizeMB = -1;
    const analyzeFile = vi.fn();
    const facade = new CompressionFacade({ analyzeFile } as never, {} as never, {} as never, state);
    await expect(facade.compress(makeFile())).rejects.toThrow('target');
    expect(analyzeFile).not.toHaveBeenCalled();
  });
});

describe('large-file routing', () => {
  it('never sends a large PDF to full-buffer analysis or the multi-candidate engine', async () => {
    const analyzer = { analyzeFile: vi.fn() };
    const engine = { cancel: vi.fn(), compress: vi.fn() };
    const input = makeFile(); Object.defineProperty(input, 'size', { value: 500_000_000 });
    const output = makeFile('compressed.pdf', 100);
    const large = { capability: { assertFile: vi.fn() }, cancel: vi.fn(),
      compress: vi.fn(async () => ({ file: output, pages: 252 })) };
    const state = new CompressionState(); state.targetSizeMB = 1;
    const facade = new CompressionFacade(analyzer as never, engine as never, {} as never, state, large as never);
    await facade.analyze(input);
    expect(await facade.compress(input)).toBe(output);
    expect(analyzer.analyzeFile).not.toHaveBeenCalled();
    expect(engine.compress).not.toHaveBeenCalled();
    expect(state.compressionResult?.targetMet).toBe(true);
    expect(state.compressionResult?.strategy).toBe('safe');
    expect(state.compressing).toBe(false);
  });
});

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
    expect(state.compressedFile?.name).toBe('input-safepdfhub_compressed.pdf');
    expect(state.compressing).toBe(false);
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
      { compress: vi.fn() } as never,
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

import { describe, expect, it } from 'vitest';
import { CompressionPlanner } from './compression-planner';
import { PdfAnalysis } from './pdf-analysis.models';

function analysis(overrides: Partial<PdfAnalysis> = {}): PdfAnalysis {
  return {
    type: 'mixed',
    avgTextDensity: 80,
    largePages: false,
    imageHeavy: false,
    imageRatio: 0.5,
    imageCount: 2,
    vectorOperatorCount: 20,
    pagesAnalyzed: 4,
    ...overrides,
  };
}

describe('CompressionPlanner — C6', () => {
  const planner = new CompressionPlanner();

  it.each([
  ['text', 'safe'],
  ['mixed', 'smart'],
  ['scanned', 'strong'],
] as const)('selects the expected strategy for %s PDFs', (type, expected) => {
  const overrides: Partial<PdfAnalysis> =
    type === 'text'
      ? {
          imageCount: 0,
          imageRatio: 0,
          imageHeavy: false,
        }
      : {};

  expect(
    planner.createPlan(analysis({ type, ...overrides }), 4, 'recommended').strategy,
  ).toBe(expected);
});

  it('keeps text-only PDFs native at full quality and scale', () => {
    const plan = planner.createPlan(
      analysis({ type: 'text', imageCount: 0, imageRatio: 0 }),
      4,
      'strong',
    );

    expect(plan.quality).toBe(1);
    expect(plan.scale).toBe(1);
    expect(plan.strategy).toBe('safe');
  });

  it('uses deterministic quality and scale contracts for each compression level', () => {
    const light = planner.createPlan(analysis(), 4, 'light');
    const recommended = planner.createPlan(analysis(), 4, 'recommended');
    const strong = planner.createPlan(analysis(), 4, 'strong');

    expect(light.quality).toBe(0.9);
    expect(recommended.quality).toBe(0.8);
    expect(strong.quality).toBe(0.65);

    expect(light.scale).toBe(1);
    expect(recommended.scale).toBe(0.85);
    expect(strong.scale).toBe(0.65);
  });

  it('caps estimated reduction for very large documents', () => {
    const plan = planner.createPlan(
      analysis({ type: 'scanned', imageRatio: 1, imageCount: 8, imageHeavy: true, largePages: true }),
      1001,
      'strong',
    );

    expect(plan.estimatedReduction).toBeLessThanOrEqual(10);
  });

  it('never exceeds the global 80% estimated reduction ceiling', () => {
    const plan = planner.createPlan(
      analysis({ type: 'scanned', imageRatio: 1, imageCount: 20, imageHeavy: true, largePages: true }),
      100,
      'strong',
    );

    expect(plan.estimatedReduction).toBeLessThanOrEqual(80);
    expect(plan.estimatedReduction).toBeGreaterThanOrEqual(3);
  });

  it('adapts raster scale only for pages that should be rasterized', () => {
    const plan = planner.createPlan(analysis(), 4, 'recommended');

    expect(
      planner.getAdaptiveScale(plan, { width: 3000, height: 4000 }, {
        type: 'mixed',
        textDensity: 40,
        imageCount: 1,
        vectorOperatorCount: 5,
        estimatedImageArea: 100,
        estimatedPhotoPage: true,
        shouldRasterize: true,
      }),
    ).toBe(0.7);

    expect(
      planner.getAdaptiveScale(plan, { width: 3000, height: 4000 }, {
        type: 'text',
        textDensity: 100,
        imageCount: 0,
        vectorOperatorCount: 40,
        estimatedImageArea: 0,
        estimatedPhotoPage: false,
        shouldRasterize: false,
      }),
    ).toBe(1);
  });

  it('keeps worker tick budgets monotonic by compression strength', () => {
    expect(planner.getObjectsPerTick('light')).toBeGreaterThan(
      planner.getObjectsPerTick('recommended'),
    );
    expect(planner.getObjectsPerTick('recommended')).toBeGreaterThan(
      planner.getObjectsPerTick('strong'),
    );
  });
});

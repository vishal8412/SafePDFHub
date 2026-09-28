import { describe, expect, it, vi } from 'vitest';
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
    deps['worker'] as never,
    (deps['capability'] ?? {
      budget: {
        maxPages: 40_000,
        maxFileBytes: 100 * 1024 * 1024,
      },
    }) as never,
    deps['pdfJsLoader'] as never,
  );
}

describe('CompressEngine — C6', () => {
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
});

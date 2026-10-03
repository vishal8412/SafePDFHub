import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PdfAnalyzer } from './pdf-analyzer.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalyzerService } from './pdf-forensic-analyzer.service';

function makeLoader() {
  return {
    load: vi.fn(async () => ({
      getDocument: vi.fn(),
      OPS: {
        transform: 84,
        paintImageXObject: 85,
        paintInlineImageXObject: 86,
      },
    })),
  };
}

function makePdfPage(options: {
  width?: number;
  height?: number;
  textItems?: number;
  imageOps?: number[];
  vectorOps?: number;
}) {
  const imageOps = options.imageOps ?? [];
  const vectorOps = options.vectorOps ?? 0;

  const fnArray: number[] = [];
  const argsArray: unknown[][] = [];
  for (const imageOp of imageOps) {
    fnArray.push(84, imageOp);
    argsArray.push([options.width ?? 595, 0, 0, options.height ?? 842, 0, 0], [imageOp === 85 ? 'img' : 'inline']);
  }
  for (let i = 0; i < vectorOps; i += 1) {
    fnArray.push(99);
    argsArray.push([]);
  }

  return {
    getViewport: () => ({
      width: options.width ?? 595,
      height: options.height ?? 842,
    }),
    getTextContent: vi.fn(async () => ({
      items: Array.from({ length: options.textItems ?? 0 }),
    })),
    getOperatorList: vi.fn(async () => ({
      fnArray,
      argsArray,
    })),
    cleanup: vi.fn(),
  };
}

describe('PdfAnalyzer — C6', () => {
  afterEach(() => TestBed.resetTestingModule());

  function createAnalyzer(loader: ReturnType<typeof makeLoader>, forensic?: Partial<PdfForensicAnalyzerService>): PdfAnalyzer {
    TestBed.configureTestingModule({
      providers: [
        PdfAnalyzer,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: PdfJsLoaderService, useValue: loader },
        { provide: PdfForensicAnalyzerService, useValue: forensic ?? { analyze: vi.fn(async () => undefined) } },
      ],
    });
    return TestBed.inject(PdfAnalyzer);
  }
  it('classifies image-free text/vector pages as non-rasterizable', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);

    const result = await analyzer.analyzePage(makePdfPage({
      textItems: 120,
      vectorOps: 40,
    }));

    expect(result.type).toBe('text');
    expect(result.imageCount).toBe(0);
    expect(result.shouldRasterize).toBe(false);
    expect(result.estimatedImageArea).toBe(0);
  });

  it('classifies image pages and marks them for rasterization', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);

    const result = await analyzer.analyzePage(makePdfPage({
      textItems: 10,
      imageOps: [85],
      vectorOps: 8,
    }));

    expect(result.imageCount).toBe(1);
    expect(result.shouldRasterize).toBe(true);
    expect(result.estimatedPhotoPage).toBe(true);
    expect(result.estimatedImageArea).toBe(595 * 842);
  });

  it('does not rasterize pages that only contain tiny image content', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);

    const page = makePdfPage({
      textItems: 140,
      imageOps: [85],
      vectorOps: 20,
    });
    page.getOperatorList.mockResolvedValueOnce({
      fnArray: [84, 85],
      argsArray: [
        [20, 0, 0, 20, 40, 40],
        ['tiny-image'],
      ],
    });

    const result = await analyzer.analyzePage(page);

    expect(result.imageCount).toBe(1);
    expect(result.estimatedImageArea).toBe(400);
    expect(result.shouldRasterize).toBe(false);
  });

  it('limits whole-document inspection to the first eight pages', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);

    const pages = Array.from({ length: 12 }, (_, index) =>
      makePdfPage({ textItems: index + 1 }),
    );

    const pdf = {
      numPages: pages.length,
      getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
    };

    const result = await analyzer.analyzePdfStructure(pdf);

    expect(result.pagesAnalyzed).toBe(8);
    expect(pdf.getPage).toHaveBeenCalledTimes(8);
    expect(result.avgTextDensity).toBe((1 + 2 + 3 + 4 + 5 + 6 + 7 + 8) / 8);
  });

  it('uses the loaded operator list when analyzing whole-document image structure', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);
    const pages = [
      makePdfPage({ textItems: 20, imageOps: [85], vectorOps: 4 }),
      makePdfPage({ textItems: 20, imageOps: [85], vectorOps: 4 }),
    ];
    const pdf = {
      numPages: pages.length,
      getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
    };

    const result = await analyzer.analyzePdfStructure(pdf);

    expect(result.imageCount).toBe(2);
    expect(result.imageRatio).toBe(1);
    expect(result.vectorOperatorCount).toBe(10);
  });


  it('attaches V2.1 forensic intelligence without changing the legacy analysis contract', async () => {
    const loader = makeLoader();
    const forensic = {
      analyze: vi.fn(async (..._args: Parameters<PdfForensicAnalyzerService['analyze']>) => ({
        version: 1 as const,
        fileSize: 1234,
        pdfHeader: '%PDF-1.7',
        pageCount: 2,
        sampledPageCount: 2,
        objectCount: 20,
        streamObjectCount: 8,
        streamBytes: 4096,
        uniqueStreamCount: 4,
        duplicateStreamGroupCount: 2,
        duplicateStreamBytes: 2048,
        pageContentStreamCount: 2,
        pageContentStreamBytes: 1024,
        uniquePageContentStreamCount: 1,
        duplicatePageContentStreamGroupCount: 1,
        duplicatePageContentBytes: 512,
        imageResourceCount: 3,
        uniqueImageResourceCount: 2,
        imageBytes: 900,
        imageReferenceCount: 3,
        imageOperatorCount: 3,
        imagePages: 2,
        sampledImageAreaRatio: 0.5,
        fontResourceCount: 4,
        formXObjectCount: 1,
        patternResourceCount: 0,
        shadingResourceCount: 0,
        duplicateStreams: [],
        duplicatePageContentStreams: [],
        imageResources: [],
        sampledPages: [],
        metadata: { title: null, author: null, subject: null, creator: null, producer: null },
        partial: false,
      })),
    };
    const analyzer = createAnalyzer(loader, forensic);
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'fixture.pdf', { type: 'application/pdf' });
    const pdf = {
      numPages: 2,
      getPage: vi.fn(async () => makePdfPage({ textItems: 10 })),
      destroy: vi.fn(async () => undefined),
    };
    loader.load.mockResolvedValueOnce({
      OPS: {
        transform: 84,
        paintImageXObject: 85,
        paintInlineImageXObject: 86,
      },
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    });

    const result = await analyzer.analyzeFile(file);

    expect(forensic.analyze).toHaveBeenCalledOnce();
    expect(forensic.analyze.mock.calls[0][3]).toHaveLength(2);
    expect(result.forensic?.duplicatePageContentBytes).toBe(512);
    expect(result.analysis.type).toBe('text');
    expect(result.pages).toBe(2);
  });

  it('keeps forensic bytes readable after PDF.js transfers its input to a worker', async () => {
    const loader = makeLoader();
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'fixture.pdf');
    const forensic = {
      analyze: vi.fn(async (_file: File, _pdf: unknown, bytes?: Uint8Array) => {
        const ownedBytes = bytes ?? new Uint8Array(await _file.arrayBuffer());
        if (ownedBytes.byteLength !== 4) throw new Error('Detached source bytes');
        return { partial: false } as never;
      }),
    };
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => makePdfPage({ textItems: 10 })),
      destroy: vi.fn(async () => undefined),
    };
    loader.load.mockResolvedValueOnce({
      OPS: { transform: 84, paintImageXObject: 85, paintInlineImageXObject: 86 },
      getDocument: vi.fn(({ data }: { data: Uint8Array }) => {
        structuredClone(data, { transfer: [data.buffer] });
        return { promise: Promise.resolve(pdf) };
      }),
    });
    const result = await createAnalyzer(loader, forensic).analyzeFile(file);
    expect(result.forensic).toBeDefined();
    expect(result.forensic?.partial).toBe(false);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it('continues analysis when an individual page inspection fails', async () => {
    const loader = makeLoader();
    const analyzer = createAnalyzer(loader);

    const goodPage = makePdfPage({ textItems: 20 });
    const badPage = makePdfPage({ textItems: 50 });
    badPage.getTextContent.mockRejectedValueOnce(new Error('synthetic page failure'));

    const pdf = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => pageNumber === 1 ? goodPage : badPage),
    };

    const result = await analyzer.analyzePdfStructure(pdf);

    expect(result.pagesAnalyzed).toBe(2);
    expect(result.avgTextDensity).toBe(10);
    expect(goodPage.cleanup).toHaveBeenCalled();
    expect(badPage.cleanup).toHaveBeenCalled();
  });
});

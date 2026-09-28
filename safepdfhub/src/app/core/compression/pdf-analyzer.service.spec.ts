import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PdfAnalyzer } from './pdf-analyzer.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';

function makeLoader() {
  return {
    load: vi.fn(async () => ({
      OPS: {
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

  return {
    getViewport: () => ({
      width: options.width ?? 595,
      height: options.height ?? 842,
    }),
    getTextContent: vi.fn(async () => ({
      items: Array.from({ length: options.textItems ?? 0 }),
    })),
    getOperatorList: vi.fn(async () => ({
      fnArray: [
        ...imageOps,
        ...Array.from({ length: vectorOps }, () => 99),
      ],
    })),
    cleanup: vi.fn(),
  };
}

describe('PdfAnalyzer — C6', () => {
  afterEach(() => TestBed.resetTestingModule());

  function createAnalyzer(loader: ReturnType<typeof makeLoader>): PdfAnalyzer {
    TestBed.configureTestingModule({
      providers: [
        PdfAnalyzer,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: PdfJsLoaderService, useValue: loader },
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

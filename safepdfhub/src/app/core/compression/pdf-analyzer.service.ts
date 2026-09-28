import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PdfAnalysis, PdfFileAnalysis, PageAnalysis, PdfContentType } from './pdf-analysis.models';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';

@Injectable({ providedIn: 'root' })
export class PdfAnalyzer {
  private readonly platformId = inject(PLATFORM_ID);

  constructor(private readonly pdfJsLoader: PdfJsLoaderService) {}

  async analyzeFile(file: File): Promise<PdfFileAnalysis> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('PDF compression analysis is available only in the browser.');
    }

    const pdfjs = await this.pdfJsLoader.load();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    try {
      const analysis = await this.analyzePdfStructure(pdf);
      return {
        type: analysis.type,
        analysis,
        pages: pdf.numPages,
      };
    } finally {
      await pdf.destroy();
    }
  }

  async analyzePdfStructure(pdf: any): Promise<PdfAnalysis> {
    const pdfjs = await this.pdfJsLoader.load();
    const pagesToCheck = Math.min(pdf.numPages, 8);
    let textItems = 0;
    let imagePages = 0;
    let imageCount = 0;
    let vectorOperatorCount = 0;
    let largePages = false;

    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);
      try {
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        if (viewport.width > 1000 || viewport.height > 1400) {
          largePages = true;
        }

        const [text, operatorList] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList(),
        ]);

        const pageTextItems = text.items?.length ?? 0;
        const pageImageCount = this.countImageOperators(operatorList, pdfjs.OPS);
        const pageVectorOperators = Math.max(0, (operatorList.fnArray?.length ?? 0) - pageImageCount);

        textItems += pageTextItems;
        imageCount += pageImageCount;
        vectorOperatorCount += pageVectorOperators;

        if (pageImageCount > 0) {
          imagePages++;
        }
      } catch {
        // A page that cannot be fully inspected should not make the entire
        // analysis fail. The engine will still validate the final PDF.
      } finally {
        try { page.cleanup(); } catch { /* best effort */ }
      }
    }

    const avgTextDensity = pagesToCheck > 0 ? textItems / pagesToCheck : 0;
    const imageRatio = pagesToCheck > 0 ? imagePages / pagesToCheck : 0;
    const imageHeavy = imageRatio >= 0.4 || (imageCount >= pagesToCheck * 2 && avgTextDensity < 80);
    const type = this.classifyDocument({
      avgTextDensity,
      imageRatio,
      imageCount,
      vectorOperatorCount,
    });

    return {
      type,
      avgTextDensity,
      largePages,
      imageHeavy,
      imageRatio,
      imageCount,
      vectorOperatorCount,
      pagesAnalyzed: pagesToCheck,
    };
  }

  async analyzePage(page: any): Promise<PageAnalysis> {
    const pdfjs = await this.pdfJsLoader.load();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const pageArea = Math.max(1, viewport.width * viewport.height);

    let textItems = 0;
    let imageCount = 0;
    let vectorOperatorCount = 0;

    try {
      const [text, operatorList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);
      textItems = text.items?.length ?? 0;
      imageCount = this.countImageOperators(operatorList, pdfjs.OPS);
      vectorOperatorCount = Math.max(0, (operatorList.fnArray?.length ?? 0) - imageCount);
    } catch {
      // Keep conservative defaults. The caller can still fall back to a safe
      // vector-preserving copy if analysis is inconclusive.
    }

    const hasImages = imageCount > 0;
    const estimatedImageArea = hasImages
      ? pageArea * (textItems < 30 ? 0.95 : textItems < 120 ? 0.60 : 0.35)
      : 0;

    const type = this.classifyDocument({
      avgTextDensity: textItems,
      imageRatio: hasImages ? 1 : 0,
      imageCount,
      vectorOperatorCount,
    });

    // Rasterize only when the page actually contains image content. A PDF
    // with little text but only vector drawing commands should remain vector.
    const shouldRasterize = hasImages;

    return {
      type,
      textDensity: textItems,
      imageCount,
      vectorOperatorCount,
      estimatedImageArea,
      estimatedPhotoPage: estimatedImageArea > pageArea * 0.5,
      shouldRasterize,
    };
  }

  private classifyDocument(input: {
    avgTextDensity: number;
    imageRatio: number;
    imageCount: number;
    vectorOperatorCount: number;
  }): PdfContentType {
    const { avgTextDensity, imageRatio, imageCount, vectorOperatorCount } = input;

    if (imageCount === 0) {
      // No image XObjects/inline images means there is no safe reason to
      // rasterize the document. Text and vector-only documents stay native.
      return vectorOperatorCount > 0 || avgTextDensity > 0 ? 'text' : 'mixed';
    }

    if (imageRatio >= 0.6 && avgTextDensity < 45) {
      return 'scanned';
    }

    if (imageRatio >= 0.4 || imageCount >= 2) {
      return avgTextDensity >= 45 ? 'mixed' : 'scanned';
    }

    return avgTextDensity >= 80 ? 'mixed' : 'scanned';
  }

  private countImageOperators(operatorList: any, ops: any): number {
    const fnArray: number[] = operatorList?.fnArray ?? [];
    const imageOps = new Set<number>([
      ops.paintImageMaskXObject,
      ops.paintImageMaskXObjectRepeat,
      ops.paintImageXObject,
      ops.paintImageXObjectRepeat,
      ops.paintInlineImageXObject,
      ops.paintInlineImageXObjectGroup,
      ops.paintSolidColorImageMask,
    ].filter((value): value is number => typeof value === 'number'));
    return fnArray.reduce((count, fn) => count + (imageOps.has(fn) ? 1 : 0), 0);
  }

}

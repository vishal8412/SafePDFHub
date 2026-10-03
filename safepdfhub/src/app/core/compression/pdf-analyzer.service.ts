import { LARGE_COMPRESSION_THRESHOLD } from './large/large-compression-policy';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PdfAnalysis, PdfFileAnalysis, PageAnalysis, PdfContentType } from './pdf-analysis.models';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalyzerService } from './pdf-forensic-analyzer.service';
import { PdfForensicPageObservation } from './pdf-forensic.models';
import { throwIfCompressionCancelled } from './compression-cancellation';

@Injectable({ providedIn: 'root' })
export class PdfAnalyzer {
  private readonly platformId = inject(PLATFORM_ID);

  constructor(
    private readonly pdfJsLoader: PdfJsLoaderService,
    private readonly forensicAnalyzer: PdfForensicAnalyzerService,
  ) {}

  async analyzeFile(file: File, signal?: AbortSignal): Promise<PdfFileAnalysis> {
    if (file.size > LARGE_COMPRESSION_THRESHOLD) throw new Error('Large PDFs must use disk-backed analysis.');
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('PDF compression analysis is available only in the browser.');
    }

    throwIfCompressionCancelled(signal);
    const pdfjs = await this.pdfJsLoader.load();
    throwIfCompressionCancelled(signal);
    const data = new Uint8Array(await file.arrayBuffer());
    throwIfCompressionCancelled(signal);
    const loadingTask = pdfjs.getDocument({ data });
    const onAbort = () => {
      try { void loadingTask.destroy?.().catch(() => undefined); } catch { /* best effort */ }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      throwIfCompressionCancelled(signal);
      const pdf = await loadingTask.promise;

      try {
        const forensicPages: PdfForensicPageObservation[] = [];
        const analysis = await this.analyzePdfStructure(pdf, forensicPages, signal);
        let forensic;
        try {
          // PDF.js owns/transfers data to its worker. Read a fresh buffer lazily
          // for pdf-lib; reusing data here silently loses all forensic evidence.
          forensic = await this.forensicAnalyzer.analyze(file, pdf, undefined, forensicPages, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          // Forensic intelligence is additive. A malformed/unsupported low-level
          // object graph must not make the existing safe analysis unavailable.
          forensic = undefined;
        }

        throwIfCompressionCancelled(signal);
        return {
          type: analysis.type,
          analysis,
          pages: pdf.numPages,
          forensic,
        };
      } finally {
        try { await pdf.destroy(); } catch { /* already destroyed on abort */ }
      }
    } catch (error) {
      throwIfCompressionCancelled(signal);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async analyzePdfStructure(pdf: any, forensicPages: PdfForensicPageObservation[] = [], signal?: AbortSignal): Promise<PdfAnalysis> {
    const pdfjs = await this.pdfJsLoader.load();
    const pagesToCheck = Math.min(pdf.numPages, 8);
    let textItems = 0;
    let imagePages = 0;
    let imageCount = 0;
    let vectorOperatorCount = 0;
    let largePages = false;

    for (let i = 1; i <= pagesToCheck; i++) {
      throwIfCompressionCancelled(signal);
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
        const pageArea = Math.max(1, viewport.width * viewport.height);
        const imageArea = pageImageCount > 0
          ? Math.min(pageArea, this.estimateDisplayedImageArea(operatorList, pdfjs.OPS))
          : 0;

        forensicPages.push({
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
          rotation: Number(page.rotate ?? 0),
          imageOperatorCount: pageImageCount,
          imageAreaRatio: imageArea / pageArea,
          textItemCount: pageTextItems,
          vectorOperatorCount: pageVectorOperators,
        });

        textItems += pageTextItems;
        imageCount += pageImageCount;
        vectorOperatorCount += pageVectorOperators;

        if (pageImageCount > 0) {
          imagePages++;
        }
      } catch (error) {
        throwIfCompressionCancelled(signal);
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
    let operatorList: any = null;

    try {
      const [text, loadedOperatorList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);
      operatorList = loadedOperatorList;
      textItems = text.items?.length ?? 0;
      imageCount = this.countImageOperators(operatorList, pdfjs.OPS);
      vectorOperatorCount = Math.max(0, (operatorList.fnArray?.length ?? 0) - imageCount);
    } catch {
      // Keep conservative defaults. The caller can still fall back to a safe
      // vector-preserving copy if analysis is inconclusive.
    }

    const hasImages = imageCount > 0;
    const imageArea = hasImages
      ? this.estimateDisplayedImageArea(operatorList, pdfjs.OPS)
      : 0;
    const estimatedImageArea = Math.min(pageArea, imageArea);
    const imageAreaRatio = pageArea > 0 ? estimatedImageArea / pageArea : 0;

    const type = this.classifyDocument({
      avgTextDensity: textItems,
      imageRatio: hasImages ? 1 : 0,
      imageCount,
      vectorOperatorCount,
    });

    // Do not rasterize a page merely because it contains a tiny logo, chart
    // label, icon, or other small image XObject. Rasterization is useful when
    // image content occupies a meaningful part of the visible page, or when
    // the page is clearly scanned. This keeps text/vector pages native.
    const shouldRasterize = hasImages && (
      type === 'scanned' ||
      imageAreaRatio >= 0.55
    );

    return {
      type,
      textDensity: textItems,
      imageCount,
      vectorOperatorCount,
      estimatedImageArea,
      estimatedPhotoPage: imageAreaRatio >= 0.5,
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

  private estimateDisplayedImageArea(operatorList: any, ops: any): number {
    const fnArray: number[] = operatorList?.fnArray ?? [];
    const argsArray: unknown[][] = operatorList?.argsArray ?? [];
    const imageOps = new Set<number>([
      ops.paintImageMaskXObject,
      ops.paintImageMaskXObjectRepeat,
      ops.paintImageXObject,
      ops.paintImageXObjectRepeat,
      ops.paintInlineImageXObject,
      ops.paintInlineImageXObjectGroup,
      ops.paintSolidColorImageMask,
    ].filter((value): value is number => typeof value === 'number'));

    let transform: number[] | null = null;
    let area = 0;

    for (let index = 0; index < fnArray.length; index += 1) {
      const fn = fnArray[index];
      const args = argsArray[index];

      if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
        transform = args.slice(0, 6).map(Number);
        continue;
      }

      if (!imageOps.has(fn) || !transform) continue;

      const [a, b, c, d] = transform;
      const width = Math.hypot(a, b);
      const height = Math.hypot(c, d);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        area += Math.abs(width * height);
      }
    }

    return Number.isFinite(area) ? area : 0;
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

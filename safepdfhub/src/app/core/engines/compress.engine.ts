import { Injectable } from '@angular/core';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { PdfAnalysis, PdfFileAnalysis, PageAnalysis } from '../compression/pdf-analysis.models';
import { CompressionPlan } from '../compression/compression-plan';
import { PdfAnalyzer } from '../compression/pdf-analyzer.service';
import { CompressionPlanner } from '../compression/compression-planner';
import { PdfPageRendererService } from '../compression/pdf-page-renderer.service';
import { PdfPageEmbedderService, PdfPageGeometry } from '../compression/pdf-page-embedder.service';
import { PdfCompressionWorkerService } from '../compression/pdf-compression-worker.service';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';

export interface CompressionResult {
  file: File;
  analysis: PdfAnalysis;
  alreadyCompressed: boolean;
}

@Injectable({ providedIn: 'root' })
export class CompressEngine {
  constructor(
    private readonly pdfAnalyzer: PdfAnalyzer,
    private readonly compressionPlanner: CompressionPlanner,
    private readonly pageRenderer: PdfPageRendererService,
    private readonly pageEmbedder: PdfPageEmbedderService,
    private readonly compressionWorker: PdfCompressionWorkerService,
    private readonly capability: LocalProcessingCapabilityService,
    private readonly pdfJsLoader: PdfJsLoaderService,
  ) {}

  async compress(
    file: File,
    level: 'light' | 'recommended' | 'strong',
    plan: CompressionPlan,
    cachedAnalysis: PdfFileAnalysis,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const alreadyCompressed = this.detectAlreadyCompressed(file.size, cachedAnalysis.pages);
    if (alreadyCompressed) {
      return this.safeCompress(file, level, onProgress);
    }

    const budget = this.capability.budget;
    if (cachedAnalysis.pages > budget.maxPages || file.size > budget.maxFileBytes) {
      return this.safeCompress(file, level, onProgress);
    }

    switch (plan.strategy) {
      case 'safe':
        return this.safeCompress(file, level, onProgress);
      case 'smart':
        return this.smartCompress(file, plan, cachedAnalysis.pages, onProgress);
      case 'strong':
        return this.strongCompress(file, plan, cachedAnalysis.pages, onProgress);
      default:
        return this.safeCompress(file, level, onProgress);
    }
  }

  async safeCompress(
    file: File,
    level: 'light' | 'recommended' | 'strong',
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const existingPdfBytes = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(existingPdfBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    try {
      onProgress?.(20);
      // Keep document metadata intact. Safe compression should optimize the
      // PDF structure without silently changing document identity metadata.
      onProgress?.(40);

      const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: this.compressionPlanner.getObjectsPerTick(level),
        updateFieldAppearances: false,
      });

      if (compressedBytes.length >= file.size) return file;

      onProgress?.(100);
      return this.toPdfFile(file, compressedBytes);
    } finally {
      pdfDoc.flush?.();
    }
  }

  private async strongCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    return this.rasterCompress(file, plan, totalPages, true, onProgress);
  }

  private async smartCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    return this.rasterCompress(file, plan, totalPages, false, onProgress);
  }

  private async rasterCompress(
    file: File,
    plan: CompressionPlan,
    totalPages: number,
    strong: boolean,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const { sourcePdf, pdf } = await this.loadSourcePdf(file);
    const newPdf = await PDFDocument.create();
    this.copyDocumentMetadata(sourcePdf, newPdf);

    try {
      let quality = plan.quality;
      let maxWidth = plan.maxWidth;
      let maxHeight = plan.maxHeight;

      if (strong && totalPages > 1000) {
        quality *= 0.9;
        maxWidth *= 0.8;
        maxHeight *= 0.8;
      }

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const sourcePage = sourcePdf.getPage(i - 1);

        try {
          const analysis = await this.pdfAnalyzer.analyzePage(page);

          if (!analysis.shouldRasterize) {
            await this.copyOriginalPage(sourcePdf, newPdf, i - 1);
          } else {
            await this.compressPage(page, sourcePage, newPdf, plan, analysis, quality, maxWidth, maxHeight);
          }

          onProgress?.(Math.round((i / totalPages) * 100));
        } finally {
          try { page.cleanup(); } catch { /* best effort */ }
        }
      }

      return await this.finalizeAndValidate(file, newPdf, sourcePdf, totalPages);
    } finally {
      try { await pdf.destroy(); } catch { /* best effort */ }
      try { newPdf.flush?.(); } catch { /* best effort */ }
    }
  }

  private async compressPage(
    page: any,
    sourcePage: PDFPage,
    newPdf: PDFDocument,
    plan: CompressionPlan,
    analysis: PageAnalysis,
    quality: number,
    maxWidth: number,
    maxHeight: number,
  ): Promise<void> {
    const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
    const scale = this.compressionPlanner.getAdaptiveScale(plan, baseViewport, analysis);
    const renderWidth = Math.max(1, Math.floor(baseViewport.width * scale));
    const renderHeight = Math.max(1, Math.floor(baseViewport.height * scale));
    const ratio = Math.min(maxWidth / renderWidth, maxHeight / renderHeight, 1);
    const finalWidth = Math.max(1, Math.floor(renderWidth * ratio));
    const finalHeight = Math.max(1, Math.floor(renderHeight * ratio));
    const adaptiveQuality = this.compressionPlanner.getAdaptiveQuality(plan, analysis);

    const bitmap = await this.pageRenderer.renderToImageBitmap(page, finalWidth, finalHeight);
    try {
      let bytes = await this.compressionWorker.encodeJpeg(
        bitmap,
        finalWidth,
        finalHeight,
        Math.min(quality, adaptiveQuality),
      );

      if (!bytes) {
        // encodeJpeg transfers/consumes the bitmap when a worker is available.
        // If the worker is unavailable, render a fresh JPEG on the main thread.
        bytes = await this.pageRenderer.renderToJpeg(page, finalWidth, finalHeight, Math.min(quality, adaptiveQuality));
      }

      const geometry = this.getPageGeometry(sourcePage);
      await this.pageEmbedder.addJpegPage(newPdf, bytes, geometry);
    } finally {
      try { bitmap.close(); } catch { /* best effort */ }
    }
  }

  private async copyOriginalPage(sourcePdf: PDFDocument, targetPdf: PDFDocument, pageIndex: number): Promise<void> {
    const copiedPages = await targetPdf.copyPages(sourcePdf, [pageIndex]);
    targetPdf.addPage(copiedPages[0]);
  }

  private getPageGeometry(sourcePage: PDFPage): PdfPageGeometry {
    const page = sourcePage as PDFPage & {
      getMediaBox?: () => { x: number; y: number; width: number; height: number };
      getCropBox?: () => { x: number; y: number; width: number; height: number };
    };

    const mediaBox = page.getMediaBox?.();
    const cropBox = page.getCropBox?.();
    return {
      width: sourcePage.getWidth(),
      height: sourcePage.getHeight(),
      rotation: sourcePage.getRotation().angle,
      mediaBox,
      cropBox,
    };
  }

  private async loadSourcePdf(file: File) {
    const pdfjs = await this.pdfJsLoader.load();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    return { pdf, sourcePdf };
  }

  private copyDocumentMetadata(source: PDFDocument, target: PDFDocument): void {
    const metadata = [
      ['Title', source.getTitle(), (value: string) => target.setTitle(value)],
      ['Author', source.getAuthor(), (value: string) => target.setAuthor(value)],
      ['Subject', source.getSubject(), (value: string) => target.setSubject(value)],
      ['Keywords', source.getKeywords(), (value: string) => target.setKeywords(value.split(',').map((item) => item.trim()).filter(Boolean))],
      ['Creator', source.getCreator(), (value: string) => target.setCreator(value)],
      ['Producer', source.getProducer(), (value: string) => target.setProducer(value)],
    ] as const;

    for (const [, value, setter] of metadata) {
      if (typeof value === 'string' && value.trim()) setter(value);
    }

    const creationDate = source.getCreationDate();
    const modificationDate = source.getModificationDate();
    if (creationDate) target.setCreationDate(creationDate);
    if (modificationDate) target.setModificationDate(modificationDate);
  }

  private async finalizeAndValidate(file: File, newPdf: PDFDocument, sourcePdf: PDFDocument, expectedPages: number): Promise<File> {
    const bytes = await newPdf.save({ useObjectStreams: true });
    const result = this.toPdfFile(file, bytes);

    if (result.size >= file.size) return file;
    await this.validateOutput(result, sourcePdf, expectedPages);
    return result;
  }

  private async validateOutput(file: File, sourcePdf: PDFDocument, expectedPages: number): Promise<void> {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    try {
      if (pdf.getPageCount() !== expectedPages) {
        throw new Error(`Compression output page count mismatch: expected ${expectedPages}, received ${pdf.getPageCount()}.`);
      }
      const outputPages = pdf.getPages();
      const sourcePages = sourcePdf.getPages();
      for (let i = 0; i < outputPages.length; i++) {
        const page = outputPages[i];
        const sourcePage = sourcePages[i];
        if (!(page.getWidth() > 0) || !(page.getHeight() > 0)) {
          throw new Error('Compression output contains an invalid page size.');
        }
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const sourceRotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
        if (![0, 90, 180, 270].includes(rotation)) {
          throw new Error('Compression output contains an invalid page rotation.');
        }
        if (Math.abs(page.getWidth() - sourcePage.getWidth()) > 0.01 ||
            Math.abs(page.getHeight() - sourcePage.getHeight()) > 0.01 ||
            rotation !== sourceRotation) {
          throw new Error(`Compression output changed page geometry on page ${i + 1}.`);
        }
      }
    } finally {
      pdf.flush?.();
    }
  }

  private detectAlreadyCompressed(fileSize: number, pages: number): boolean {
    if (!pages) return false;
    return fileSize / pages < 15000;
  }

  private toPdfFile(source: File, bytes: Uint8Array): File {
    const cleanName = source.name.replace(/\.pdf$/i, '');
    return new File([new Uint8Array(bytes)], `${cleanName}-safepdfhub_compressed.pdf`, { type: 'application/pdf' });
  }
}

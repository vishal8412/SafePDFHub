import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

export interface WatermarkPreviewPage {
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly rotation: 0 | 90 | 180 | 270;
  /** Page dimensions in PDF display points (viewport at scale 1). */
  readonly width: number;
  readonly height: number;
  /** Raster dimensions used for the preview image. */
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly renderScale: number;
  readonly imageUrl: string;
}

@Injectable({ providedIn: 'root' })
export class PdfWatermarkPreviewService {
  private readonly platformId = inject(PLATFORM_ID);
  private pdfjs: typeof import('pdfjs-dist') | null = null;
  private readonly workerPath = '/assets/pdfjs/pdf.worker.min.mjs';
  private pdf: PDFDocumentProxy | null = null;
  private activeTask: ReturnType<PDFPageProxy['render']> | null = null;
  private activePage: PDFPageProxy | null = null;
  private generation = 0;

  async open(file: File): Promise<number> {
    if (!isPlatformBrowser(this.platformId)) throw new Error('PDF preview is available only in the browser.');
    await this.destroy();
    const pdfjs = await this.getPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    this.pdf = pdf;
    return pdf.numPages;
  }

  async renderPage(pageNumber: number, scale = 1.15): Promise<WatermarkPreviewPage> {
    if (!this.pdf) throw new Error('No PDF preview session is open.');
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.pdf.numPages) {
      throw new Error(`Page ${pageNumber} is outside the document.`);
    }

    const generation = ++this.generation;
    this.cancelActiveRender();
    const pdf = this.pdf;
    const page = await pdf.getPage(pageNumber);
    this.activePage = page;
    const viewport = page.getViewport({ scale });
    const baseViewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the PDF preview canvas.');

    try {
      if (generation !== this.generation || this.pdf !== pdf) throw new Error('The PDF preview request was superseded.');
      const task = page.render({ canvasContext: context, viewport });
      this.activeTask = task;
      try {
        await task.promise;
      } finally {
        if (this.activeTask === task) this.activeTask = null;
      }
      if (generation !== this.generation || this.pdf !== pdf) throw new Error('The PDF preview request was superseded.');
      const imageUrl = canvas.toDataURL('image/webp', 0.86);
      return {
        pageNumber,
        pageCount: pdf.numPages,
        rotation: (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270,
        width: baseViewport.width,
        height: baseViewport.height,
        renderedWidth: viewport.width,
        renderedHeight: viewport.height,
        renderScale: scale,
        imageUrl,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (this.activePage === page) this.activePage = null;
      try { page.cleanup(); } catch { /* best effort */ }
    }
  }

  async destroy(): Promise<void> {
    ++this.generation;
    this.cancelActiveRender();
    const pdf = this.pdf;
    this.pdf = null;
    if (pdf) {
      try { await pdf.destroy(); } catch { /* best effort */ }
    }
  }

  private cancelActiveRender(): void {
    if (this.activeTask) {
      try { this.activeTask.cancel(); } catch { /* best effort */ }
      this.activeTask = null;
    }
    if (this.activePage) {
      try { this.activePage.cleanup(); } catch { /* best effort */ }
      this.activePage = null;
    }
  }

  private async getPdfJs(): Promise<typeof import('pdfjs-dist')> {
    if (this.pdfjs) return this.pdfjs;
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(this.workerPath, document.baseURI).toString();
    this.pdfjs = pdfjs;
    return pdfjs;
  }
}

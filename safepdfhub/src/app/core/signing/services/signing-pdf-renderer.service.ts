import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { SigningPageInfo } from '../models/signing.models';
import {
  MAX_SIGNING_PDF_BYTES,
  MAX_SIGNING_PDF_PAGES,
  MAX_SIGNING_PREVIEW_PIXELS,
} from '../models/signing.models';

export interface RenderedSigningPage extends SigningPageInfo {
  readonly imageUrl: string;
}

export interface SigningPdfSession {
  readonly pageCount: number;
  renderPage(pageNumber: number, scale?: number): Promise<RenderedSigningPage>;
  destroy(): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class SigningPdfRendererService {
  private readonly platformId = inject(PLATFORM_ID);
  private pdfjs: typeof import('pdfjs-dist') | null = null;
  private readonly workerPath = '/assets/pdfjs/pdf.worker.min.mjs';

  async open(file: File): Promise<SigningPdfSession> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('PDF rendering is available only in the browser.');
    }
    if (file.size > MAX_SIGNING_PDF_BYTES) {
      throw new Error(`This PDF is too large for browser signing. Please use a PDF ${Math.floor(MAX_SIGNING_PDF_BYTES / (1024 * 1024))} MB or smaller.`);
    }

    const pdfjs = await this.getPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    let pdf: PDFDocumentProxy | null = null;

    try {
      pdf = await pdfjs.getDocument({ data }).promise;
      if (pdf.numPages > MAX_SIGNING_PDF_PAGES) {
        const pageCount = pdf.numPages;
        await pdf.destroy();
        pdf = null;
        throw new Error(`This PDF contains ${pageCount} pages. Browser signing supports up to ${MAX_SIGNING_PDF_PAGES} pages.`);
      }

      let activeRenderTask: ReturnType<PDFPageProxy['render']> | null = null;
      let activePage: PDFPageProxy | null = null;
      let renderGeneration = 0;
      let destroyed = false;

      const cancelActiveRender = (): void => {
        if (activeRenderTask) {
          try { activeRenderTask.cancel(); } catch { /* best effort */ }
          activeRenderTask = null;
        }
        if (activePage) {
          try { activePage.cleanup(); } catch { /* best effort */ }
          activePage = null;
        }
      };

      const session: SigningPdfSession = {
        pageCount: pdf.numPages,
        renderPage: async (pageNumber: number, scale = 1.35) => {
          if (destroyed) throw new Error('The PDF session has been closed.');
          if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf!.numPages) {
            throw new Error(`Page ${pageNumber} is outside the document.`);
          }
          if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
            throw new Error('Invalid PDF preview scale.');
          }

          const requestGeneration = ++renderGeneration;
          cancelActiveRender();
          const pdfDocument = pdf;
          if (!pdfDocument) throw new Error('The PDF session has been closed.');

          const page = await pdfDocument.getPage(pageNumber);
          if (destroyed || requestGeneration !== renderGeneration) {
            try { page.cleanup(); } catch { /* best effort */ }
            throw new Error('The PDF render request was superseded.');
          }
          activePage = page;

          try {
            const rotation = (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;
            const baseViewport = page.getViewport({ scale: 1 });
            const requestedPixels = baseViewport.width * baseViewport.height * scale * scale;
            const safeScale = requestedPixels > MAX_SIGNING_PREVIEW_PIXELS
              ? scale * Math.sqrt(MAX_SIGNING_PREVIEW_PIXELS / requestedPixels)
              : scale;
            const viewport = page.getViewport({ scale: safeScale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));

            const context = canvas.getContext('2d');
            if (!context) {
              throw new Error('Could not create the PDF preview canvas.');
            }

            if (destroyed || requestGeneration !== renderGeneration) {
              throw new Error('The PDF render request was superseded.');
            }

            const renderTask = page.render({
              canvasContext: context,
              viewport,
            });
            activeRenderTask = renderTask;
            try {
              await renderTask.promise;
            } finally {
              if (activeRenderTask === renderTask) activeRenderTask = null;
            }

            if (destroyed) throw new Error('The PDF session has been closed.');
            if (requestGeneration !== renderGeneration) {
              throw new Error('The PDF render request was superseded.');
            }

            const imageUrl = canvas.toDataURL('image/webp', 0.90);
            canvas.width = 0;
            canvas.height = 0;

            return {
              pageNumber,
              rotation,
              width: viewport.width,
              height: viewport.height,
              imageUrl,
            } satisfies RenderedSigningPage;
          } finally {
            if (activePage === page) activePage = null;
            try { page.cleanup(); } catch { /* best effort */ }
          }
        },
        destroy: async () => {
          if (destroyed) return;
          destroyed = true;
          ++renderGeneration;
          cancelActiveRender();
          const pdfDocument = pdf;
          pdf = null;
          if (pdfDocument) await pdfDocument.destroy();
        },
      };

      return session;
    } catch (error) {
      if (pdf) {
        try { await pdf.destroy(); } catch { /* best effort */ }
      }
      throw error;
    }
  }

  private async getPdfJs(): Promise<typeof import('pdfjs-dist')> {
    if (this.pdfjs) return this.pdfjs;

    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      this.workerPath,
      document.baseURI,
    ).toString();
    this.pdfjs = pdfjs;
    return pdfjs;
  }
}

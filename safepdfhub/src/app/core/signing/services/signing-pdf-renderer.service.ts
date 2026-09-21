import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { SigningPageInfo } from '../models/signing.models';

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

    const pdfjs = await this.getPdfJs();
    const pdf: PDFDocumentProxy = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer())
    }).promise;

    return {
      pageCount: pdf.numPages,
      renderPage: async (pageNumber: number, scale = 1.35) => {
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
          throw new Error(`Page ${pageNumber} is outside the document.`);
        }

        const page = await pdf.getPage(pageNumber);
        try {
          const rotation = (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Could not create the PDF preview canvas.');
          }

          await page.render({
            canvasContext: context,
            viewport
          }).promise;

          const imageUrl = canvas.toDataURL('image/webp', 0.90);
          canvas.width = 0;
          canvas.height = 0;

          return {
            pageNumber,
            rotation,
            width: viewport.width,
            height: viewport.height,
            imageUrl
          } satisfies RenderedSigningPage;
        } finally {
          page.cleanup();
        }
      },
      destroy: async () => {
        await pdf.destroy();
      }
    } satisfies SigningPdfSession;
  }

  private async getPdfJs(): Promise<typeof import('pdfjs-dist')> {
    if (this.pdfjs) return this.pdfjs;

    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      this.workerPath,
      document.baseURI
    ).toString();
    this.pdfjs = pdfjs;
    return pdfjs;
  }
}

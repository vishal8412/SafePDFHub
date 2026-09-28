import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type SafePdfJs = typeof import('pdfjs-dist');

@Injectable({ providedIn: 'root' })
export class PdfJsLoaderService {
  private readonly platformId = inject(PLATFORM_ID);
  private pdfjs: SafePdfJs | null = null;
  private loading: Promise<SafePdfJs> | null = null;
  private readonly workerPath = '/assets/pdfjs/pdf.worker.min.mjs';

  async load(): Promise<SafePdfJs> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('PDF.js is available only in the browser.');
    }
    if (this.pdfjs) return this.pdfjs;
    if (this.loading) return this.loading;

    this.loading = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(this.workerPath, document.baseURI).toString();
      this.pdfjs = pdfjs;
      return pdfjs;
    });

    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }
}

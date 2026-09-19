import {
  Injectable,
  PLATFORM_ID,
  inject
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

import type {
  PDFDocumentProxy,
  PDFPageProxy
} from 'pdfjs-dist/types/src/display/api';

import type {
  StudioPdfDocument
} from '../models/pdf-document.model';
import { PdfSecurityService } from '../../../core/security/pdf-security.service';

@Injectable({
  providedIn: 'root'
})
export class PdfEngineService {
  private readonly platformId = inject(PLATFORM_ID);

  private pdfjs: typeof import('pdfjs-dist') | null = null;

  private readonly workerPath =
    '/assets/pdfjs/pdf.worker.min.mjs';

  private readonly pdfSecurity = inject(PdfSecurityService);

  /**
   * Load the PDF.js library lazily.
   *
   * This is intentionally browser-only because SafePDFHub
   * uses Angular SSR for public pages.
   */
  private async getPdfJs(): Promise<typeof import('pdfjs-dist')> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error(
        'PDF processing is available only in the browser.'
      );
    }

    if (this.pdfjs) {
      return this.pdfjs;
    }

    const pdfjs = await import('pdfjs-dist');

    pdfjs.GlobalWorkerOptions.workerSrc =
      this.getWorkerUrl();

    this.pdfjs = pdfjs;

    return pdfjs;
  }

  /**
   * Resolve the worker URL relative to the application's
   * current base URL.
   */
  private getWorkerUrl(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return this.workerPath;
    }

    return new URL(
      this.workerPath,
      document.baseURI
    ).toString();
  }

  /**
   * Load a PDF from a File.
   *
   * Protected PDFs are first decrypted locally through the shared security
   * engine when a password is supplied. The decrypted in-memory copy is then
   * used by Studio so the existing pdf-lib export pipeline can remain intact.
   */
  async loadFile(
    file: File,
    password?: string
  ): Promise<StudioPdfDocument> {
    if (password?.trim()) {
      const unlocked = await this.pdfSecurity.unlock(file, password);
      const buffer = await unlocked.file.arrayBuffer();

      return this.loadData(
        new Uint8Array(buffer),
        file.name,
        unlocked.file.size,
        'application/pdf',
        unlocked.file,
        file,
        true
      );
    }

    const buffer = await file.arrayBuffer();

    return this.loadData(
      new Uint8Array(buffer),
      file.name,
      file.size,
      file.type,
      file,
      file,
      false
    );
  }

  /**
   * Load a PDF from raw binary data.
   */
  async loadData(
    data: Uint8Array,
    name = 'Untitled.pdf',
    size = data.byteLength,
    type = 'application/pdf',
    file?: File,
    sourceFile?: File,
    sourceWasProtected = false
  ): Promise<StudioPdfDocument> {
    const pdfjs = await this.getPdfJs();

    const loadingTask = pdfjs.getDocument({
      data,
      disableFontFace: false,
      fontExtraProperties: true
    });

    const pdf = await loadingTask.promise;

    return {
      id: this.createDocumentId(),
      name,
      size,
      type,
      pageCount: pdf.numPages,
      file: file ?? new File([this.toArrayBuffer(data)], name, { type }),
      sourceFile: sourceFile ?? file,
      sourceWasProtected,
      pdf
    };
  }

  /**
   * Return a single PDF page.
   */
  async getPage(
    document: StudioPdfDocument,
    pageNumber: number
  ): Promise<PDFPageProxy> {
    this.assertValidPage(
      pageNumber,
      document.pageCount
    );

    return document.pdf.getPage(pageNumber);
  }

  /**
   * Read basic page information without rendering it.
   */
  async getPageInfo(
    document: StudioPdfDocument,
    pageNumber: number
  ): Promise<{
    pageNumber: number;
    rotation: number;
    width: number;
    height: number;
  }> {
    const page = await this.getPage(
      document,
      pageNumber
    );

    const viewport = page.getViewport({
      scale: 1
    });

    return {
      pageNumber,
      rotation: page.rotate,
      width: viewport.width,
      height: viewport.height
    };
  }

  /**
   * Destroy the PDF.js document and release resources.
   */
  async destroy(
    document: StudioPdfDocument | null
  ): Promise<void> {
    if (!document) {
      return;
    }

    await document.pdf.destroy();
  }

  /**
   * Generate a stable-enough local document identifier.
   */
  private createDocumentId(): string {
    if (
      isPlatformBrowser(this.platformId) &&
      typeof crypto !== 'undefined' &&
      'randomUUID' in crypto
    ) {
      return crypto.randomUUID();
    }

    return `pdf-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  /**
   * Validate requested page number.
   */
  private assertValidPage(
    pageNumber: number,
    pageCount: number
  ): void {
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pageCount
    ) {
      throw new RangeError(
        `Invalid PDF page number: ${pageNumber}. ` +
        `Expected a value between 1 and ${pageCount}.`
      );
    }
  }

  private toArrayBuffer(data: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    return buffer;
  }

}
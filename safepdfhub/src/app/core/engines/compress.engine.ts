import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';

let pdfjsPromise: Promise<any> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }

      const script = document.createElement('script');
      script.src =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

      script.onload = () => {
        const lib = (window as any).pdfjsLib;

        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        resolve(lib);
      };

      document.body.appendChild(script);
    });
  }

  return pdfjsPromise;
}

@Injectable({
  providedIn: 'root'
})
export class CompressEngine {

  // =====================
  // MAIN ENTRY
  // =====================
  async compress(
    file: File,
    onProgress?: (p: number) => void
  ): Promise<File> {

    const type = await this.detectPdfType(file);

    if (type === 'text') {
      return this.safeCompress(file, onProgress);
    }

    return this.strongCompress(file, onProgress);
  }

  // =====================
  // SAFE (TEXT PDF)
  // =====================
  async safeCompress(
    file: File,
    onProgress?: (p: number) => void
  ): Promise<File> {

    const srcDoc = await PDFDocument.load(
      await file.arrayBuffer(),
      { ignoreEncryption: true }
    );

    const newPdf = await PDFDocument.create();

    const totalPages = srcDoc.getPageCount();

    for (let i = 0; i < totalPages; i++) {
      const [page] = await newPdf.copyPages(srcDoc, [i]);
      newPdf.addPage(page);

      onProgress?.(Math.round(((i + 1) / totalPages) * 100));

      await new Promise(r => setTimeout(r, 0));
    }

    const pdfBytes = await newPdf.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50
    });

    return new File(
      [new Uint8Array(pdfBytes)],
      this.rename(file.name),
      { type: 'application/pdf' }
    );
  }

  // =====================
  // STRONG (SCANNED PDF)
  // =====================
  async strongCompress(
    file: File,
    onProgress?: (p: number) => void
  ): Promise<File> {

    const pdfjs = await loadPdfJs();

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    const newPdf = await PDFDocument.create();

    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.7 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const jpeg = canvas.toDataURL('image/jpeg', 0.6);

      const bytes = this.dataURLToUint8Array(jpeg);

      const img = await newPdf.embedJpg(bytes);

      const pdfPage = newPdf.addPage([img.width, img.height]);

      pdfPage.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height
      });

      onProgress?.(Math.round((i / totalPages) * 100));

      await new Promise(r => setTimeout(r, 0));
    }

    const pdfBytes = await newPdf.save({ useObjectStreams: true });

    return new File(
      [new Uint8Array(pdfBytes)],
      this.rename(file.name),
      { type: 'application/pdf' }
    );
  }

  // =====================
  // TYPE DETECTION
  // =====================
  async detectPdfType(file: File): Promise<'text' | 'scanned'> {

    const pdfjs = await loadPdfJs();

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    let textChars = 0;
    const pagesToCheck = Math.min(3, pdf.numPages);

    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);

      try {
        const textContent = await page.getTextContent();
        textChars += textContent.items.length;
      } catch {}

      page.cleanup();
    }

    pdf.destroy();

    return textChars > 50 ? 'text' : 'scanned';
  }

  // =====================
  // HELPERS
  // =====================
  private dataURLToUint8Array(dataURL: string): Uint8Array {
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);

    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  private rename(name: string): string {
    return name.replace(/\.pdf$/i, '-compressed-${originalName}.pdf');
  }
}
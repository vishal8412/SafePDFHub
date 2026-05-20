import { Injectable } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class PreviewService {

  async generatePreview(
    file: File,
    onProgress?: (p: number) => void
  ): Promise<{ preview: string; pages: number }> {

    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();

    const loadingTask = pdfjs.getDocument({ data: buffer });

    loadingTask.onProgress = (p: any) => {
      if (p.total) {
        onProgress?.(Math.round((p.loaded / p.total) * 100));
      }
    };

    const pdf = await loadingTask.promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.6 });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const preview = await this.canvasToBlobUrl(canvas,0.72);
    canvas.width = 0;
    canvas.height = 0;
    const pages = pdf.numPages;

    page.cleanup();
    await pdf.destroy();

    return { preview, pages };
  }

private async canvasToBlobUrl(
  canvas: HTMLCanvasElement,
  quality = 0.82
): Promise<string> {

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (b) => resolve(b!),
      'image/webp',
      quality
    );
  });

  return URL.createObjectURL(blob);
}

async generateViewerPages(file: File): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();

  const pdf = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: string[] = [];

  const MAX_INITIAL_PAGES = 20;
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_INITIAL_PAGES); i++) {
    await new Promise(r =>
      requestAnimationFrame(r)
    );
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const url = await this.canvasToBlobUrl(canvas,0.85);
    canvas.width = 0;
    canvas.height = 0;
    pages.push(url);
    page.cleanup();
  }

  await pdf.destroy();
  return pages;
}

cleanupUrls(urls: string[]) {
  urls.forEach(url => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
}

}

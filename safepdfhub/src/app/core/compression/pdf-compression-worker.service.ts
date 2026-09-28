import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class PdfCompressionWorkerService {
  private readonly platformId = inject(PLATFORM_ID);
  private worker: Worker | null = null;
  private requestId = 0;

  async encodeJpeg(
    image: ImageBitmap,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array | null> {
    if (!isPlatformBrowser(this.platformId) || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      return null;
    }

    const worker = this.getWorker();
    if (!worker) return null;

    const id = ++this.requestId;
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve(null);
      }, 30_000);

      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        cleanup();
        if (event.data.success) {
          resolve(new Uint8Array(event.data.bytes));
        } else {
          resolve(null);
        }
      };

      const onError = () => {
        cleanup();
        resolve(null);
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      try {
        worker.postMessage(
          { id, imageBitmap: image, width, height, quality },
          [image],
        );
      } catch {
        cleanup();
        reject(new Error('Unable to send PDF page to compression worker.'));
      }
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(
        new URL('../workers/pdf-compression.worker', import.meta.url),
        { type: 'module' },
      );
      return this.worker;
    } catch {
      this.worker = null;
      return null;
    }
  }
}

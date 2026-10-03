import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CompressionCancelledError } from './compression-cancellation';

@Injectable({ providedIn: 'root' })
export class PdfCompressionWorkerService {
  private readonly platformId = inject(PLATFORM_ID);
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, { reject: (reason?: unknown) => void; cleanup: () => void }>();

  async encodeJpeg(
    image: ImageBitmap,
    width: number,
    height: number,
    quality: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array | null> {
    if (!isPlatformBrowser(this.platformId) || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      return null;
    }

    const worker = this.getWorker();
    if (!worker) return null;

    const id = ++this.requestId;
    if (signal?.aborted) {
      throw new CompressionCancelledError();
    }
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
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };

      const onAbort = () => {
        cleanup();
        reject(new CompressionCancelledError());
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { reject, cleanup });

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

  cancel(): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      request.cleanup();
      request.reject(new CompressionCancelledError());
    }
    this.worker?.terminate();
    this.worker = null;
  }

  destroy(): void {
    this.cancel();
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

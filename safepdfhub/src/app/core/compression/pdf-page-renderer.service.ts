import { Injectable } from '@angular/core';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';

@Injectable({ providedIn: 'root' })
export class PdfPageRendererService {
  async renderToImageBitmap(
    page: any,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<ImageBitmap> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');

    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
    const viewport = page.getViewport({
      scale: width / baseViewport.width,
      rotation: 0,
    });

    throwIfCompressionCancelled(signal);
    const renderTask = page.render({ canvasContext: ctx, viewport });
    const onAbort = () => renderTask.cancel?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await renderTask.promise;
    } catch (error) {
      if (signal?.aborted) throw new CompressionCancelledError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    throwIfCompressionCancelled(signal);
    const bitmap = await createImageBitmap(canvas);
    try {
      throwIfCompressionCancelled(signal);
      return bitmap;
    } catch (error) {
      bitmap.close();
      throw error;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async renderToJpeg(
    page: any,
    width: number,
    height: number,
    quality: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const bitmap = await this.renderToImageBitmap(page, width, height, signal);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      throwIfCompressionCancelled(signal);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG encoding failed.')), 'image/jpeg', quality);
      });
      canvas.width = 0;
      canvas.height = 0;
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  }
}

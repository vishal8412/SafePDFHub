import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PdfPageRendererService {
  async renderToImageBitmap(
    page: any,
    width: number,
    height: number,
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

    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    const bitmap = await createImageBitmap(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return bitmap;
  }

  async renderToJpeg(
    page: any,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array> {
    const bitmap = await this.renderToImageBitmap(page, width, height);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
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

import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PdfPageRendererService {

  async renderToJpeg(
    page: any,
    width: number,
    height: number,
    quality: number
  ): Promise<Uint8Array> {

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas context unavailable');
    }

    canvas.width = width;
    canvas.height = height;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const viewport = page.getViewport({
      scale: width / page.getViewport({ scale: 1 }).width
    });

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    page.cleanup();

    const blob = await new Promise<Blob>(resolve =>
      canvas.toBlob(
        b => resolve(b!),
        'image/jpeg',
        quality
      )
    );

    canvas.width = 0;
    canvas.height = 0;

    return new Uint8Array(await blob.arrayBuffer());
  }
}
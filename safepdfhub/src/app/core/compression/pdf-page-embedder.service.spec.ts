import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfPageEmbedderService } from './pdf-page-embedder.service';

describe('PdfPageEmbedderService — C6', () => {
  it.each([0, 90, 180, 270])('preserves page rotation %s°', async (rotation) => {
    const pdf = await PDFDocument.create();
    const service = new PdfPageEmbedderService();

    // 1x1 JPEG, sufficient for pdf-lib image embedding.
    const jpeg = Uint8Array.from(
      atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8hH//Z'),
      (char) => char.charCodeAt(0),
    );

    const page = await service.addJpegPage(pdf, jpeg, {
      width: 612,
      height: 792,
      rotation,
    });

    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
    expect(page.getRotation().angle).toBe(rotation);
  });
});

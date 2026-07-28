import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';

@Injectable({
  providedIn: 'root'
})
export class PdfPageEmbedderService {

  async addJpegPage(pdf: PDFDocument,jpegBytes: Uint8Array): Promise<void> {

    const image = await pdf.embedJpg(jpegBytes);
    const page = pdf.addPage([image.width,image.height]);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    });
  }

}
import { Injectable } from '@angular/core';
import { PDFDocument, PDFPage, degrees } from 'pdf-lib';

export interface PdfPageGeometry {
  width: number;
  height: number;
  rotation: number;
  mediaBox?: { x: number; y: number; width: number; height: number };
  cropBox?: { x: number; y: number; width: number; height: number };
}

@Injectable({ providedIn: 'root' })
export class PdfPageEmbedderService {
  async addJpegPage(
    pdf: PDFDocument,
    jpegBytes: Uint8Array,
    geometry: PdfPageGeometry,
  ): Promise<PDFPage> {
    const image = await pdf.embedJpg(jpegBytes);
    const page = pdf.addPage([geometry.width, geometry.height]);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width: geometry.width,
      height: geometry.height,
    });

    if (Number.isFinite(geometry.rotation)) {
      page.setRotation(degrees(this.normalizeRotation(geometry.rotation)));
    }

    if (geometry.mediaBox && typeof (page as any).setMediaBox === 'function') {
      (page as any).setMediaBox(
        geometry.mediaBox.x,
        geometry.mediaBox.y,
        geometry.mediaBox.width,
        geometry.mediaBox.height,
      );
    }

    if (geometry.cropBox && typeof (page as any).setCropBox === 'function') {
      (page as any).setCropBox(
        geometry.cropBox.x,
        geometry.cropBox.y,
        geometry.cropBox.width,
        geometry.cropBox.height,
      );
    }

    return page;
  }

  private normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
    const normalized = ((rotation % 360) + 360) % 360;
    if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
    return 0;
  }
}

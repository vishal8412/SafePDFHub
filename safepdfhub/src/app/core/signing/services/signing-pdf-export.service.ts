import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PDFDocument, degrees, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { SigningPdfTextService } from './signing-pdf-text.service';
import { saveAs } from 'file-saver';
import type { SigningBounds, SigningField } from '../models/signing.models';

export interface ExportBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Converts the normalized coordinates used by the PDF.js rotated preview
 * back into pdf-lib's unrotated PDF user space.
 *
 * The preview already contains the page rotation. The exporter must therefore
 * undo that display transform exactly once and must not apply the page rotation
 * a second time when painting the field.
 */
export function displayBoundsToPdfBox(
  bounds: SigningBounds,
  pageWidth: number,
  pageHeight: number,
  rotation: 0 | 90 | 180 | 270,
): ExportBox {
  const displayWidth = rotation === 90 || rotation === 270 ? pageHeight : pageWidth;
  const displayHeight = rotation === 90 || rotation === 270 ? pageWidth : pageHeight;

  const x = bounds.x * displayWidth;
  const yTop = bounds.y * displayHeight;
  const width = bounds.width * displayWidth;
  const height = bounds.height * displayHeight;

  switch (rotation) {
    case 90:
      return {
        x: pageWidth - yTop - height,
        y: x,
        width: height,
        height: width,
      };
    case 180:
      return {
        x: pageWidth - x - width,
        y: yTop,
        width,
        height,
      };
    case 270:
      return {
        x: yTop,
        y: pageHeight - x - width,
        width: height,
        height: width,
      };
    default:
      return {
        x,
        y: pageHeight - yTop - height,
        width,
        height,
      };
  }
}

export function normalizeSigningFieldRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const normalized = ((value ?? 0) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

@Injectable({ providedIn: 'root' })
export class SigningPdfExportService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly signingText = inject(SigningPdfTextService);

  async export(sourceFile: File, fields: readonly SigningField[], outputName?: string): Promise<Blob> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('PDF export is available only in the browser.');
    }

    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
    const pdf = await PDFDocument.load(sourceBytes);
    const pages = pdf.getPages();
    const sourcePageCount = pages.length;
    const images = new Map<string, PDFImage>();

    for (const field of fields) {
      if (!this.isValidFieldBounds(field.bounds)) {
        throw new Error('A signing field has invalid placement data. Please reposition it and try again.');
      }

      const page = pages[field.pageNumber - 1];
      if (!page) {
        throw new Error(`Signing field references missing page ${field.pageNumber}.`);
      }

      const rotation = this.normalizePageRotation(page.getRotation().angle);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const box = displayBoundsToPdfBox(field.bounds, pageWidth, pageHeight, rotation);
      const fieldRotation = normalizeSigningFieldRotation(field.rotation);

      if (field.kind === 'checkbox') {
        this.drawCheckbox(page, box, field.checked ?? true, field.color ?? '#0b6c5f', field.opacity ?? 1);
        continue;
      }

      if (field.kind === 'text' || field.kind === 'date') {
        const text = field.value ?? (field.kind === 'date' ? new Date().toLocaleDateString() : '');
        if (!text) continue;
        await this.signingText.drawText(
          pdf,
          page,
          text,
          box,
          {
            fontFamily: field.fontFamily,
            fontSize: field.fontSize,
            fontStyle: field.fontStyle,
            color: field.color,
            opacity: field.opacity,
          },
          fieldRotation,
        );
        continue;
      }

      const asset = field.asset;
      if (!asset) continue;

      let image = images.get(asset.id);
      if (!image) {
        image = asset.mimeType === 'image/jpeg'
          ? await pdf.embedJpg(this.dataUrlToBytes(asset.dataUrl))
          : await pdf.embedPng(this.dataUrlToBytes(asset.dataUrl));
        images.set(asset.id, image);
      }
      this.drawImage(page, image, box, fieldRotation, field.opacity ?? 1);
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const blob = new Blob([blobBytes.buffer as ArrayBuffer], { type: 'application/pdf' });

    await this.validateExportedPdf(blob, sourcePageCount);

    if (outputName) saveAs(blob, outputName);
    return blob;
  }

  async exportAndDownload(sourceFile: File, fields: readonly SigningField[]): Promise<void> {
    const base = sourceFile.name.replace(/\.pdf$/i, '') || 'document';
    await this.export(sourceFile, fields, `${base}_signed.pdf`);
  }

  private async validateExportedPdf(blob: Blob, expectedPageCount: number): Promise<void> {
    if (blob.size < 32) {
      throw new Error('The signed PDF output is unexpectedly small and could not be validated.');
    }

    const header = new TextDecoder().decode(await blob.slice(0, 8).arrayBuffer());
    if (!header.startsWith('%PDF-')) {
      throw new Error('The signed PDF output did not contain a valid PDF header.');
    }

    const tailBytes = new Uint8Array(await blob.slice(Math.max(0, blob.size - 64), blob.size).arrayBuffer());
    const tail = new TextDecoder().decode(tailBytes);
    if (!tail.includes('%%EOF')) {
      throw new Error('The signed PDF output is missing its EOF marker.');
    }

    try {
      const reopened = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), {
        updateMetadata: false,
      });
      const actualPageCount = reopened.getPageCount();
      if (actualPageCount !== expectedPageCount) {
        throw new Error(`The signed PDF changed page count from ${expectedPageCount} to ${actualPageCount}.`);
      }
      if (actualPageCount < 1) {
        throw new Error('The signed PDF contains no pages.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('The signed PDF')) throw error;
      throw new Error('The generated signed PDF could not be reopened for validation.');
    }
  }

  private normalizePageRotation(value: number): 0 | 90 | 180 | 270 {
    const normalized = ((value % 360) + 360) % 360;
    if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
    return 0;
  }

  private isValidFieldBounds(bounds: SigningBounds): boolean {
    return Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
      && bounds.x >= 0 && bounds.y >= 0
      && bounds.width > 0 && bounds.height > 0
      && bounds.x + bounds.width <= 1.000001
      && bounds.y + bounds.height <= 1.000001;
  }

  private drawImage(
    page: PDFPage,
    image: PDFImage,
    box: ExportBox,
    rotation: 0 | 90 | 180 | 270,
    opacity: number,
  ): void {
    const alpha = Math.max(0, Math.min(1, opacity));
    if (rotation === 0) {
      page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height, opacity: alpha });
      return;
    }

    // Field rotation is independent from page rotation. The page rotation has
    // already been inverted by displayBoundsToPdfBox().
    const radians = degrees(rotation);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const width = rotation === 90 || rotation === 270 ? box.height : box.width;
    const height = rotation === 90 || rotation === 270 ? box.width : box.height;
    page.drawImage(image, {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      rotate: radians,
      opacity: alpha,
    });
  }

  private drawCheckbox(
    page: PDFPage,
    box: ExportBox,
    checked: boolean,
    color: string,
    opacity: number,
  ): void {
    // Page rotation has already been inverted by displayBoundsToPdfBox().
    // V1 does not expose a separate checkbox rotation control.
    this.drawCheckboxAt(page, box, checked, color, opacity);
  }

  private drawCheckboxAt(page: PDFPage, box: ExportBox, checked: boolean, color: string, opacity: number): void {
    const c = this.hexToRgb(color);
    const alpha = Math.max(0.05, Math.min(1, opacity));
    page.drawRectangle({
      x: box.x, y: box.y, width: box.width, height: box.height,
      borderWidth: 1, borderColor: rgb(c.r, c.g, c.b), color: rgb(1, 1, 1),
      opacity: Math.min(0.92, alpha),
    });
    if (!checked) return;
    page.drawLine({
      start: { x: box.x + box.width * 0.18, y: box.y + box.height * 0.50 },
      end: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.24 },
      thickness: Math.max(0.9, box.width * 0.075), color: rgb(c.r, c.g, c.b), opacity: alpha,
    });
    page.drawLine({
      start: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.24 },
      end: { x: box.x + box.width * 0.84, y: box.y + box.height * 0.76 },
      thickness: Math.max(0.9, box.width * 0.075), color: rgb(c.r, c.g, c.b), opacity: alpha,
    });
  }


  private pdfColor(value: string) {
    const c = this.hexToRgb(value);
    return rgb(c.r, c.g, c.b);
  }

  private hexToRgb(value: string): { r: number; g: number; b: number } {
    const hex = value.replace('#', '').trim();
    const normalized = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
    const parsed = Number.parseInt(normalized, 16);
    if (!Number.isFinite(parsed)) return { r: 0.07, g: 0.10, b: 0.14 };
    return { r: ((parsed >> 16) & 255) / 255, g: ((parsed >> 8) & 255) / 255, b: (parsed & 255) / 255 };
  }

  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PdfWatermarkFont } from './pdf-watermark.types';

export interface WatermarkTextMetrics {
  readonly width: number;
  readonly height: number;
  readonly ascenderHeight: number;
  readonly descenderHeight: number;
  readonly font: PdfWatermarkFont;
  readonly fontSize: number;
  readonly text: string;
}

/**
 * Single source of truth for standard-PDF-font text metrics.
 *
 * Both the standalone preview and Studio use this service so the browser
 * overlay is measured with the same pdf-lib font metrics used by export.
 */
@Injectable({ providedIn: 'root' })
export class PdfWatermarkMetricsService {
  private readonly cache = new Map<string, Promise<WatermarkTextMetrics>>();

  measure(font: PdfWatermarkFont, text: string, fontSize: number): Promise<WatermarkTextMetrics> {
    const normalizedText = text || 'WATERMARK';
    const normalizedSize = Math.max(8, Math.min(200, fontSize));
    const key = `${font}\u0000${normalizedSize}\u0000${normalizedText}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const promise = this.measureUncached(font, normalizedText, normalizedSize);
    this.cache.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }

  private async measureUncached(
    fontName: PdfWatermarkFont,
    text: string,
    fontSize: number,
  ): Promise<WatermarkTextMetrics> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(this.standardFont(fontName));
    const height = font.heightAtSize(fontSize);
    const ascenderHeight = font.heightAtSize(fontSize, { descender: false });
    const descenderHeight = Math.max(0, height - ascenderHeight);

    return {
      width: font.widthOfTextAtSize(text, fontSize),
      height,
      ascenderHeight,
      descenderHeight,
      font: fontName,
      fontSize,
      text,
    };
  }

  private standardFont(font: PdfWatermarkFont): StandardFonts {
    switch (font) {
      case 'Times-Roman': return StandardFonts.TimesRoman;
      case 'Courier': return StandardFonts.Courier;
      default: return StandardFonts.Helvetica;
    }
  }
}

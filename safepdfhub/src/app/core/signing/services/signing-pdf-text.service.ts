import { Injectable } from '@angular/core';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';

export interface SigningPdfTextBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SigningPdfTextStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontStyle?: 'normal' | 'italic';
  readonly fontWeight?: number;
  readonly color?: string;
  readonly opacity?: number;
  /** Set to true when fontSize is expressed in browser CSS pixels. */
  readonly cssPixels?: boolean;
}

export type SigningPdfTextRotation = 0 | 90 | 180 | 270;

type StandardSigningFontKey =
  | 'helvetica'
  | 'helvetica-oblique'
  | 'helvetica-bold'
  | 'helvetica-bold-oblique'
  | 'times'
  | 'times-italic'
  | 'times-bold'
  | 'times-bold-italic'
  | 'courier'
  | 'courier-oblique'
  | 'courier-bold'
  | 'courier-bold-oblique';

/**
 * P2.2 — Native PDF signing text.
 *
 * Signing text/date fields are emitted as PDF text operators rather than
 * browser-rasterized PNG images. This keeps the output selectable/searchable
 * and avoids turning a simple text field into an image XObject.
 *
 * V1 intentionally uses the PDF standard 14 fonts. Browser CSS fonts such as
 * Inter/Segoe Script are not portable font files, so they are mapped to the
 * closest standard PDF family while preserving serif/monospace/italic/bold
 * intent. A future font-embedding phase can extend this resolver without
 * changing the exporters.
 */
@Injectable({ providedIn: 'root' })
export class SigningPdfTextService {
  private readonly fontCache = new WeakMap<PDFDocument, Map<StandardSigningFontKey, PDFFont>>();

  async drawText(
    pdf: PDFDocument,
    page: PDFPage,
    text: string,
    box: SigningPdfTextBox,
    style: SigningPdfTextStyle = {},
    rotation: SigningPdfTextRotation = 0,
  ): Promise<void> {
    const value = text.replace(/\r?\n/g, ' ').trim();
    if (!value || box.width <= 0 || box.height <= 0) return;

    const key = this.resolveFontKey(style.fontFamily, style.fontStyle, style.fontWeight);
    const font = await this.getFont(pdf, key);
    const scale = style.cssPixels ? 0.75 : 1;
    const requestedSize = this.clamp((style.fontSize ?? 16) * scale, 4.5, 96);

    const horizontalLimit = rotation === 90 || rotation === 270 ? box.height : box.width;
    const verticalLimit = rotation === 90 || rotation === 270 ? box.width : box.height;
    const padding = Math.min(4, Math.max(0.5, Math.min(horizontalLimit, verticalLimit) * 0.08));
    const availableWidth = Math.max(1, horizontalLimit - padding * 2);
    const availableHeight = Math.max(1, verticalLimit - padding * 2);

    let fontSize = Math.min(requestedSize, availableHeight * 0.82);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const width = font.widthOfTextAtSize(value, fontSize);
      if (width <= availableWidth || fontSize <= 4.5) break;
      fontSize = Math.max(4.5, fontSize * 0.9);
    }

    const textWidth = font.widthOfTextAtSize(value, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const color = this.pdfColor(style.color ?? '#121923');
    const opacity = this.clamp(style.opacity ?? 1, 0.05, 1);

    const position = this.centeredOrigin(
      centerX,
      centerY,
      textWidth,
      textHeight,
      rotation,
    );

    page.drawText(value, {
      x: position.x,
      y: position.y,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: degrees(rotation),
    });
  }

  private async getFont(pdf: PDFDocument, key: StandardSigningFontKey): Promise<PDFFont> {
    let cache = this.fontCache.get(pdf);
    if (!cache) {
      cache = new Map<StandardSigningFontKey, PDFFont>();
      this.fontCache.set(pdf, cache);
    }

    const existing = cache.get(key);
    if (existing) return existing;

    const font = await pdf.embedFont(this.standardFontName(key));
    cache.set(key, font);
    return font;
  }

  private standardFontName(key: StandardSigningFontKey): StandardFonts {
    switch (key) {
      case 'times': return StandardFonts.TimesRoman;
      case 'times-italic': return StandardFonts.TimesRomanItalic;
      case 'times-bold': return StandardFonts.TimesRomanBold;
      case 'times-bold-italic': return StandardFonts.TimesRomanBoldItalic;
      case 'courier': return StandardFonts.Courier;
      case 'courier-oblique': return StandardFonts.CourierOblique;
      case 'courier-bold': return StandardFonts.CourierBold;
      case 'courier-bold-oblique': return StandardFonts.CourierBoldOblique;
      case 'helvetica-oblique': return StandardFonts.HelveticaOblique;
      case 'helvetica-bold': return StandardFonts.HelveticaBold;
      case 'helvetica-bold-oblique': return StandardFonts.HelveticaBoldOblique;
      default: return StandardFonts.Helvetica;
    }
  }

  private resolveFontKey(
    family: string | undefined,
    style: 'normal' | 'italic' | undefined,
    weight: number | undefined,
  ): StandardSigningFontKey {
    const normalized = (family ?? '').toLowerCase();
    const serif = normalized.includes('times') || normalized.includes('georgia') || normalized.includes('serif');
    const mono = normalized.includes('courier') || normalized.includes('mono');
    const italic = style === 'italic';
    const bold = typeof weight === 'number' && weight >= 600;

    if (serif) {
      if (bold && italic) return 'times-bold-italic';
      if (bold) return 'times-bold';
      if (italic) return 'times-italic';
      return 'times';
    }

    if (mono) {
      if (bold && italic) return 'courier-bold-oblique';
      if (bold) return 'courier-bold';
      if (italic) return 'courier-oblique';
      return 'courier';
    }

    if (bold && italic) return 'helvetica-bold-oblique';
    if (bold) return 'helvetica-bold';
    if (italic) return 'helvetica-oblique';
    return 'helvetica';
  }

  private centeredOrigin(
    centerX: number,
    centerY: number,
    textWidth: number,
    textHeight: number,
    rotation: SigningPdfTextRotation,
  ): { x: number; y: number } {
    switch (rotation) {
      case 90:
        return { x: centerX + textHeight / 2, y: centerY - textWidth / 2 };
      case 180:
        return { x: centerX + textWidth / 2, y: centerY + textHeight / 2 };
      case 270:
        return { x: centerX - textHeight / 2, y: centerY + textWidth / 2 };
      default:
        return { x: centerX - textWidth / 2, y: centerY - textHeight / 2 + textHeight * 0.15 };
    }
  }

  private pdfColor(value: string) {
    const hex = value.replace('#', '').trim();
    const normalized = hex.length === 3
      ? hex.split('').map(char => char + char).join('')
      : hex;
    const parsed = Number.parseInt(normalized, 16);
    if (!Number.isFinite(parsed)) return rgb(0.07, 0.10, 0.14);
    return rgb(
      ((parsed >> 16) & 255) / 255,
      ((parsed >> 8) & 255) / 255,
      (parsed & 255) / 255,
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

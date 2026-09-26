import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFImage,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib';
import {
  PdfWatermarkError,
  type PdfWatermarkFont,
  type PdfWatermarkKind,
  type PdfWatermarkPosition,
  type PdfWatermarkRequest,
  type PdfWatermarkResult,
} from './pdf-watermark.types';

export interface WatermarkPoint {
  readonly x: number;
  readonly y: number;
}

export function resolveWatermarkPageSelection(
  selection: PdfWatermarkRequest['pageSelection'],
  pageCount: number,
): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PdfWatermarkError('The document must contain at least one page.', 'PAGE_SELECTION_INVALID');
  }

  if (selection.mode === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);

  if (selection.mode === 'current') {
    if (!Number.isInteger(selection.page) || selection.page < 1 || selection.page > pageCount) {
      throw new PdfWatermarkError(`Current page ${selection.page} is outside the document.`, 'PAGE_SELECTION_INVALID');
    }
    return [selection.page];
  }

  const pages = new Set<number>();
  const ranges = selection.ranges.split(',').map(item => item.trim()).filter(Boolean);
  if (!ranges.length) {
    throw new PdfWatermarkError('Enter at least one page or page range.', 'PAGE_SELECTION_INVALID');
  }

  for (const range of ranges) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (!match) {
      throw new PdfWatermarkError(`Invalid page range: ${range}.`, 'PAGE_SELECTION_INVALID');
    }
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new PdfWatermarkError(`Page range ${range} is outside the document.`, 'PAGE_SELECTION_INVALID');
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }

  return [...pages].sort((a, b) => a - b);
}

function snapGeometry(value: number, precision = 1e9): number {
  if (!Number.isFinite(value)) return value;
  const snapped = Math.round(value * precision) / precision;
  return Object.is(snapped, -0) ? 0 : snapped;
}

export function watermarkRotatedBounds(
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } {
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: snapGeometry(width * cos + height * sin),
    height: snapGeometry(width * sin + height * cos),
  };
}

/**
 * Resolve a watermark center directly in browser/SVG top-left coordinates.
 *
 * The shared PDF watermark geometry uses PDF-style bottom-left coordinates.
 * Studio's live SVG preview uses browser top-left coordinates. Keeping this
 * conversion explicit prevents the Studio preview from accidentally applying
 * the Y-axis inversion twice (or not at all).
 */
/**
 * Resolve a watermark center directly in browser/SVG top-left coordinates.
 *
 * This is a display-space boundary helper. It deliberately does NOT call the
 * PDF-space position resolver and then invert the result. Keeping the
 * top-origin calculation explicit prevents Studio from accidentally gaining
 * a second Y-axis conversion when PDF geometry is passed through the preview
 * layer.
 *
 * Contract:
 *   - x grows left -> right
 *   - y grows top -> bottom
 *   - "top-*" means a visually top anchor
 *   - "bottom-*" means a visually bottom anchor
 *
 * The shared PDF exporter continues to use watermarkPositionCenter(), whose
 * contract remains PDF bottom-left coordinates.
 */
export function watermarkDisplayPositionCenter(
  position: PdfWatermarkPosition,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  rotation = 0,
  minimumMargin = 24,
): WatermarkPoint {
  const bounds = watermarkRotatedBounds(width, height, rotation);
  const safeMinimumMargin = Math.max(0, minimumMargin);
  const marginX = Math.max(safeMinimumMargin, pageWidth * 0.06);
  const marginY = Math.max(safeMinimumMargin, pageHeight * 0.06);

  const targetX = position.endsWith('left')
    ? marginX + bounds.width / 2
    : position.endsWith('right')
      ? pageWidth - marginX - bounds.width / 2
      : pageWidth / 2;

  const targetY = position.startsWith('top')
    ? marginY + bounds.height / 2
    : position.startsWith('bottom')
      ? pageHeight - marginY - bounds.height / 2
      : pageHeight / 2;

  const minX = marginX + bounds.width / 2;
  const maxX = pageWidth - marginX - bounds.width / 2;
  const minY = marginY + bounds.height / 2;
  const maxY = pageHeight - marginY - bounds.height / 2;

  let x = minX <= maxX ? Math.min(maxX, Math.max(minX, targetX)) : pageWidth / 2;
  let y = minY <= maxY ? Math.min(maxY, Math.max(minY, targetY)) : pageHeight / 2;

  // Correct only the sub-ulp boundary drift that can appear when a rotated
  // bound is subtracted from its anchor. Integer/simple cases remain exact;
  // non-integer trigonometric cases receive a tiny inward correction.
  const epsilonX = Math.max(1e-9, Math.max(1, pageWidth) * 1e-12);
  const epsilonY = Math.max(1e-9, Math.max(1, pageHeight) * 1e-12);
  if (minX <= maxX) {
    if (x - bounds.width / 2 < marginX) x = marginX + bounds.width / 2 + epsilonX;
    if (x + bounds.width / 2 > pageWidth - marginX) x = pageWidth - marginX - bounds.width / 2 - epsilonX;
  }
  if (minY <= maxY) {
    if (y - bounds.height / 2 < marginY) y = marginY + bounds.height / 2 + epsilonY;
    if (y + bounds.height / 2 > pageHeight - marginY) y = pageHeight - marginY - bounds.height / 2 - epsilonY;
  }

  return { x: snapGeometry(x), y: snapGeometry(y) };
}

/**
 * Backward-compatible alias for existing Studio callers/tests.
 *
 * Keep this alias as the explicit display-space boundary so older callers do
 * not silently revert to PDF-space geometry.
 */
export function watermarkPositionCenterTopOrigin(
  position: PdfWatermarkPosition,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  rotation = 0,
  minimumMargin = 24,
): WatermarkPoint {
  return watermarkDisplayPositionCenter(
    position,
    pageWidth,
    pageHeight,
    width,
    height,
    rotation,
    minimumMargin,
  );
}

export function watermarkPositionCenter(
  position: PdfWatermarkPosition,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  rotation = 0,
  minimumMargin = 24,
): WatermarkPoint {
  // The display-space helper is the canonical anchor calculation. PDF-space
  // geometry is the exact vertical inversion of that display-space point.
  // Keeping one anchor algorithm prevents preview/export drift.
  const displayCenter = watermarkDisplayPositionCenter(
    position, pageWidth, pageHeight, width, height, rotation, minimumMargin,
  );
  const bounds = watermarkRotatedBounds(width, height, rotation);
  const safeMargin = Math.max(0, minimumMargin);
  const marginX = Math.max(safeMargin, pageWidth * 0.06);
  const marginY = Math.max(safeMargin, pageHeight * 0.06);
  const minX = marginX + bounds.width / 2;
  const maxX = pageWidth - marginX - bounds.width / 2;
  const minY = marginY + bounds.height / 2;
  const maxY = pageHeight - marginY - bounds.height / 2;

  let x = displayCenter.x;
  let y = pageHeight - displayCenter.y;

  // The display-space helper is already safe, but PDF Y is produced by a
  // subtraction from pageHeight. That inversion can introduce a sub-ulp
  // drift at the safe-area boundary (for example 47.5199999995 instead of
  // 47.52). Re-clamp in PDF space so preview/export geometry has a
  // deterministic boundary contract too.
  const epsilonX = Math.max(1e-9, Math.max(1, pageWidth) * 1e-12);
  const epsilonY = Math.max(1e-9, Math.max(1, pageHeight) * 1e-12);
  if (minX <= maxX) {
    if (x < minX) x = minX + epsilonX;
    if (x > maxX) x = maxX - epsilonX;
  }
  if (minY <= maxY) {
    if (y < minY) y = minY + epsilonY;
    if (y > maxY) y = maxY - epsilonY;
  }

  return { x: snapGeometry(x), y: snapGeometry(y) };
}

/**
 * Return the scale required to keep a repeated watermark fully visible while
 * preserving the four fixed normalized centers. The scale is applied to the
 * visible watermark bounds, not to the anchor positions.
 */
export function watermarkTiledScale(
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  rotation = 0,
  minimumMargin = 18,
): number {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(width > 0) || !(height > 0)) return 1;

  const bounds = watermarkRotatedBounds(width, height, rotation);
  const marginX = Math.max(0, minimumMargin, pageWidth * 0.04);
  const marginY = Math.max(0, minimumMargin, pageHeight * 0.04);
  const availableWidth = Math.max(1, pageWidth * 0.5 - marginX * 2);
  const availableHeight = Math.max(1, pageHeight * 0.5 - marginY * 2);
  const scaleX = availableWidth / Math.max(1, bounds.width);
  const scaleY = availableHeight / Math.max(1, bounds.height);
  const scale = Math.min(1, scaleX, scaleY);
  // Leave a tiny deterministic safety epsilon below the theoretical limit so
  // floating-point subtraction can never move an edge a few ulps outside the
  // requested safe area. This does not materially change visible geometry.
  return scale < 1 ? scale * (1 - 1e-9) : 1;
}

export function watermarkTiledCenters(
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  kind: PdfWatermarkKind,
  unitScale = 1,
  rotation = 0,
): WatermarkPoint[] {
  // Repeat mode is a fixed normalized four-anchor contract. The content is
  // scaled by watermarkTiledScale() when necessary; centers never move.
  void width;
  void height;
  void kind;
  void unitScale;
  void rotation;

  if (!(pageWidth > 0) || !(pageHeight > 0)) return [];

  return [
    { x: pageWidth * 0.25, y: pageHeight * 0.75 },
    { x: pageWidth * 0.75, y: pageHeight * 0.75 },
    { x: pageWidth * 0.25, y: pageHeight * 0.25 },
    { x: pageWidth * 0.75, y: pageHeight * 0.25 },
  ];
}


/**
 * Convert the user-facing visual rotation to the PDF-space rotation required
 * after the page's /Rotate transform is applied. PDF uses +Y upward, while
 * the preview uses +Y downward.
 */

export function watermarkDisplayCenterToCssTopLeft(
  center: WatermarkPoint,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  scale: number,
): { left: number; top: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const widthPx = Math.max(0, width) * safeScale;
  const heightPx = Math.max(0, height) * safeScale;
  return {
    left: center.x * safeScale - widthPx / 2,
    top: (pageHeight - center.y) * safeScale - heightPx / 2,
  };
}

export function watermarkDisplayRotationToPdfRotation(
  displayRotation: number,
  pageRotation: 0 | 90 | 180 | 270,
): number {
  return pageRotation - displayRotation;
}

export function watermarkDisplayPointToPdfPoint(
  point: WatermarkPoint,
  pageWidth: number,
  pageHeight: number,
  rotation: 0 | 90 | 180 | 270,
): WatermarkPoint {
  switch (rotation) {
    case 90: return { x: pageWidth - point.y, y: point.x };
    case 180: return { x: pageWidth - point.x, y: pageHeight - point.y };
    case 270: return { x: point.y, y: pageHeight - point.x };
    default: return { x: point.x, y: point.y };
  }
}

@Injectable({ providedIn: 'root' })
export class PdfWatermarkService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly capability = inject(LocalProcessingCapabilityService);
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  async apply(
    sourceFile: File,
    request: PdfWatermarkRequest,
    onProgress?: (progress: number) => void,
  ): Promise<PdfWatermarkResult> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new PdfWatermarkError('PDF watermarking is available only in the browser.', 'INPUT_INVALID');
    }

    this.cancelled = false;
    this.assertRequest(request);

    const budget = this.capability.budget;
    if (sourceFile.size > budget.maxFileBytes) {
      throw new PdfWatermarkError(
        `This PDF is larger than the ${this.formatBytes(budget.maxFileBytes)} local limit for this device.`,
        'INPUT_INVALID',
      );
    }

    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
    this.throwIfCancelled();

    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    } catch {
      throw new PdfWatermarkError('This file could not be opened as a valid PDF.', 'INPUT_INVALID');
    }

    const pages = pdf.getPages();
    if (!pages.length) {
      throw new PdfWatermarkError('The PDF does not contain any pages.', 'INPUT_INVALID');
    }

    if (pages.length > budget.maxPages) {
      throw new PdfWatermarkError(
        `This PDF contains ${pages.length.toLocaleString()} pages, above the ${budget.maxPages.toLocaleString()} page local limit for this device.`,
        'INPUT_INVALID',
      );
    }

    const pageNumbers = this.resolvePageNumbers(request.pageSelection, pages.length);
    const startedAt = performance.now();
    let image: PDFImage | null = null;

    try {
      if (request.kind === 'image') {
        image = await this.embedImage(pdf, request.imageFile!);
      }

      const font = request.kind === 'text'
        ? await pdf.embedFont(this.standardFont(request.font))
        : null;

      for (let i = 0; i < pageNumbers.length; i += 1) {
        this.throwIfCancelled();
        const page = pages[pageNumbers[i] - 1];
        if (!page) {
          throw new PdfWatermarkError(`Page ${pageNumbers[i]} does not exist.`, 'PAGE_SELECTION_INVALID');
        }

        if (request.kind === 'text') {
          this.drawTextWatermark(page, font!, request);
        } else {
          this.drawImageWatermark(page, image!, request);
        }

        onProgress?.(Math.round(((i + 1) / pageNumbers.length) * 90));
        await this.yieldToBrowser();
      }

      this.throwIfCancelled();
      onProgress?.(95);
      const bytes = await pdf.save({ useObjectStreams: true });
      this.throwIfCancelled();

      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const base = sourceFile.name.replace(/\.pdf$/i, '') || 'document';
      const output = new File([buffer], `${base}_watermarked.pdf`, { type: 'application/pdf' });
      await this.validateOutput(output, pages.length);
      onProgress?.(100);

      return {
        file: output,
        pageCount: pages.length,
        watermarkedPageCount: pageNumbers.length,
        durationMs: performance.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof PdfWatermarkError) throw error;
      const message = error instanceof Error ? error.message : '';
      if (/WinAnsi|cannot encode|encode/i.test(message)) {
        throw new PdfWatermarkError(
          'This text contains characters that the selected standard PDF font cannot encode. Try plain Latin text or choose another font.',
          'TEXT_INVALID',
        );
      }
      throw new PdfWatermarkError('The PDF could not be watermarked. Please try again.', 'OUTPUT_INVALID');
    }
  }

  private assertRequest(request: PdfWatermarkRequest): void {
    if (!Number.isFinite(request.opacity) || request.opacity < 0.05 || request.opacity > 1) {
      throw new PdfWatermarkError('Opacity must be between 5% and 100%.', 'OPTION_INVALID');
    }
    if (!Number.isFinite(request.rotation) || request.rotation < -180 || request.rotation > 180) {
      throw new PdfWatermarkError('Rotation must be between -180° and 180°.', 'OPTION_INVALID');
    }
    if (request.kind === 'text') {
      const text = request.text?.trim() ?? '';
      if (!text || text.length > 300) {
        throw new PdfWatermarkError('Enter watermark text between 1 and 300 characters.', 'TEXT_INVALID');
      }
      if (!Number.isFinite(request.fontSize) || request.fontSize < 8 || request.fontSize > 200) {
        throw new PdfWatermarkError('Font size must be between 8 and 200 points.', 'OPTION_INVALID');
      }
    } else if (!(request.imageFile instanceof File)) {
      throw new PdfWatermarkError('Choose a PNG, JPEG, or WebP image for the watermark.', 'IMAGE_INVALID');
    }
    if (!Number.isFinite(request.imageScalePercent) || request.imageScalePercent < 5 || request.imageScalePercent > 80) {
      throw new PdfWatermarkError('Image scale must be between 5% and 80% of the page width.', 'OPTION_INVALID');
    }
    if (!/^#[0-9a-f]{6}$/i.test(request.color)) {
      throw new PdfWatermarkError('Choose a valid watermark color.', 'OPTION_INVALID');
    }
  }

  private resolvePageNumbers(selection: PdfWatermarkRequest['pageSelection'], pageCount: number): number[] {
    return resolveWatermarkPageSelection(selection, pageCount);
  }

  private async embedImage(pdf: PDFDocument, file: File): Promise<PDFImage> {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      throw new PdfWatermarkError('Only PNG, JPEG, or WebP watermark images are supported.', 'IMAGE_INVALID');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new PdfWatermarkError('Watermark images must be 5 MB or smaller.', 'IMAGE_INVALID');
    }

    if (isPlatformBrowser(this.platformId)) {
      const bitmap = await createImageBitmap(file);
      try {
        const pixels = bitmap.width * bitmap.height;
        if (bitmap.width > 8000 || bitmap.height > 8000 || pixels > 12_000_000) {
          throw new PdfWatermarkError('Watermark images must be 8,000 px or smaller and stay within the decoded pixel safety limit.', 'IMAGE_INVALID');
        }
      } finally {
        bitmap.close();
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const lower = file.type.toLowerCase() || file.name.toLowerCase();
    if (lower.includes('jpeg') || /\.jpe?g$/i.test(file.name)) {
      return pdf.embedJpg(bytes);
    }
    if (lower.includes('png') || /\.png$/i.test(file.name)) {
      return pdf.embedPng(bytes);
    }

    // pdf-lib does not natively embed WebP. Convert it locally through an
    // offscreen canvas so the source image never leaves the browser.
    if (!isPlatformBrowser(this.platformId)) {
      throw new PdfWatermarkError('Image conversion is unavailable outside the browser.', 'IMAGE_INVALID');
    }
    const bitmap = await createImageBitmap(file);
    try {
      const maxDimension = 4000;
      const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed.')), 'image/png');
      });
      const converted = new Uint8Array(await blob.arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;
      return pdf.embedPng(converted);
    } finally {
      bitmap.close();
    }
  }

  private drawTextWatermark(page: PDFPage, font: PDFFont, request: PdfWatermarkRequest): void {
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const pageRotation = this.normalizePageRotation(page.getRotation().angle);
    const displayWidth = pageRotation === 90 || pageRotation === 270 ? pageHeight : pageWidth;
    const displayHeight = pageRotation === 90 || pageRotation === 270 ? pageWidth : pageHeight;
    const text = request.text!.trim();
    const size = request.fontSize;
    const textWidth = font.widthOfTextAtSize(text, size);
    const textHeight = font.heightAtSize(size);
    const color = this.hexToRgb(request.color);
    const localRotation = this.displayRotationToPdfRotation(request.rotation, pageRotation);

    const drawTextAtCenter = (displayCenter: WatermarkPoint, drawSize = size): void => {
      const center = this.displayPointToPdfPoint(displayCenter, pageWidth, pageHeight, pageRotation);
      const drawWidth = font.widthOfTextAtSize(text, drawSize);
      const radians = localRotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const halfWidth = drawWidth / 2;
      const ascenderHeight = font.heightAtSize(drawSize, { descender: false });
      const totalTextHeight = font.heightAtSize(drawSize);
      const descenderHeight = Math.max(0, totalTextHeight - ascenderHeight);
      const centerToBaseline = (ascenderHeight - descenderHeight) / 2;
      const origin: WatermarkPoint = {
        x: center.x - (halfWidth * cos - centerToBaseline * sin),
        y: center.y - (halfWidth * sin + centerToBaseline * cos),
      };
      page.drawText(text, {
        x: origin.x,
        y: origin.y,
        size: drawSize,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity: request.opacity,
        rotate: degrees(localRotation),
      });
    };

    if (request.tiled) {
      const repeatScale = watermarkTiledScale(displayWidth, displayHeight, textWidth, textHeight, request.rotation);
      const repeatCenters = watermarkTiledCenters(displayWidth, displayHeight, textWidth * repeatScale, textHeight * repeatScale, 'text', 1, request.rotation);
      for (const center of repeatCenters) drawTextAtCenter(center, size * repeatScale);
      return;
    }

    drawTextAtCenter(this.positionCenter(request.position, displayWidth, displayHeight, textWidth, textHeight, request.rotation));
  }

  private drawImageWatermark(page: PDFPage, image: PDFImage, request: PdfWatermarkRequest): void {
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const pageRotation = this.normalizePageRotation(page.getRotation().angle);
    const displayWidth = pageRotation === 90 || pageRotation === 270 ? pageHeight : pageWidth;
    const displayHeight = pageRotation === 90 || pageRotation === 270 ? pageWidth : pageHeight;
    const requestedWidth = Math.min(displayWidth * (request.imageScalePercent / 100), displayWidth * 0.8);
    const maxHeight = displayHeight * 0.8;
    const width = Math.min(requestedWidth, maxHeight * (image.width / image.height));
    const height = Math.max(1, width * image.height / image.width);
    const alpha = Math.max(0.05, Math.min(1, request.opacity));
    const localRotation = this.displayRotationToPdfRotation(request.rotation, pageRotation);

    const drawScaled = (displayCenter: WatermarkPoint, scale = 1): void => {
      const center = this.displayPointToPdfPoint(displayCenter, pageWidth, pageHeight, pageRotation);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const radians = localRotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const halfWidth = drawWidth / 2;
      const halfHeight = drawHeight / 2;
      const origin: WatermarkPoint = {
        x: center.x - (halfWidth * cos - halfHeight * sin),
        y: center.y - (halfWidth * sin + halfHeight * cos),
      };
      page.drawImage(image, {
        x: origin.x,
        y: origin.y,
        width: drawWidth,
        height: drawHeight,
        opacity: alpha,
        rotate: degrees(localRotation),
      });
    };

    if (request.tiled) {
      const repeatScale = watermarkTiledScale(displayWidth, displayHeight, width, height, request.rotation);
      const repeatCenters = watermarkTiledCenters(displayWidth, displayHeight, width * repeatScale, height * repeatScale, 'image', 1, request.rotation);
      for (const center of repeatCenters) {
        drawScaled(center, repeatScale);
      }
      return;
    }

    drawScaled(this.positionCenter(request.position, displayWidth, displayHeight, width, height, request.rotation));
  }

  private displayPointToPdfPoint(point: WatermarkPoint, pageWidth: number, pageHeight: number, rotation: 0 | 90 | 180 | 270): WatermarkPoint {
    return watermarkDisplayPointToPdfPoint(point, pageWidth, pageHeight, rotation);
  }

  private displayRotationToPdfRotation(
    displayRotation: number,
    pageRotation: 0 | 90 | 180 | 270,
  ): number {
    return watermarkDisplayRotationToPdfRotation(displayRotation, pageRotation);
  }

  private normalizePageRotation(value: number): 0 | 90 | 180 | 270 {
    const normalized = ((value % 360) + 360) % 360;
    if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
    return 0;
  }

  private positionCenter(
    position: PdfWatermarkPosition,
    pageWidth: number,
    pageHeight: number,
    width: number,
    height: number,
    rotation = 0,
  ): WatermarkPoint {
    return watermarkPositionCenter(position, pageWidth, pageHeight, width, height, rotation);
  }

  private standardFont(font: PdfWatermarkFont): StandardFonts {
    switch (font) {
      case 'Times-Roman': return StandardFonts.TimesRoman;
      case 'Courier': return StandardFonts.Courier;
      default: return StandardFonts.Helvetica;
    }
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
    return `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;
  }

  private hexToRgb(value: string): { r: number; g: number; b: number } {
    const parsed = Number.parseInt(value.slice(1), 16);
    return {
      r: ((parsed >> 16) & 255) / 255,
      g: ((parsed >> 8) & 255) / 255,
      b: (parsed & 255) / 255,
    };
  }

  private async validateOutput(file: File, expectedPageCount: number): Promise<void> {
    if (file.size < 32) {
      throw new PdfWatermarkError('The generated watermark PDF is unexpectedly small.', 'OUTPUT_INVALID');
    }
    const header = new TextDecoder().decode(await file.slice(0, 8).arrayBuffer());
    if (!header.startsWith('%PDF-')) {
      throw new PdfWatermarkError('The generated watermark PDF is not a valid PDF.', 'OUTPUT_INVALID');
    }
    const tail = new TextDecoder().decode(await file.slice(Math.max(0, file.size - 64)).arrayBuffer());
    if (!tail.includes('%%EOF')) {
      throw new PdfWatermarkError('The generated watermark PDF is missing its EOF marker.', 'OUTPUT_INVALID');
    }
    try {
      const reopened = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false });
      if (reopened.getPageCount() !== expectedPageCount) {
        throw new PdfWatermarkError('Watermarking changed the PDF page count.', 'OUTPUT_INVALID');
      }
    } catch (error) {
      if (error instanceof PdfWatermarkError) throw error;
      throw new PdfWatermarkError('The generated watermark PDF could not be reopened.', 'OUTPUT_INVALID');
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new PdfWatermarkError('PDF watermarking was cancelled.', 'CANCELLED');
  }

  private async yieldToBrowser(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

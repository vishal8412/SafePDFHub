import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
  if (selection.mode === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);

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

export function watermarkRotatedBounds(
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } {
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
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

  const x = minX <= maxX ? Math.min(maxX, Math.max(minX, targetX)) : pageWidth / 2;
  const y = minY <= maxY ? Math.min(maxY, Math.max(minY, targetY)) : pageHeight / 2;

  return { x, y };
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
  const bounds = watermarkRotatedBounds(width, height, rotation);
  const safeMinimumMargin = Math.max(0, minimumMargin);
  const marginX = Math.max(safeMinimumMargin, pageWidth * 0.06);
  const marginY = Math.max(safeMinimumMargin, pageHeight * 0.06);
  const targetX = position.endsWith('left') ? marginX + bounds.width / 2
    : position.endsWith('right') ? pageWidth - marginX - bounds.width / 2
      : pageWidth / 2;
  const targetY = position.startsWith('top') ? pageHeight - marginY - bounds.height / 2
    : position.startsWith('bottom') ? marginY + bounds.height / 2
      : pageHeight / 2;

  // Position presets are visual anchors. Clamp the center so the rotated
  // watermark's visible bounds remain inside the page whenever the requested
  // size permits it. If the watermark itself is larger than the safe page
  // area, centering is the only deterministic fallback.
  const minX = marginX + bounds.width / 2;
  const maxX = pageWidth - marginX - bounds.width / 2;
  const minY = marginY + bounds.height / 2;
  const maxY = pageHeight - marginY - bounds.height / 2;
  const x = minX <= maxX ? Math.min(maxX, Math.max(minX, targetX)) : pageWidth / 2;
  const y = minY <= maxY ? Math.min(maxY, Math.max(minY, targetY)) : pageHeight / 2;
  return { x, y };
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
  /*
   * Repeat mode has a deterministic four-copy contract:
   *
   *   - always render exactly four copies;
   *   - start from the same four normalized quadrant anchors;
   *   - if a rotated watermark would cross a page edge, move that anchor
   *     inward instead of dropping the copy;
   *   - use this exact geometry in both preview and export.
   *
   * This preserves a stable pattern while preventing large/rotated text such
   * as CONFIDENTIAL from being visually cut in half at the page edges.
   */
  void kind;
  void unitScale;

  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    return [];
  }

  // Repeat mode always renders exactly four copies. The four quadrant anchors
  // remain deterministic, while each center is moved inward only when the
  // rotated watermark bounds would otherwise clip the text/image. If the
  // watermark is physically too large for four non-overlapping copies, we keep
  // the four-copy contract rather than silently dropping or duplicating copies.
  const bounds = watermarkRotatedBounds(width, height, rotation);
  const marginX = Math.max(18, pageWidth * 0.04);
  const marginY = Math.max(18, pageHeight * 0.04);
  const minX = marginX + bounds.width / 2;
  const maxX = pageWidth - marginX - bounds.width / 2;
  const minY = marginY + bounds.height / 2;
  const maxY = pageHeight - marginY - bounds.height / 2;

  const clamp = (value: number, min: number, max: number): number =>
    min <= max ? Math.min(max, Math.max(min, value)) : pageWidth / 2;
  const clampY = (value: number): number =>
    minY <= maxY ? Math.min(maxY, Math.max(minY, value)) : pageHeight / 2;

  const leftX = clamp(pageWidth * 0.25, minX, maxX);
  const rightX = clamp(pageWidth * 0.75, minX, maxX);
  const topY = clampY(pageHeight * 0.75);
  const bottomY = clampY(pageHeight * 0.25);

  return [
    { x: leftX, y: topY },
    { x: rightX, y: topY },
    { x: leftX, y: bottomY },
    { x: rightX, y: bottomY },
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

    const draw = (displayCenter: WatermarkPoint): void => {
      const center = this.displayPointToPdfPoint(displayCenter, pageWidth, pageHeight, pageRotation);
      const radians = localRotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      // pdf-lib rotates text around the draw origin. Solve the inverse
      // transform from the desired visual center back to that origin. Keeping
      // this calculation in one place makes the preview/export contract
      // deterministic for every position and rotation.
      const halfWidth = textWidth / 2;
      // pdf-lib positions text from the baseline, while the browser preview
      // rotates the DOM element around its visual box center. The visual glyph
      // box extends from the font descender to the ascender, so its center is
      // halfway between those two metrics. Using ascender / 2 here shifts the
      // exported watermark noticeably for diagonal text and was the source of
      // a preview-vs-export placement mismatch.
      const ascenderHeight = font.heightAtSize(size, { descender: false });
      const totalTextHeight = font.heightAtSize(size);
      const descenderHeight = Math.max(0, totalTextHeight - ascenderHeight);
      const centerToBaseline = (ascenderHeight - descenderHeight) / 2;
      const origin: WatermarkPoint = {
        x: center.x - (halfWidth * cos - centerToBaseline * sin),
        y: center.y - (halfWidth * sin + centerToBaseline * cos),
      };
      page.drawText(text, {
        x: origin.x,
        y: origin.y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity: request.opacity,
        rotate: degrees(localRotation),
      });
    };

    if (request.tiled) {
      for (const center of watermarkTiledCenters(displayWidth, displayHeight, textWidth, textHeight, 'text', 1, request.rotation)) {
        draw(center);
      }
      return;
    }

    draw(this.positionCenter(request.position, displayWidth, displayHeight, textWidth, textHeight, request.rotation));
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

    const draw = (displayCenter: WatermarkPoint): void => {
      const center = this.displayPointToPdfPoint(displayCenter, pageWidth, pageHeight, pageRotation);
      const radians = localRotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const origin: WatermarkPoint = {
        x: center.x - (halfWidth * cos - halfHeight * sin),
        y: center.y - (halfWidth * sin + halfHeight * cos),
      };
      page.drawImage(image, {
        x: origin.x,
        y: origin.y,
        width,
        height,
        opacity: alpha,
        rotate: degrees(localRotation),
      });
    };

    if (request.tiled) {
      for (const center of watermarkTiledCenters(displayWidth, displayHeight, width, height, 'image', 1, request.rotation)) {
        draw(center);
      }
      return;
    }

    draw(this.positionCenter(request.position, displayWidth, displayHeight, width, height, request.rotation));
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

import {
  Injectable,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import { saveAs } from 'file-saver';

import type { StudioPage } from '../models/studio-page.model';
import type {
  StudioObject,
  StudioTextAlign,
  StudioTextFontStyle,
  StudioTextFontWeight,
  StudioPoint,
} from '../models/studio-selection.model';

/**
 * F1.5 — Text → PDF persistence.
 *
 * PDF.js continues to own PDF viewing/rendering. This service is responsible
 * only for producing the exported PDF using pdf-lib.
 *
 * Studio text object bounds are normalized to the displayed page:
 *   x / y / width / height = 0..1
 * with x/y measured from the displayed top-left corner.
 */
@Injectable({
  providedIn: 'root',
})
export class StudioPdfExportService {
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Build a new PDF from the original uploaded bytes and paint all committed
   * Studio text objects on the matching PDF pages.
   */
  async exportTextObjects(
    sourceFile: File,
    objects: readonly StudioObject[],
    logicalPages?: readonly StudioPage[],
  ): Promise<Blob> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error(
        'PDF export is available only in the browser.',
      );
    }

    const sourceBytes = new Uint8Array(
      await sourceFile.arrayBuffer(),
    );

    const sourcePdf = await PDFDocument.load(sourceBytes);
    const sourcePages = sourcePdf.getPages();
    const pdfDocument = await PDFDocument.create();
    const manifest = logicalPages && logicalPages.length ? logicalPages : sourcePages.map((_, index) => ({ id: `source-${index + 1}`, kind: 'source' as const, sourcePageNumber: index + 1, rotation: 0 as const }));
    for (const logicalPage of manifest) {
      if (logicalPage.kind === 'blank') {
        const page = pdfDocument.addPage([logicalPage.blankWidth ?? 595.28, logicalPage.blankHeight ?? 841.89]);
        page.setRotation(degrees(logicalPage.rotation));
      } else {
        const sourceIndex = (logicalPage.sourcePageNumber ?? 1) - 1;
        if (sourceIndex < 0 || sourceIndex >= sourcePages.length) throw new RangeError('Invalid logical source page.');
        const [copied] = await pdfDocument.copyPages(sourcePdf, [sourceIndex]);
        copied.setRotation(degrees((copied.getRotation().angle + logicalPage.rotation) % 360));
        pdfDocument.addPage(copied);
      }
    }
    const pages = pdfDocument.getPages();
    const fontCache = new Map<
      string,
      PDFFont
    >();

    // F7.2: Studio comments are review metadata. They remain in Studio state
    // and history but are not flattened into visible PDF content. This avoids
    // silently converting private review notes into document artwork.
    const editableObjects =
      objects.filter(
        object =>
          (
            object.type === 'text' &&
            (object.text ?? '').trim().length > 0
          ) ||
          (
            object.type === 'image' &&
            Boolean(object.image?.dataUrl)
          ) ||
          (
            object.type === 'shape' &&
            Boolean(object.shape)
          ) ||
          (
            (
              object.type === 'draw' ||
              object.type === 'highlight'
            ) &&
            Boolean(
              object.drawing?.points?.length
            )
          ),
      );

    /**
     * Fast path:
     * If there are no committed Studio text changes, don't parse and rewrite
     * a potentially very large PDF. Returning the original bytes avoids an
     * unnecessary full-document PDF-lib load/save cycle.
     */
    if (editableObjects.length === 0 && !logicalPages) {
      return new Blob(
        [sourceBytes.buffer.slice(
          sourceBytes.byteOffset,
          sourceBytes.byteOffset + sourceBytes.byteLength,
        )],
        { type: 'application/pdf' },
      );
    }

    for (const object of editableObjects) {
      const pageIndex = object.pageNumber - 1;

      if (
        pageIndex < 0 ||
        pageIndex >= pages.length
      ) {
        continue;
      }

      const page = pages[pageIndex];
      const rotation = this.normalizeRotation(
        page.getRotation().angle,
      );

      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const displayWidth =
        rotation === 90 || rotation === 270
          ? pageHeight
          : pageWidth;

      const displayHeight =
        rotation === 90 || rotation === 270
          ? pageWidth
          : pageHeight;

      if (
        object.type === 'shape' &&
        object.shape
      ) {
        this.drawShapeObject(
          page,
          object,
          displayWidth,
          displayHeight,
          rotation
        );

        continue;
      }

      if (
        (
          object.type === 'draw' ||
          object.type === 'highlight'
        ) &&
        object.drawing
      ) {
        this.drawDrawingObject(
          page,
          object,
          displayWidth,
          displayHeight,
          rotation
        );

        continue;
      }

      if (
        object.type === 'image' &&
        object.image
      ) {

        const embeddedImage =
          object.image.mimeType === 'image/png'
            ? await pdfDocument.embedPng(
                this.dataUrlToUint8Array(
                  object.image.dataUrl
                )
              )
            : await pdfDocument.embedJpg(
                this.dataUrlToUint8Array(
                  object.image.dataUrl
                )
              );

        this.drawImageObject(
          page,
          object,
          embeddedImage,
          displayWidth,
          displayHeight,
          rotation
        );

        continue;
      }

      const style = object.textStyle;

      const fontSize =
        this.resolveFontSize(
          style?.fontSize ?? 0.018,
          displayHeight,
        );

      const font =
        await this.getFont(
          pdfDocument,
          style?.fontWeight ?? 400,
          style?.fontStyle ?? 'normal',
          fontCache,
        );

      const boxWidth = Math.max(
        1,
        object.bounds.width * displayWidth,
      );

      const lines = this.wrapText(
        object.text ?? '',
        font,
        fontSize,
        boxWidth,
      );

      const lineHeight =
        fontSize * 1.2;

      const boxHeight = Math.max(
        1,
        object.bounds.height * displayHeight,
      );

      const maxLines = Math.max(
        1,
        Math.floor(
          (boxHeight + fontSize * 0.15) /
            lineHeight,
        ),
      );

      this.drawObject(
        page,
        object,
        lines.slice(0, maxLines),
        font,
        fontSize,
        lineHeight,
        displayWidth,
        displayHeight,
        rotation,
      );
    }

    const bytes = await pdfDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    // Copy into a concrete ArrayBuffer so DOM BlobPart typing stays stable
    // across TypeScript/lib.dom versions.
    const outputBuffer =
      new ArrayBuffer(bytes.byteLength);

    new Uint8Array(outputBuffer).set(bytes);

    return new Blob(
      [outputBuffer],
      { type: 'application/pdf' },
    );
  }

  /**
   * Build and download the edited PDF.
   */
  async exportAndDownload(
    sourceFile: File,
    objects: readonly StudioObject[],
    logicalPages?: readonly StudioPage[],
  ): Promise<void> {
    const blob =
      await this.exportTextObjects(
        sourceFile,
        objects,
        logicalPages,
      );

    saveAs(
      blob,
      this.createEditedFileName(
        sourceFile.name,
      ),
    );
  }

  /**
   * F7.1.2 — Extract one or more logical Studio pages and download them as a
   * standalone PDF.
   *
   * The supplied logical page order is preserved exactly. This supports ranges,
   * reordered pages, duplicated pages, page rotation, and Studio-created blank
   * pages because exportTextObjects already rebuilds the output from the logical
   * page manifest.
   *
   * Objects must use output-local page numbers (1..N). StudioFacade performs
   * that remapping before calling this method so an object on logical page 20
   * can correctly be painted onto page 1, 2, etc. of an extracted PDF.
   */
  async extractPagesAndDownload(
    sourceFile: File,
    objects: readonly StudioObject[],
    logicalPages: readonly StudioPage[],
    outputFileName: string
  ): Promise<void> {
    if (logicalPages.length === 0) {
      throw new Error(
        'Select at least one page to extract.'
      );
    }

    const blob =
      await this.exportTextObjects(
        sourceFile,
        objects,
        logicalPages
      );

    saveAs(
      blob,
      outputFileName
    );
  }

  /**
   * Backwards-compatible single-page wrapper.
   *
   * Keep this method for any existing caller while routing it through the same
   * F7.1.2 multi-page pipeline.
   */
  async extractAndDownload(
    sourceFile: File,
    objects: readonly StudioObject[],
    logicalPage: StudioPage,
    outputFileName: string
  ): Promise<void> {
    const outputObjects =
      objects.map(
        object => ({
          ...object,
          pageNumber: 1
        })
      );

    await this.extractPagesAndDownload(
      sourceFile,
      outputObjects,
      [ logicalPage ],
      outputFileName
    );
  }

  private dataUrlToUint8Array(
    dataUrl: string
  ): Uint8Array {

    const comma =
      dataUrl.indexOf(',');

    if (comma < 0) {
      throw new Error(
        'Invalid image data.'
      );
    }

    const binary =
      atob(
        dataUrl.slice(
          comma + 1
        )
      );

    const bytes =
      new Uint8Array(
        binary.length
      );

    for (
      let index = 0;
      index < binary.length;
      index++
    ) {
      bytes[index] =
        binary.charCodeAt(index);
    }

    return bytes;
  }


  private drawShapeObject(
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {

    const shape = object.shape;

    if (!shape) {
      return;
    }

    const x =
      object.bounds.x * displayWidth;

    const y =
      object.bounds.y * displayHeight;

    const width =
      object.bounds.width * displayWidth;

    const height =
      object.bounds.height * displayHeight;

    const centerDisplayX =
      x + width / 2;

    const centerDisplayY =
      y + height / 2;

    const center =
      this.displayToPdfPoint(
        centerDisplayX,
        centerDisplayY,
        displayWidth,
        displayHeight,
        rotation
      );

    const style = shape.style;

    const strokeRgb =
      this.hexToRgb(style.strokeColor);

    const fillRgb =
      style.fillColor
        ? this.hexToRgb(style.fillColor)
        : null;

    const strokeWidth =
      Math.max(
        0.05,
        Math.min(
          64,
          style.strokeWidth * displayHeight
        )
      );

    const color =
      rgb(
        strokeRgb.r,
        strokeRgb.g,
        strokeRgb.b
      );

    const fillColor =
      fillRgb
        ? rgb(
            fillRgb.r,
            fillRgb.g,
            fillRgb.b
          )
        : undefined;

    const compensation =
      this.shapeCompensationRotation(
        rotation
      );

    const pdfWidth =
      rotation === 90 || rotation === 270
        ? height
        : width;

    const pdfHeight =
      rotation === 90 || rotation === 270
        ? width
        : height;

    if (shape.kind === 'ellipse') {
      page.drawEllipse({
        x: center.x,
        y: center.y,
        xScale: pdfWidth / 2,
        yScale: pdfHeight / 2,
        borderColor: color,
        borderWidth: strokeWidth,
        borderOpacity: style.opacity,
        color: fillColor,
        opacity: fillColor
          ? style.opacity * 0.28
          : 0,
        rotate: degrees(compensation)
      });

      return;
    }

    if (
      shape.kind === 'line' ||
      shape.kind === 'arrow'
    ) {
      const endpoints =
        shape.points && shape.points.length >= 2
          ? shape.points
          : [
              {
                x:
                  object.bounds.x +
                  object.bounds.width * 0.05,
                y:
                  object.bounds.y +
                  object.bounds.height * 0.5
              },
              {
                x:
                  object.bounds.x +
                  object.bounds.width * 0.95,
                y:
                  object.bounds.y +
                  object.bounds.height * 0.5
              }
            ];

      const start = this.displayToPdfPoint(
        endpoints[0].x * displayWidth,
        endpoints[0].y * displayHeight,
        displayWidth,
        displayHeight,
        rotation
      );

      const end = this.displayToPdfPoint(
        endpoints[1].x * displayWidth,
        endpoints[1].y * displayHeight,
        displayWidth,
        displayHeight,
        rotation
      );

      this.drawPdfLine(
        page,
        start.x,
        start.y,
        end.x,
        end.y,
        color,
        strokeWidth,
        style.opacity
      );

      if (shape.kind === 'arrow') {
        const angle =
          Math.atan2(
            end.y - start.y,
            end.x - start.x
          );

        const lineLength =
          Math.hypot(
            end.x - start.x,
            end.y - start.y
          );

        const headLength =
          Math.min(
            24,
            Math.max(
              2,
              Math.min(
                strokeWidth * 2.8,
                lineLength * 0.28
              )
            )
          );

        const headAngle =
          Math.PI / 7;

        const left = {
          x:
            end.x -
            headLength *
              Math.cos(angle - headAngle),
          y:
            end.y -
            headLength *
              Math.sin(angle - headAngle)
        };

        const right = {
          x:
            end.x -
            headLength *
              Math.cos(angle + headAngle),
          y:
            end.y -
            headLength *
              Math.sin(angle + headAngle)
        };

        this.drawPdfLine(
          page,
          end.x,
          end.y,
          left.x,
          left.y,
          color,
          strokeWidth,
          style.opacity
        );

        this.drawPdfLine(
          page,
          end.x,
          end.y,
          right.x,
          right.y,
          color,
          strokeWidth,
          style.opacity
        );
      }

      return;
    }

    page.drawRectangle({
      x: center.x - pdfWidth / 2,
      y: center.y - pdfHeight / 2,
      width: pdfWidth,
      height: pdfHeight,
      borderColor: color,
      borderWidth: strokeWidth,
      borderOpacity: style.opacity,
      color: fillColor,
      opacity: fillColor
        ? style.opacity * 0.28
        : 0,
      rotate: degrees(compensation)
    });
  }

  private drawDrawingObject(
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {

    const drawing =
      object.drawing;

    if (
      !drawing ||
      drawing.points.length < 2
    ) {
      return;
    }

    const color =
      this.hexToRgb(
        drawing.style.strokeColor
      );

    const stroke =
      rgb(
        color.r,
        color.g,
        color.b
      );

    const strokeWidth =
      Math.max(
        0.05,
        Math.min(
          64,
          drawing.style.strokeWidth * displayHeight
        )
      );

    for (
      let index = 1;
      index < drawing.points.length;
      index++
    ) {

      const from =
        drawing.points[index - 1];

      const to =
        drawing.points[index];

      const start =
        this.displayToPdfPoint(
          from.x * displayWidth,
          from.y * displayHeight,
          displayWidth,
          displayHeight,
          rotation
        );

      const end =
        this.displayToPdfPoint(
          to.x * displayWidth,
          to.y * displayHeight,
          displayWidth,
          displayHeight,
          rotation
        );

      this.drawPdfLine(
        page,
        start.x,
        start.y,
        end.x,
        end.y,
        stroke,
        strokeWidth,
        drawing.style.opacity
      );
    }
  }

  private drawPdfLine(
    page: PDFPage,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: ReturnType<typeof rgb>,
    thickness: number,
    opacity: number
  ): void {

    page.drawLine({
      start: {
        x: x1,
        y: y1
      },
      end: {
        x: x2,
        y: y2
      },
      color,
      thickness,
      opacity,
      lineCap: 1
    });
  }

  private hexToRgb(
    hex: string
  ): {
    r: number;
    g: number;
    b: number;
  } {
    const normalized =
      /^#[0-9a-f]{6}$/i.test(hex)
        ? hex.slice(1)
        : '00d4b3';

    return {
      r:
        parseInt(
          normalized.slice(0, 2),
          16
        ) / 255,
      g:
        parseInt(
          normalized.slice(2, 4),
          16
        ) / 255,
      b:
        parseInt(
          normalized.slice(4, 6),
          16
        ) / 255
    };
  }

  private shapeCompensationRotation(
    rotation: 0 | 90 | 180 | 270
  ): number {
    switch (rotation) {
      case 90:
        return -90;
      case 180:
        return -180;
      case 270:
        return -270;
      default:
        return 0;
    }
  }

  private drawImageObject(
    page: PDFPage,
    object: StudioObject,
    image: any,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {

    const boxX =
      object.bounds.x *
      displayWidth;

    const boxY =
      object.bounds.y *
      displayHeight;

    const boxWidth =
      object.bounds.width *
      displayWidth;

    const boxHeight =
      object.bounds.height *
      displayHeight;

    const displayBottom =
      displayHeight -
      boxY -
      boxHeight;

    switch (rotation) {

      case 90:
        page.drawImage(
          image,
          {
            x: boxX,
            y: displayBottom + boxHeight,
            width: boxHeight,
            height: boxWidth,
            rotate: degrees(-90)
          }
        );
        return;

      case 180:
        page.drawImage(
          image,
          {
            x:
              displayWidth -
              (boxX + boxWidth),
            y:
              boxY + boxHeight,
            width: boxWidth,
            height: boxHeight,
            rotate: degrees(-180)
          }
        );
        return;

      case 270:
        page.drawImage(
          image,
          {
            x:
              boxX + boxWidth,
            y:
              displayBottom,
            width: boxHeight,
            height: boxWidth,
            rotate: degrees(90)
          }
        );
        return;

      case 0:
      default:
        page.drawImage(
          image,
          {
            x: boxX,
            y: displayBottom,
            width: boxWidth,
            height: boxHeight
          }
        );
    }
  }

  private async getFont(
    pdfDocument: PDFDocument,
    fontWeight: StudioTextFontWeight,
    fontStyle: StudioTextFontStyle,
    cache: Map<string, PDFFont>,
  ): Promise<PDFFont> {
    const key =
      `${fontWeight}-${fontStyle}`;

    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    let standardFont =
      StandardFonts.Helvetica;

    if (
      fontWeight === 700 &&
      fontStyle === 'italic'
    ) {
      standardFont =
        StandardFonts.HelveticaBoldOblique;
    } else if (fontWeight === 700) {
      standardFont =
        StandardFonts.HelveticaBold;
    } else if (fontStyle === 'italic') {
      standardFont =
        StandardFonts.HelveticaOblique;
    }

    const embedded =
      await pdfDocument.embedFont(
        standardFont,
      );

    cache.set(key, embedded);

    return embedded;
  }

  private drawObject(
    page: PDFPage,
    object: StudioObject,
    lines: readonly string[],
    font: PDFFont,
    fontSize: number,
    lineHeight: number,
    displayWidth: number,
    displayHeight: number,
    rotation: number,
  ): void {
    const boxX =
      object.bounds.x * displayWidth;

    const boxY =
      object.bounds.y * displayHeight;

    const boxWidth =
      object.bounds.width * displayWidth;

    for (
      let index = 0;
      index < lines.length;
      index++
    ) {
      const line = lines[index];

      const lineWidth =
        font.widthOfTextAtSize(
          line,
          fontSize,
        );

      const alignedX =
        this.alignX(
          boxX,
          boxWidth,
          lineWidth,
          object.textStyle?.textAlign ?? 'left',
        );

      /**
       * Studio stores Y from the displayed page's TOP edge.
       * pdf-lib expects the text baseline from the page's BOTTOM edge.
       *
       * First compute the baseline from the Studio top edge, then let
       * displayToPdfPoint() perform the single top-to-bottom conversion.
       *
       * The previous implementation inverted Y twice, which caused
       * exported text to appear vertically mirrored near the bottom.
       */
      const displayBaselineY =
        boxY +
        fontSize +
        index * lineHeight;

      const point =
        this.displayToPdfPoint(
          alignedX,
          displayBaselineY,
          displayWidth,
          displayHeight,
          rotation,
        );

      page.drawText(
        line,
        {
          x: point.x,
          y: point.y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          rotate: degrees(
            this.textCompensationRotation(
              rotation,
            ),
          ),
        },
      );
    }
  }

  /**
   * Convert displayed page coordinates into the PDF page's bottom-left
   * coordinate system. The formulas also account for page rotation.
   */
  private displayToPdfPoint(
    displayX: number,
    displayBaselineFromTop: number,
    displayWidth: number,
    displayHeight: number,
    rotation: number,
  ): { x: number; y: number } {
    const pdfYFromBottom =
      displayHeight - displayBaselineFromTop;

    switch (rotation) {
      case 90:
        return {
          x: displayHeight - pdfYFromBottom,
          y: displayX,
        };

      case 180:
        return {
          x: displayWidth - displayX,
          y: displayHeight - pdfYFromBottom,
        };

      case 270:
        return {
          x: pdfYFromBottom,
          y: displayWidth - displayX,
        };

      case 0:
      default:
        return {
          x: displayX,
          y: pdfYFromBottom,
        };
    }
  }

  private textCompensationRotation(
    rotation: number,
  ): number {
    switch (rotation) {
      case 90:
        return -90;
      case 180:
        return -180;
      case 270:
        return -270;
      default:
        return 0;
    }
  }

  private alignX(
    x: number,
    width: number,
    textWidth: number,
    align: StudioTextAlign,
  ): number {
    switch (align) {
      case 'center':
        return (
          x +
          Math.max(
            0,
            (width - textWidth) / 2,
          )
        );

      case 'right':
        return (
          x +
          Math.max(
            0,
            width - textWidth,
          )
        );

      case 'left':
      default:
        return x;
    }
  }

  /**
   * Wrap long text to the Studio object's width while preserving explicit
   * newlines entered by the user.
   */
  private wrapText(
    text: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
  ): string[] {
    const sourceLines =
      text
        .replace(/\r\n/g, '\n')
        .split('\n');

    const result: string[] = [];

    for (const sourceLine of sourceLines) {
      if (sourceLine.length === 0) {
        result.push('');
        continue;
      }

      const words = sourceLine.split(/\s+/);
      let current = '';

      for (const word of words) {
        const candidate = current
          ? `${current} ${word}`
          : word;

        if (
          current &&
          font.widthOfTextAtSize(
            candidate,
            fontSize,
          ) > maxWidth
        ) {
          result.push(current);
          current = word;
          continue;
        }

        if (
          !current &&
          font.widthOfTextAtSize(
            word,
            fontSize,
          ) > maxWidth
        ) {
          const chunks =
            this.breakLongWord(
              word,
              font,
              fontSize,
              maxWidth,
            );

          if (chunks.length > 1) {
            result.push(
              ...chunks.slice(0, -1),
            );
            current =
              chunks[chunks.length - 1];
          } else {
            current = word;
          }

          continue;
        }

        current = candidate;
      }

      result.push(current);
    }

    return result.length
      ? result
      : [''];
  }

  private breakLongWord(
    word: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
  ): string[] {
    const parts: string[] = [];
    let current = '';

    for (const character of word) {
      const candidate =
        `${current}${character}`;

      if (
        current &&
        font.widthOfTextAtSize(
          candidate,
          fontSize,
        ) > maxWidth
      ) {
        parts.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts.length
      ? parts
      : [''];
  }

  /**
   * Studio stores text size as a fraction of the displayed page height.
   * Convert that ratio back to PDF points during export.
   */
  private resolveFontSize(
    normalizedRatio: number,
    displayPageHeight: number,
  ): number {
    const safeRatio =
      Number.isFinite(normalizedRatio)
        ? Math.max(
            0.006,
            Math.min(0.12, normalizedRatio),
          )
        : 0.018;

    return Math.max(
      4,
      Math.min(
        72,
        safeRatio * displayPageHeight,
      ),
    );
  }

  private normalizeRotation(
    angle: number,
  ): 0 | 90 | 180 | 270 {
    const normalized =
      ((Math.round(angle) % 360) + 360) % 360;

    if (normalized === 90) {
      return 90;
    }

    if (normalized === 180) {
      return 180;
    }

    if (normalized === 270) {
      return 270;
    }

    return 0;
  }

  private createEditedFileName(
    name: string,
  ): string {
    const trimmed =
      name.trim() || 'document.pdf';

    const lower =
      trimmed.toLowerCase();

    if (lower.endsWith('.pdf')) {
      return (
        `${trimmed.slice(0, -4)}_edited.pdf`
      );
    }

    return `${trimmed}_edited.pdf`;
  }
}

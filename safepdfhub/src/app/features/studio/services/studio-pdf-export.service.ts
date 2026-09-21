import {
  Injectable,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
  PDFArray,
  PDFName,
  PDFString,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from 'pdf-lib';
import { saveAs } from 'file-saver';
import fontkit from '@pdf-lib/fontkit';
import { QpdfWasmPrototypeService } from '../../../core/qpdf/qpdf-wasm-prototype.service';
import { SigningStateService } from '../../../core/signing/services/signing-state.service';

import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

import type { StudioPage } from '../models/studio-page.model';
import type {
  StudioObject,
  StudioPdfTextSource,
  StudioTextAlign,
  StudioTextFontStyle,
  StudioTextFontWeight,
  StudioTextFontFamily,
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
  private readonly qpdf = inject(QpdfWasmPrototypeService);
  private readonly signingState = inject(SigningStateService);

  /**
   * Build a new PDF from the original uploaded bytes and paint all committed
   * Studio text objects on the matching PDF pages.
   *
   * Signature-only exports are handled by a qpdf overlay fast path below. This
   * preserves the original page/resource streams and avoids pdf-lib duplicating
   * shared page resources across hundreds of pages.
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

    if (this.canUseSigningOverlay(objects, logicalPages)) {
      try {
        return await this.exportSigningOverlay(sourceFile, objects);
      } catch {
        // qpdf overlay is an optimization path. If the browser qpdf runtime is
        // unavailable, fall back to the existing pdf-lib exporter below so the
        // export remains functional.
      }
    }

    const sourceBytes = new Uint8Array(
      await sourceFile.arrayBuffer(),
    );

    const sourcePdf = await PDFDocument.load(sourceBytes);
    const sourcePages = sourcePdf.getPages();
    const pdfDocument = await PDFDocument.create();

    /*
     * Existing PDF text must be allowed to reuse the actual source font.
     * StandardFonts are only a fallback; substituting Helvetica/Times/Courier
     * changes glyph shape, metrics and therefore the visual result.
     */
    pdfDocument.registerFontkit(fontkit);
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
    const fontCache = new Map<string, PDFFont>();
    const signingImageCache = new Map<string, PDFImage>();

    // F7.2: Studio comments are review metadata. They remain in Studio state
    // and history but are not flattened into visible PDF content. This avoids
    // silently converting private review notes into document artwork.
    const editableObjects =
      objects.filter(
        object =>
          (
            object.type === 'text' &&
            (object.pdfText
              ? object.pdfText.edited
              : (object.text ?? '').trim().length > 0)
          ) ||
          (
            object.type === 'image' &&
            Boolean(object.image?.dataUrl) &&
            (
              // Existing PDF images already live on the copied source page.
              // They must NOT be flattened again merely because the analyser
              // created an editable image object for hit-testing. Repainting
              // an unchanged source image from normalized Studio bounds can
              // resize/reposition it and can reveal PDF content that was
              // originally underneath it (for example the paragraphs behind
              // the chart in the test document). Only a deliberate replacement
              // should cause us to cover and repaint an existing PDF image.
              object.pdfImage?.replaced === true ||
              !object.pdfImage
            )
          ) ||
          (
            object.type === 'shape' &&
            Boolean(object.shape)
          ) ||
          (
            object.type === 'link' &&
            Boolean(object.link)
          ) ||
          (
            object.type === 'signature' &&
            Boolean(object.signing)
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

    /*
     * Resolve embedded PDF font programs only for edited existing-PDF text.
     * The normal PDF.js viewer instance intentionally does not retain raw font
     * bytes forever. Export creates a short-lived PDF.js document with
     * fontExtraProperties enabled, extracts only the font programs actually
     * needed by edited text, and immediately destroys that helper document.
     */
    const sourceFontBytes =
      await this.collectSourceFontBytes(
        sourceBytes,
        editableObjects,
        manifest,
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

      if (object.type === 'signature' && object.signing) {
        const signingAsset = this.resolveSigningAsset(object);
        if (signingAsset) {
          const asset = signingAsset;
          let image = signingImageCache.get(asset.id);
          if (!image) {
            image = asset.mimeType === 'image/jpeg'
              ? await pdfDocument.embedJpg(this.dataUrlToUint8Array(asset.dataUrl))
              : await pdfDocument.embedPng(this.dataUrlToUint8Array(asset.dataUrl));
            signingImageCache.set(asset.id, image);
          }
          this.drawImageAcrossObjectBounds(page, object, image, displayWidth, displayHeight, rotation);
          continue;
        }

        const signingBox = this.studioDisplayBox(object, displayWidth, displayHeight, rotation);
        if (object.signing.kind === 'checkbox') {
          this.drawStudioCheckbox(page, signingBox, object.signing.checked ?? true, object.signing.color ?? '#0b6c5f', object.signing.opacity);
        } else {
          const text = object.signing.value ?? (object.signing.kind === 'date' ? new Date().toLocaleDateString('en-GB') : '');
          if (text) {
            const png = await this.renderStudioSigningText(text, object.signing, signingBox);
            const image = await pdfDocument.embedPng(png);
            page.drawImage(image, { x: signingBox.x, y: signingBox.y, width: signingBox.width, height: signingBox.height });
          }
        }
        continue;
      }

      if (object.type === 'link' && object.link) {
        this.addLinkAnnotation(
          pdfDocument,
          page,
          object,
          displayWidth,
          displayHeight,
          rotation,
          pages
        );
        continue;
      }

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

        if (object.pdfImage?.replaced) {
          await this.coverExistingPdfImage(
            pdfDocument, page, object, displayWidth, displayHeight, rotation
          );
        }

        // Phase 5C.4 — every existing-image replacement is clipped to the exact
        // detected source region. This protects neighbouring original PDF artwork
        // for fit, fill and stretch modes, not only fill mode.
        const requiresClip = object.pdfImage?.replaced === true;

        if (requiresClip) {
          this.pushImageReplacementClip(
            page,
            object,
            displayWidth,
            displayHeight,
            rotation
          );
        }

        try {
          this.drawImageObject(
            page,
            object,
            embeddedImage,
            displayWidth,
            displayHeight,
            rotation
          );
          // Phase 5C.6 — the second reconstruction layer is transparent and is
          // painted only after the replacement, softening the interior seam while
          // remaining inside the same protected source clip.
          await this.drawPdfImageSeamBlend(
            pdfDocument, page, object, displayWidth, displayHeight, rotation
          );
        } finally {
          if (requiresClip) {
            page.pushOperators(popGraphicsState());
          }
        }

        continue;
      }

      const style = object.textStyle;
      const sourceText = object.pdfText;

      // Phase 2: existing PDF text uses the captured PDF-space font size directly.
      // Never derive source typography from Studio normalized size or displayed
      // page height; both can change with zoom and page rotation.
      const fontSize =
        this.resolveSourceFontSize(
          sourceText,
          style?.fontSize ?? 0.018,
          displayHeight,
        );

      const sourceFontKey =
        object.type === 'text' && sourceText?.edited
          ? this.getSourceFontKey(object, manifest)
          : null;

      const sourceFontBytesForObject =
        sourceFontKey
          ? sourceFontBytes.get(sourceFontKey) ?? null
          : null;

      const font =
        await this.getFont(
          pdfDocument,
          sourceText?.sourceFontWeight ?? style?.fontWeight ?? 400,
          sourceText?.sourceFontStyle ?? style?.fontStyle ?? 'normal',
          this.resolvePdfTextExportFamily(sourceText?.sourceFontFamily ?? sourceText?.fontName, style?.fontFamily ?? 'Helvetica'),
          fontCache,
          sourceFontBytesForObject,
          object.text ?? '',
        );

        const sourceBoxWidth =
        object.type === 'text' && object.pdfText?.edited &&
        typeof object.pdfText.textWidthPdf === 'number' &&
        Number.isFinite(object.pdfText.textWidthPdf) &&
        object.pdfText.textWidthPdf > 0
          ? object.pdfText.textWidthPdf
          : null;
      const boxWidth = Math.max(
        1,
        sourceBoxWidth ?? object.bounds.width * displayWidth,
      );

      const sourceBoxHeight =
        object.type === 'text' && object.pdfText?.edited &&
        typeof object.pdfText.textHeightPdf === 'number' &&
        Number.isFinite(object.pdfText.textHeightPdf) &&
        object.pdfText.textHeightPdf > 0
          ? object.pdfText.textHeightPdf
          : null;
      const boxHeight = Math.max(1, sourceBoxHeight ?? object.bounds.height * displayHeight);
      const fit = this.resolveTextFit(
        object, font, fontSize, boxWidth, boxHeight, displayHeight
      );

      if (object.type === 'text' && object.pdfText?.edited) {
        /*
         * Existing PDF text already lives on the copied page. For a normal
         * single-line edit, cover only the original glyph range that changed
         * and draw only the replacement. Untouched source glyphs therefore
         * remain byte-for-byte on the copied page instead of being painted a
         * second time with pdf-lib.
         */
        if (
          fit.lines.length === 1 &&
          this.canUsePartialSourceTextReplacement(object)
        ) {
          this.coverEditedPdfTextChange(
            page,
            object,
            font,
            fit.fontSize,
          );
        } else {
          this.coverExistingPdfText(
            page,
            object,
            displayWidth,
            displayHeight,
            rotation
          );
        }
      }

      this.drawObject(
        page,
        object,
        fit.lines,
        font,
        fit.fontSize,
        fit.lineHeight,
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

    const generated = new Blob(
      [outputBuffer],
      { type: 'application/pdf' },
    );

    // pdf-lib has to reconstruct a document when Studio edits it. On large
    // PDFs that reconstruction can temporarily inflate compressed streams and
    // object overhead dramatically. Run a browser-local qpdf recompression
    // pass only when the generated file is materially larger than the source.
    // If qpdf fails, the already-valid pdf-lib output remains the fallback.
    const inflationThreshold = Math.max(1.10, sourceBytes.byteLength > 0 ? 1.10 : 1.10);
    if (generated.size > sourceBytes.byteLength * inflationThreshold && generated.size > 2 * 1024 * 1024) {
      try {
        const candidate = await this.qpdf.optimize(
          new File([generated], 'studio-export.pdf', { type: 'application/pdf' }),
        );
        if (candidate.size > 0 && candidate.size < generated.size) {
          return new Blob([new Uint8Array(await candidate.arrayBuffer())], { type: 'application/pdf' });
        }
      } catch {
        // Keep the valid pdf-lib output when optimization is unavailable or fails.
      }
    }

    return generated;
  }


  /**
   * A signing-only Studio export can be represented as a lightweight overlay
   * over the untouched source PDF. This is critical for large/image-heavy PDFs:
   * pdf-lib's copyPages can duplicate shared page resources when rebuilding a
   * large document, while qpdf can overlay new page content on the original.
   */
  private canUseSigningOverlay(
    objects: readonly StudioObject[],
    logicalPages?: readonly StudioPage[],
  ): boolean {
    if (!objects.length || !objects.every(object => object.type === 'signature' && Boolean(object.signing))) {
      return false;
    }

    if (!logicalPages || logicalPages.length === 0) {
      return true;
    }

    return logicalPages.every((page, index) =>
      page.kind === 'source' &&
      page.sourcePageNumber === index + 1 &&
      page.rotation === 0
    );
  }

  private async exportSigningOverlay(
    sourceFile: File,
    objects: readonly StudioObject[],
  ): Promise<Blob> {
    const sourcePdf = await PDFDocument.load(
      new Uint8Array(await sourceFile.arrayBuffer())
    );
    const overlayPdf = await PDFDocument.create();
    const sourcePages = sourcePdf.getPages();
    const overlayPages: PDFPage[] = [];
    const imageCache = new Map<string, PDFImage>();

    for (const sourcePage of sourcePages) {
      const overlayPage = overlayPdf.addPage([
        sourcePage.getWidth(),
        sourcePage.getHeight(),
      ]);
      overlayPage.setRotation(sourcePage.getRotation());
      overlayPages.push(overlayPage);
    }

    for (const object of objects) {
      if (object.type !== 'signature' || !object.signing) continue;

      const pageIndex = object.pageNumber - 1;
      const page = overlayPages[pageIndex];
      const sourcePage = sourcePages[pageIndex];
      if (!page || !sourcePage) continue;

      const rotation = this.normalizeRotation(sourcePage.getRotation().angle);
      const displayWidth = rotation === 90 || rotation === 270
        ? sourcePage.getHeight()
        : sourcePage.getWidth();
      const displayHeight = rotation === 90 || rotation === 270
        ? sourcePage.getWidth()
        : sourcePage.getHeight();

      const signingAsset = this.resolveSigningAsset(object);
      if (signingAsset) {
        const asset = signingAsset;
        let image = imageCache.get(asset.id);
        if (!image) {
          image = asset.mimeType === 'image/jpeg'
            ? await overlayPdf.embedJpg(this.dataUrlToUint8Array(asset.dataUrl))
            : await overlayPdf.embedPng(this.dataUrlToUint8Array(asset.dataUrl));
          imageCache.set(asset.id, image);
        }
        this.drawImageAcrossObjectBounds(
          page,
          object,
          image,
          displayWidth,
          displayHeight,
          rotation
        );
        continue;
      }

      const signingBox = this.studioDisplayBox(
        object,
        displayWidth,
        displayHeight,
        rotation
      );

      if (object.signing.kind === 'checkbox') {
        this.drawStudioCheckbox(
          page,
          signingBox,
          object.signing.checked ?? true,
          object.signing.color ?? '#0b6c5f',
          object.signing.opacity
        );
      } else {
        const text = object.signing.value ??
          (object.signing.kind === 'date'
            ? new Date().toLocaleDateString('en-GB')
            : '');

        if (text) {
          const png = await this.renderStudioSigningText(
            text,
            object.signing,
            signingBox
          );
          const image = await overlayPdf.embedPng(png);
          page.drawImage(image, {
            x: signingBox.x,
            y: signingBox.y,
            width: signingBox.width,
            height: signingBox.height,
            opacity: Math.max(.05, Math.min(1, object.signing.opacity ?? 1)),
          });
        }
      }
    }

    const overlayBytes = await overlayPdf.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });
    const overlayBuffer = new ArrayBuffer(overlayBytes.byteLength);
    new Uint8Array(overlayBuffer).set(overlayBytes);
    const overlayFile = new File(
      [overlayBuffer],
      'studio-signing-overlay.pdf',
      { type: 'application/pdf' }
    );

    const output = await this.qpdf.overlay(
      sourceFile,
      overlayFile,
    );

    return new Blob(
      [new Uint8Array(await output.arrayBuffer())],
      { type: 'application/pdf' }
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

  /**
   * Phase 5B — cover the original extracted text region before drawing the
   * replacement. This keeps the exported PDF from showing old and new text
   * together while preserving the rest of the original page artwork.
   */
  private coverExistingPdfText(
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {
    const source = object.pdfText;
    if (!source) return;

    // Existing PDF text must be covered in the same PDF-space geometry in
    // which PDF.js found it. Normalized Studio bounds are presentation state
    // and can be affected by zoom, page rotation, or later editor changes.
    const [a, b, c, d, e, f] = source.transform;
    const axisX = Math.hypot(a, b) || 1;
    const axisY = Math.hypot(c, d) || 1;
    const ux = a / axisX;
    const uy = b / axisX;
    const vx = c / axisY;
    const vy = d / axisY;
    const width = Math.max(0, source.textWidthPdf ?? 0);
    // fontSizePdf is optional for backward-compatible StudioPdfTextSource
    // objects. Resolve it once before using it in fallback metric calculations
    // so strict TypeScript does not treat the property as possibly undefined.
    const fontSizePdf = typeof source.fontSizePdf === 'number' && Number.isFinite(source.fontSizePdf)
      ? source.fontSizePdf
      : 0;
    const ascent = typeof source.ascentPdf === 'number' && Number.isFinite(source.ascentPdf)
      ? source.ascentPdf
      : Math.max(0, fontSizePdf * 0.9);
    const descent = typeof source.descentPdf === 'number' && Number.isFinite(source.descentPdf)
      ? source.descentPdf
      : -Math.max(0, fontSizePdf * 0.2);
    // Existing PDF text must be covered exactly at its source run boundary.
    // Horizontal padding creates the visible left/right drift reported in the
    // editor. Keep a tiny vertical safety only for rasterization/descenders.
    const padX = 0;
    const padY = 0.25;

    const corners = [
      { x: e - vx * descent, y: f - vy * descent },
      { x: e + ux * width - vx * descent, y: f + uy * width - vy * descent },
      { x: e - vx * ascent, y: f - vy * ascent },
      { x: e + ux * width - vx * ascent, y: f + uy * width - vy * ascent },
    ];

    // The source transform is already in unrotated PDF page coordinates.
    // Page rotation is metadata applied to the page itself, so the cover must
    // remain in those same coordinates rather than applying display rotation
    // a second time. Keep the arguments for API compatibility with the other
    // geometry helpers and explicitly consume them to document the boundary.
    void displayWidth;
    void displayHeight;
    void rotation;

    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    page.drawRectangle({
      x: Math.max(0, Math.min(...xs) - padX),
      y: Math.max(0, Math.min(...ys) - padY),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padX * 2),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padY * 2),
      color: this.hexToPdfRgb(source.backgroundColor ?? '#ffffff'),
      borderWidth: 0
    });
  }

  /** Persist Studio links as native PDF link annotations, not flattened artwork. */
  private addLinkAnnotation(
    pdfDocument: PDFDocument,
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270,
    outputPages: readonly PDFPage[]
  ): void {
    const link = object.link;
    if (!link) return;

    const x1 = object.bounds.x * displayWidth;
    const y1 = object.bounds.y * displayHeight;
    const x2 = (object.bounds.x + object.bounds.width) * displayWidth;
    const y2 = (object.bounds.y + object.bounds.height) * displayHeight;
    const corners = [
      this.displayToPdfPoint(x1, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x1, y2, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y2, displayWidth, displayHeight, rotation)
    ];
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const rect = pdfDocument.context.obj([
      Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)
    ]);

    const annotation = pdfDocument.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      H: 'I'
    });

    if (link.kind === 'page') {
      const targetIndex = Math.max(0, Math.min(outputPages.length - 1, Math.floor(link.targetPage) - 1));
      const targetRef = outputPages[targetIndex]?.ref;
      if (!targetRef) return;
      annotation.set(PDFName.of('Dest'), pdfDocument.context.obj([targetRef, PDFName.of('Fit')]));
    } else {
      const url = link.url.trim();
      if (!url) return;
      const safeUrl = /^https?:\/\//i.test(url) || /^mailto:/i.test(url) ? url : `https://${url}`;
      annotation.set(PDFName.of('A'), pdfDocument.context.obj({
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of(safeUrl)
      }));
    }

    const annotationRef = pdfDocument.context.register(annotation);
    const annotsKey = PDFName.of('Annots');
    const existing = page.node.lookupMaybe(annotsKey, PDFArray);
    if (existing) {
      existing.push(annotationRef);
    } else {
      page.node.set(annotsKey, pdfDocument.context.obj([annotationRef]));
    }
  }

  private hexToPdfRgb(value: string): ReturnType<typeof rgb> {
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    const hex = match?.[1] ?? 'ffffff';
    return rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
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

  /** Cover a detected source image before drawing its replacement. */
  private async coverExistingPdfImage(
    pdfDocument: PDFDocument,
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): Promise<void> {
    const pixelRaster = object.pdfImage?.backgroundMode === 'layered'
      ? object.pdfImage.layeredReconstructionDataUrl
      : object.pdfImage?.backgroundMode === 'pixel'
        ? object.pdfImage.pixelReconstructionDataUrl
        : undefined;

    // Phase 5C.5 — when available, paint the generated pixel-level extension
    // across the original image bounds before the replacement artwork. This is
    // still bounded by the exact source region and falls back safely to the
    // Phase 5C.4 solid/edge-aware colour if the raster cannot be embedded.
    if (pixelRaster) {
      try {
        const reconstruction = await pdfDocument.embedPng(
          this.dataUrlToUint8Array(pixelRaster)
        );
        this.drawImageAcrossObjectBounds(
          page, object, reconstruction, displayWidth, displayHeight, rotation
        );
        return;
      } catch {
        // Keep export resilient: malformed/generated canvas data falls back to
        // the deterministic colour reconstruction below.
      }
    }

    const x1 = object.bounds.x * displayWidth;
    const y1 = object.bounds.y * displayHeight;
    const x2 = (object.bounds.x + object.bounds.width) * displayWidth;
    const y2 = (object.bounds.y + object.bounds.height) * displayHeight;
    const corners = [
      this.displayToPdfPoint(x1, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x1, y2, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y2, displayWidth, displayHeight, rotation)
    ];
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    page.drawRectangle({
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      color: this.pdfImageBackgroundColor(object),
      borderWidth: 0
    });
  }

  /** Paint the transparent Phase 5C.6 seam layer after replacement artwork. */
  private async drawPdfImageSeamBlend(
    pdfDocument: PDFDocument,
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): Promise<void> {
    if (object.pdfImage?.backgroundMode !== 'layered' || !object.pdfImage.seamBlendDataUrl) return;
    try {
      const seam = await pdfDocument.embedPng(
        this.dataUrlToUint8Array(object.pdfImage.seamBlendDataUrl)
      );
      this.drawImageAcrossObjectBounds(page, object, seam, displayWidth, displayHeight, rotation);
    } catch {
      // Export remains deterministic if a browser-generated seam raster is malformed.
    }
  }

  private resolveSigningAsset(object: StudioObject): import('../../../core/signing/models/signing.models').SigningAsset | null {
    if (object.type !== 'signature' || !object.signing) return null;
    if (object.signing.asset) return object.signing.asset;
    const assetId = object.signing.assetId;
    return assetId ? this.signingState.assets().find(asset => asset.id === assetId) ?? null : null;
  }

  private studioDisplayBox(
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270,
  ): { x: number; y: number; width: number; height: number } {
    const b = object.bounds;
    const x = b.x * displayWidth;
    const yTop = b.y * displayHeight;
    const w = b.width * displayWidth;
    const h = b.height * displayHeight;
    switch (rotation) {
      case 90: return { x: yTop, y: x, width: h, height: w };
      case 180: return { x: displayWidth - x - w, y: yTop, width: w, height: h };
      case 270: return { x: displayHeight - yTop - h, y: displayWidth - x - w, width: h, height: w };
      default: return { x, y: displayHeight - yTop - h, width: w, height: h };
    }
  }

  private drawStudioCheckbox(
    page: PDFPage,
    box: { x: number; y: number; width: number; height: number },
    checked: boolean,
    color: string,
    opacity: number,
  ): void {
    const c = this.hexToPdfRgb(color);
    const alpha = Math.max(0.05, Math.min(1, opacity));

    // The Studio preview uses a 1.5px border. At the browser reference DPI
    // that is 1.125 PDF points. Inset the PDF stroke by half its width so the
    // stroke stays completely inside the normalized object bounds instead of
    // being clipped at the edge during export.
    const borderWidth = 1.125;
    const inset = borderWidth / 2;
    const x = box.x + inset;
    const y = box.y + inset;
    const width = Math.max(0.5, box.width - borderWidth);
    const height = Math.max(0.5, box.height - borderWidth);

    page.drawRectangle({
      x,
      y,
      width,
      height,
      borderWidth,
      borderColor: c,
      color: rgb(1, 1, 1),
      opacity: Math.min(.92, alpha),
    });

    if (!checked) return;

    // Match the 1.7px Studio check strokes (≈1.275pt at 96 DPI) while
    // keeping the endpoints safely inside the checkbox border.
    const checkThickness = Math.max(0.9, Math.min(1.45, Math.min(width, height) * 0.055));
    page.drawLine({
      start: { x: x + width * .17, y: y + height * .50 },
      end: { x: x + width * .40, y: y + height * .25 },
      thickness: checkThickness,
      color: c,
      opacity: alpha,
    });
    page.drawLine({
      start: { x: x + width * .40, y: y + height * .25 },
      end: { x: x + width * .83, y: y + height * .75 },
      thickness: checkThickness,
      color: c,
      opacity: alpha,
    });
  }

  private async renderStudioSigningText(
    text: string,
    signing: NonNullable<Extract<StudioObject, { type: 'signature' }>['signing']>,
    box: { x: number; y: number; width: number; height: number },
  ): Promise<Uint8Array> {
    if (typeof document === 'undefined') throw new Error('Text rendering is available only in the browser.');
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(32, Math.ceil(box.width * scale));
    canvas.height = Math.max(24, Math.ceil(box.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the signing text canvas.');
    // Studio renders signing text in CSS pixels. PDF points are 96/72 of a
    // CSS pixel at the browser's reference DPI, so 1 CSS px maps to 0.75 pt.
    // Keeping this conversion here makes the exported PDF visually match the
    // live Studio canvas instead of making text ~33% larger after export.
    const size = Math.max(8, Math.min(96, signing.fontSize ?? 16)) * 0.75 * scale;
    const family = signing.fontFamily ?? 'Inter, Arial, sans-serif';
    const style = signing.fontStyle === 'italic' ? 'italic ' : '';
    const weight = '600 ';
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.font = `${style}${weight}${size}px ${family}`;
    ctx.fillStyle = signing.color ?? '#121923';
    ctx.globalAlpha = Math.max(.05, Math.min(1, signing.opacity));
    ctx.textBaseline = 'middle';
    const pad = 4 * scale;
    let fontSize = size;
    const maxWidth = Math.max(8, canvas.width - pad*2);
    for (let i=0;i<12;i+=1) {
      ctx.font = `${style}${weight}${fontSize}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth || fontSize <= 8*scale) break;
      fontSize *= .9;
    }
    ctx.fillText(text, pad, canvas.height/2);
    ctx.globalAlpha = 1;
    const blob = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not rasterize signing text.');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Draw reconstruction artwork across the exact displayed source box. */
  private drawImageAcrossObjectBounds(
    page: PDFPage,
    object: StudioObject,
    image: any,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {
    const boxX = object.bounds.x * displayWidth;
    const boxY = object.bounds.y * displayHeight;
    const boxWidth = object.bounds.width * displayWidth;
    const boxHeight = object.bounds.height * displayHeight;

    // The live Studio preview uses object-fit: contain for signature artwork.
    // Export must use the same geometry; stretching the asset to the complete
    // bounds changes its proportions and is immediately visible in the result.
    const sourceRatio = Math.max(0.0001, Number(image.width) / Math.max(1, Number(image.height)));
    const boxRatio = Math.max(0.0001, boxWidth / Math.max(0.0001, boxHeight));
    let drawWidth = boxWidth;
    let drawHeight = boxHeight;
    if (sourceRatio > boxRatio) {
      drawHeight = boxWidth / sourceRatio;
    } else {
      drawWidth = boxHeight * sourceRatio;
    }
    const drawX = boxX + (boxWidth - drawWidth) / 2;
    const drawY = boxY + (boxHeight - drawHeight) / 2;
    const displayBottom = displayHeight - drawY - drawHeight;

    switch (rotation) {
      case 90:
        page.drawImage(image, { x: drawX, y: displayBottom + drawHeight, width: drawHeight, height: drawWidth, rotate: degrees(-90) });
        return;
      case 180:
        page.drawImage(image, { x: displayWidth - (drawX + drawWidth), y: drawY + drawHeight, width: drawWidth, height: drawHeight, rotate: degrees(-180) });
        return;
      case 270:
        page.drawImage(image, { x: drawX + drawWidth, y: displayBottom, width: drawHeight, height: drawWidth, rotate: degrees(90) });
        return;
      default:
        page.drawImage(image, { x: drawX, y: displayBottom, width: drawWidth, height: drawHeight });
    }
  }

  /** Resolve the Phase 5C.4 reconstruction colour used behind replacement artwork. */
  private pdfImageBackgroundColor(object: StudioObject) {
    const source = object.pdfImage;
    const mode = source?.backgroundMode ?? 'auto';
    const value = mode === 'white' ? '#ffffff' : (source?.backgroundColor ?? '#ffffff');
    return this.hexToPdfRgb(value);
  }

  /**
   * Phase 5C.3 — Fill mode intentionally draws beyond the replacement box.
   * Clip that overdraw to the exact detected PDF-image region so it cannot
   * paint over neighbouring source content in the exported PDF.
   */
  private pushImageReplacementClip(
    page: PDFPage,
    object: StudioObject,
    displayWidth: number,
    displayHeight: number,
    rotation: 0 | 90 | 180 | 270
  ): void {
    const x1 = object.bounds.x * displayWidth;
    const y1 = object.bounds.y * displayHeight;
    const x2 = (object.bounds.x + object.bounds.width) * displayWidth;
    const y2 = (object.bounds.y + object.bounds.height) * displayHeight;
    const corners = [
      this.displayToPdfPoint(x1, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y1, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x1, y2, displayWidth, displayHeight, rotation),
      this.displayToPdfPoint(x2, y2, displayWidth, displayHeight, rotation)
    ];
    const minX = Math.min(...corners.map(point => point.x));
    const minY = Math.min(...corners.map(point => point.y));
    const maxX = Math.max(...corners.map(point => point.x));
    const maxY = Math.max(...corners.map(point => point.y));

    page.pushOperators(
      pushGraphicsState(),
      rectangle(minX, minY, Math.max(0.01, maxX - minX), Math.max(0.01, maxY - minY)),
      clip(),
      endPath()
    );
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

    const fitMode = object.pdfImage?.fitMode ?? 'stretch';
    const sourceRatio = Math.max(0.0001, image.width / image.height);
    const boxRatio = Math.max(0.0001, boxWidth / boxHeight);
    let drawWidth = boxWidth;
    let drawHeight = boxHeight;
    if (fitMode !== 'stretch') {
      const useWidth = fitMode === 'fit' ? sourceRatio > boxRatio : sourceRatio < boxRatio;
      if (useWidth) { drawWidth = boxWidth; drawHeight = boxWidth / sourceRatio; }
      else { drawHeight = boxHeight; drawWidth = boxHeight * sourceRatio; }
    }
    const drawX = boxX + (boxWidth - drawWidth) / 2;
    const drawY = boxY + (boxHeight - drawHeight) / 2;

    const displayBottom =
      displayHeight -
      drawY -
      drawHeight;

    switch (rotation) {

      case 90:
        page.drawImage(
          image,
          {
            x: drawX,
            y: displayBottom + drawHeight,
            width: drawHeight,
            height: drawWidth,
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
              (drawX + drawWidth),
            y:
              drawY + drawHeight,
            width: drawWidth,
            height: drawHeight,
            rotate: degrees(-180)
          }
        );
        return;

      case 270:
        page.drawImage(
          image,
          {
            x:
              drawX + drawWidth,
            y:
              displayBottom,
            width: drawHeight,
            height: drawWidth,
            rotate: degrees(90)
          }
        );
        return;

      case 0:
      default:
        page.drawImage(
          image,
          {
            x: drawX,
            y: displayBottom,
            width: drawWidth,
            height: drawHeight
          }
        );
    }
  }

  /** Map the detected PDF family to the closest exportable standard family. */
  private resolvePdfTextExportFamily(
    sourceName: string | null | undefined,
    fallback: StudioTextFontFamily
  ): StudioTextFontFamily {
    const value = String(sourceName ?? '')
      .replace(/^\/?[A-Z]{6}\+/, '')
      .toLowerCase();
    if (/times|serif|georgia|garamond|cambria|baskerville|palatino|roman|bookman/.test(value)) return 'Times Roman';
    if (/courier|mono|consolas|monospace|menlo|code|fixed/.test(value)) return 'Courier';
    if (/helvetica|arial|sans|verdana|tahoma|calibri|frutiger|univers|futura/.test(value)) return 'Helvetica';
    return fallback;
  }

  private async getFont(
    pdfDocument: PDFDocument,
    fontWeight: StudioTextFontWeight,
    fontStyle: StudioTextFontStyle,
    fontFamily: StudioTextFontFamily,
    cache: Map<string, PDFFont>,
    sourceFontBytes: Uint8Array | null = null,
    requiredText = '',
  ): Promise<PDFFont> {
    const sourceKey =
      sourceFontBytes && sourceFontBytes.byteLength > 0
        ? `source-${this.stableBytesFingerprint(sourceFontBytes)}-${fontWeight}-${fontStyle}`
        : null;

    const key =
      sourceKey ??
      `${fontFamily}-${fontWeight}-${fontStyle}`;

    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    if (sourceFontBytes && sourceFontBytes.byteLength > 0) {
      try {
        const embeddedSourceFont =
          await pdfDocument.embedFont(
            sourceFontBytes,
            { subset: true },
          );

        /*
         * PDF.js may expose a subset containing only the glyphs present in the
         * original document. If the replacement introduces a character that
         * the source subset does not contain, do not let export fail halfway
         * through the document; fall back to the mapped standard font below.
         */
        if (
          this.fontSupportsText(
            embeddedSourceFont,
            requiredText,
          )
        ) {
          cache.set(key, embeddedSourceFont);
          return embeddedSourceFont;
        }
      } catch {
        /*
         * Some PDF.js-converted font programs are not accepted by fontkit.
         * The standard-font path below remains the controlled fallback.
         */
      }
    }

    let standardFont = StandardFonts.Helvetica;
    if (fontFamily === 'Times Roman') {
      standardFont = fontWeight >= 700 && fontStyle === 'italic' ? StandardFonts.TimesRomanBoldItalic
        : fontWeight >= 700 ? StandardFonts.TimesRomanBold
        : fontStyle === 'italic' ? StandardFonts.TimesRomanItalic
        : StandardFonts.TimesRoman;
    } else if (fontFamily === 'Courier') {
      standardFont = fontWeight >= 700 && fontStyle === 'italic' ? StandardFonts.CourierBoldOblique
        : fontWeight >= 700 ? StandardFonts.CourierBold
        : fontStyle === 'italic' ? StandardFonts.CourierOblique
        : StandardFonts.Courier;
    } else {
      standardFont = fontWeight >= 700 && fontStyle === 'italic' ? StandardFonts.HelveticaBoldOblique
        : fontWeight >= 700 ? StandardFonts.HelveticaBold
        : fontStyle === 'italic' ? StandardFonts.HelveticaOblique
        : StandardFonts.Helvetica;
    }

    const embedded =
      await pdfDocument.embedFont(
        standardFont,
      );

    cache.set(key, embedded);

    return embedded;
  }

  private fontSupportsText(
    font: PDFFont,
    text: string,
  ): boolean {
    if (!text) return true;

    try {
      const supported = new Set(
        font.getCharacterSet(),
      );

      for (const character of Array.from(text)) {
        if (!supported.has(character.codePointAt(0) ?? -1)) {
          return false;
        }
      }

      return true;
    } catch {
      return true;
    }
  }

  private getSourceFontKey(
    object: StudioObject,
    manifest: readonly StudioPage[],
  ): string | null {
    const source = object.pdfText;
    if (!source?.fontName) return null;

    const logicalPage =
      manifest[object.pageNumber - 1];

    const sourcePageNumber =
      logicalPage?.kind === 'source' &&
      typeof logicalPage.sourcePageNumber === 'number'
        ? logicalPage.sourcePageNumber
        : object.pageNumber;

    return `${sourcePageNumber}:${source.fontName}`;
  }

  private async collectSourceFontBytes(
    sourceBytes: Uint8Array,
    objects: readonly StudioObject[],
    manifest: readonly StudioPage[],
  ): Promise<Map<string, Uint8Array>> {
    const requests = new Map<
      string,
      { pageNumber: number; fontName: string }
    >();

    for (const object of objects) {
      if (
        object.type !== 'text' ||
        !object.pdfText?.edited ||
        !object.pdfText.fontName
      ) {
        continue;
      }

      const key =
        this.getSourceFontKey(
          object,
          manifest,
        );

      if (!key || requests.has(key)) continue;

      const separator =
        key.indexOf(':');

      const pageNumber =
        Number(key.slice(0, separator));

      const fontName =
        key.slice(separator + 1);

      if (
        Number.isInteger(pageNumber) &&
        pageNumber > 0 &&
        fontName
      ) {
        requests.set(
          key,
          { pageNumber, fontName },
        );
      }
    }

    if (requests.size === 0) {
      return new Map();
    }

    const pdfjs =
      await import('pdfjs-dist');

    if (
      typeof document !== 'undefined'
    ) {
      pdfjs.GlobalWorkerOptions.workerSrc =
        new URL(
          '/assets/pdfjs/pdf.worker.min.mjs',
          document.baseURI,
        ).toString();
    }

    const loadingTask =
      pdfjs.getDocument({
        data: sourceBytes,
        /*
         * PDF.js normally releases FontFaceObject.data after attaching the
         * browser font. Export explicitly asks it to retain the parsed font
         * program so the exact source font can be embedded by pdf-lib.
         */
        fontExtraProperties: true,
      });

    const sourcePdfJs: PDFDocumentProxy =
      await loadingTask.promise;

    const result =
      new Map<string, Uint8Array>();

    try {
      for (const [
        key,
        request,
      ] of requests) {
        try {
          const page =
            await sourcePdfJs.getPage(
              request.pageNumber,
            );

          /*
           * getOperatorList materializes shared font objects in commonObjs.
           * We do not render the page; only the source font resources are read.
           */
          await page.getOperatorList();

          const commonObjs =
            page.commonObjs as unknown as {
              get?: (id: string) => unknown;
            };

          const font =
            commonObjs.get?.(
              request.fontName,
            ) as {
              data?: unknown;
            } | undefined;

          const data =
            this.toUint8Array(
              font?.data,
            );

          if (data) {
            result.set(key, data);
          }
        } catch {
          /*
           * Missing/non-embeddable fonts are allowed to fall through to the
           * existing standard-font mapping. One bad font must not abort export.
           */
        }
      }
    } finally {
      await sourcePdfJs.destroy();
    }

    return result;
  }

  private toUint8Array(
    value: unknown,
  ): Uint8Array | null {
    if (value instanceof Uint8Array) {
      return new Uint8Array(
        value,
      );
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(
        value,
      );
    }

    if (
      ArrayBuffer.isView(value)
    ) {
      return new Uint8Array(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ),
      );
    }

    return null;
  }

  private stableBytesFingerprint(
    bytes: Uint8Array,
  ): string {
    /*
     * Cache identity only; this is not cryptographic. A short rolling hash
     * avoids embedding the same source font more than once in the output PDF.
     */
    let hash = 2166136261;
    for (
      let index = 0;
      index < bytes.length;
      index += Math.max(1, Math.floor(bytes.length / 4096))
    ) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }

    hash ^= bytes.length;
    return (
      hash >>> 0
    ).toString(16);
  }

  private textWidthWithTracking(text: string, font: PDFFont, fontSize: number, tracking: number): number {
    if (!text.length) return 0;
    return font.widthOfTextAtSize(text, fontSize) + Math.max(0, text.length - 1) * tracking * fontSize;
  }

  /** Phase 2 — preserve the source text matrix's effective horizontal scale. */
  private resolveSourceScaleX(object: StudioObject): number {
    const source = object.pdfText;
    const transformScaleX = source?.transformScaleX;
    const transformScaleY = source?.transformScaleY;
    const matrixScaleX =
      typeof transformScaleX === 'number' && Number.isFinite(transformScaleX) && transformScaleX > 0 &&
      typeof transformScaleY === 'number' && Number.isFinite(transformScaleY) && transformScaleY > 0
        ? transformScaleX / transformScaleY
        : 1;
    const calibration = source?.metricScaleX ?? 1;
    return Math.max(0.25, Math.min(4, matrixScaleX * calibration));
  }

  private drawTrackedText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, fontSize: number, tracking: number, color: ReturnType<typeof rgb>, rotate: ReturnType<typeof degrees>, metricScaleX = 1): void {
    if (!text.length) return;
    const safeScaleX = Number.isFinite(metricScaleX) ? Math.max(0.25, Math.min(4, metricScaleX)) : 1;
    if (tracking === 0 && Math.abs(safeScaleX - 1) < 0.002) {
      page.drawText(text, { x, y, size: fontSize, font, color, rotate });
      return;
    }
    let cursor = x;
    for (const glyph of Array.from(text)) {
      page.drawText(glyph, { x: cursor, y, size: fontSize, font, color, rotate });
      cursor += (font.widthOfTextAtSize(glyph, fontSize) + tracking * fontSize) * safeScaleX;
    }
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
    if (object.type === 'text' && object.pdfText?.edited) {
      this.drawEditedPdfTextFromSourceGeometry(page, object, lines, font, fontSize, lineHeight);
      return;
    }
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

      const metricScaleX = object.pdfText?.metricScaleX ?? 1;
      const lineWidth = this.textWidthWithTracking(
        line, font, fontSize, object.textStyle?.letterSpacing ?? 0,
      ) * metricScaleX;

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
      const sourceAscentPdf = object.pdfText?.ascentPdf;
      const legacySourceAscent = object.pdfText?.ascent;
      const ascentOffset = typeof sourceAscentPdf === 'number' && Number.isFinite(sourceAscentPdf)
        ? sourceAscentPdf
        : typeof legacySourceAscent === 'number'
          ? Math.max(fontSize * 0.62, Math.min(fontSize * 1.08, legacySourceAscent * fontSize))
          : fontSize;
      const displayBaselineY =
        boxY +
        ascentOffset +
        index * lineHeight;

      const point =
        this.displayToPdfPoint(
          alignedX,
          displayBaselineY,
          displayWidth,
          displayHeight,
          rotation,
        );

      this.drawTrackedText(
        page, line, point.x, point.y, font, fontSize,
        object.textStyle?.letterSpacing ?? 0,
        this.hexToPdfRgb(object.pdfText?.textColor ?? object.textStyle?.color ?? '#000000'),
        degrees(this.textCompensationRotation(rotation) - (object.pdfText?.rotation ?? 0)),
        this.resolveSourceScaleX(object),
      );
    }
  }

  /**
   * Phase 3 — draw an edited existing-PDF text object from the captured source
   * baseline/transform instead of rebuilding its position from normalized UI
   * bounds. The source PDF transform remains authoritative; only the glyph
   * content is replaced.
   */
  private drawEditedPdfTextFromSourceGeometry(
    page: PDFPage,
    object: StudioObject,
    lines: readonly string[],
    font: PDFFont,
    fontSize: number,
    lineHeight: number,
  ): void {
    const source = object.pdfText;
    if (!source) return;

    const [a, b, c, d, e, f] = source.transform;
    const sourceRotation = Math.atan2(b, a) * 180 / Math.PI;
    const scaleX = this.resolveSourceScaleX(object);
    const tracking = object.textStyle?.letterSpacing ?? 0;
    const color = this.hexToPdfRgb(source.textColor ?? object.textStyle?.color ?? '#000000');
    const ux = a / (Math.hypot(a, b) || 1);
    const uy = b / (Math.hypot(a, b) || 1);
    const vx = c / (Math.hypot(c, d) || 1);
    const vy = d / (Math.hypot(c, d) || 1);
    const sourceLineHeight = Math.max(0.01, source.lineHeightPdf ?? lineHeight ?? fontSize);

    const runs = source.sourceRuns;
    if (runs && runs.length > 0 && lines.length === 1) {
      const originalText = source.originalText;
      const editedText = lines[0];
      const change = this.resolveSingleTextChange(originalText, editedText);

      if (!change) return;

      /*
       * The copied page still contains every untouched source glyph. Only the
       * replacement string is painted here. Its start is derived from the
       * original run baseline plus the exact width of the unchanged prefix.
       */
      const firstIndex = this.firstAffectedRunIndex(runs, change.originalStart);
      const firstRun = runs[firstIndex];
      if (!firstRun) return;

      const localStart = Math.max(
        0,
        Math.min(firstRun.text.length, change.originalStart - firstRun.startIndex),
      );
      const prefix = firstRun.text.slice(0, localStart);
      const prefixWidth = this.textWidthWithTracking(prefix, font, fontSize, tracking) * scaleX;
      const runWidth = Math.max(0, firstRun.widthPdf);
      const calibratedPrefixWidth = runWidth > 0
        ? Math.min(prefixWidth, runWidth)
        : prefixWidth;

      const x = firstRun.baselineXPdf + ux * calibratedPrefixWidth;
      const y = f + uy * (firstRun.baselineXPdf - e + calibratedPrefixWidth);

      this.drawTrackedText(
        page,
        change.replacementText,
        x,
        y,
        font,
        fontSize,
        tracking,
        color,
        degrees(sourceRotation),
        scaleX,
      );
      return;
    }

    /*
     * Fallback for multiline/legacy objects without run metadata. The caller
     * has already covered the source box, so reconstruct the edited content
     * from the authoritative source transform.
     */
    const sourceWidth = Math.max(0, source.textWidthPdf ?? 0);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineWidth = this.textWidthWithTracking(line, font, fontSize, tracking) * scaleX;
      let x = e;
      let y = f;
      const alignment = object.textStyle?.textAlign ?? 'left';
      if (alignment === 'center') {
        const offset = (sourceWidth - lineWidth) / 2;
        x += ux * offset;
        y += uy * offset;
      } else if (alignment === 'right') {
        const offset = sourceWidth - lineWidth;
        x += ux * offset;
        y += uy * offset;
      }
      x += vx * sourceLineHeight * index;
      y += vy * sourceLineHeight * index;
      this.drawTrackedText(
        page, line, x, y, font, fontSize, tracking, color, degrees(sourceRotation), scaleX,
      );
    }
  }

  private canUsePartialSourceTextReplacement(object: StudioObject): boolean {
    const source = object.pdfText;
    if (!source?.edited || !source.sourceRuns?.length) return false;
    const change = this.resolveSingleTextChange(source.originalText, object.text ?? '');
    return Boolean(change);
  }

  /**
   * Cover only the old glyph interval affected by a single-line replacement.
   * This deliberately does not cover the whole source text object.
   */
  private coverEditedPdfTextChange(
    page: PDFPage,
    object: StudioObject,
    font: PDFFont,
    fontSize: number,
  ): void {
    const source = object.pdfText;
    const runs = source?.sourceRuns;
    if (!source || !runs?.length) return;

    const change = this.resolveSingleTextChange(source.originalText, object.text ?? '');
    if (!change) return;

    const firstIndex = this.firstAffectedRunIndex(runs, change.originalStart);
    const lastIndex = this.lastAffectedRunIndex(runs, change.originalEnd);
    const firstRun = runs[firstIndex];
    const lastRun = runs[lastIndex];
    if (!firstRun || !lastRun) return;

    const [a, b, c, d] = source.transform;
    const axisX = Math.hypot(a, b) || 1;
    const axisY = Math.hypot(c, d) || 1;
    const ux = a / axisX;
    const uy = b / axisX;
    const vx = c / axisY;
    const vy = d / axisY;
    const e = source.transform[4];
    const f = source.transform[5];
    const scaleX = this.resolveSourceScaleX(object);
    const tracking = object.textStyle?.letterSpacing ?? 0;

    const localStart = Math.max(
      0,
      Math.min(firstRun.text.length, change.originalStart - firstRun.startIndex),
    );
    const prefix = firstRun.text.slice(0, localStart);
    const prefixWidth = this.textWidthWithTracking(prefix, font, fontSize, tracking) * scaleX;
    const firstRunWidth = Math.max(0, firstRun.widthPdf);
    const startOffset = Math.min(prefixWidth, firstRunWidth);

    const localEnd = Math.max(
      0,
      Math.min(lastRun.text.length, change.originalEnd - lastRun.startIndex),
    );
    const suffix = lastRun.text.slice(localEnd);
    const suffixWidth = this.textWidthWithTracking(suffix, font, fontSize, tracking) * scaleX;
    const lastRunEnd = lastRun.baselineXPdf + Math.max(0, lastRun.widthPdf);
    const endOffsetFromLastRunEnd = Math.min(suffixWidth, Math.max(0, lastRun.widthPdf));
    const endPdf = Math.max(
      firstRun.baselineXPdf + startOffset,
      lastRunEnd - endOffsetFromLastRunEnd,
    );
    const startPdf = Math.min(
      firstRun.baselineXPdf + startOffset,
      endPdf,
    );

    const ascent = typeof source.ascentPdf === 'number' && Number.isFinite(source.ascentPdf)
      ? Math.max(0, source.ascentPdf)
      : fontSize * 0.9;
    const descent = typeof source.descentPdf === 'number' && Number.isFinite(source.descentPdf)
      ? Math.min(0, source.descentPdf)
      : -fontSize * 0.2;

    const startOffsetFromBaseline = startPdf - e;
    const endOffsetFromBaseline = endPdf - e;
    const corners = [
      { x: e + ux * startOffsetFromBaseline - vx * ascent, y: f + uy * startOffsetFromBaseline - vy * ascent },
      { x: e + ux * endOffsetFromBaseline - vx * ascent, y: f + uy * endOffsetFromBaseline - vy * ascent },
      { x: e + ux * startOffsetFromBaseline - vx * descent, y: f + uy * startOffsetFromBaseline - vy * descent },
      { x: e + ux * endOffsetFromBaseline - vx * descent, y: f + uy * endOffsetFromBaseline - vy * descent },
    ];

    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    page.drawRectangle({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(0.5, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(0.5, Math.max(...ys) - Math.min(...ys)),
      color: this.hexToPdfRgb(source.backgroundColor ?? '#ffffff'),
      borderWidth: 0,
    });
  }

  private resolveSingleTextChange(
    originalText: string,
    editedText: string,
  ): { originalStart: number; originalEnd: number; replacementText: string } | null {
    if (originalText === editedText) return null;
    let prefix = 0;
    const maxPrefix = Math.min(originalText.length, editedText.length);
    while (prefix < maxPrefix && originalText[prefix] === editedText[prefix]) prefix++;
    let suffix = 0;
    const maxSuffix = Math.min(originalText.length - prefix, editedText.length - prefix);
    while (suffix < maxSuffix && originalText[originalText.length - 1 - suffix] === editedText[editedText.length - 1 - suffix]) suffix++;
    return {
      originalStart: prefix,
      originalEnd: originalText.length - suffix,
      replacementText: editedText.slice(prefix, editedText.length - suffix),
    };
  }

  private firstAffectedRunIndex(
    runs: readonly { startIndex: number; endIndex: number }[],
    originalStart: number,
  ): number {
    const index = runs.findIndex(run => originalStart < run.endIndex);
    return index >= 0 ? index : Math.max(0, runs.length - 1);
  }

  private lastAffectedRunIndex(
    runs: readonly { startIndex: number; endIndex: number }[],
    originalEnd: number,
  ): number {
    const index = runs.findIndex(run => originalEnd <= run.endIndex);
    return index >= 0 ? index : Math.max(0, runs.length - 1);
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
  /**
   * Phase 5B.4 — choose a stable replacement size. Existing PDF text defaults
   * to auto-fit so longer replacement paragraphs do not silently clip.
   */
  private resolveTextFit(
    object: StudioObject, font: PDFFont, requestedSize: number, boxWidth: number, boxHeight: number, displayHeight: number
  ): { fontSize: number; lineHeight: number; lines: string[] } {
    const style = object.textStyle;
    const tracking = style?.letterSpacing ?? 0;
    const sourceLineHeight = object.pdfText?.lineHeightPdf
      ? Math.max(0.9, object.pdfText.lineHeightPdf / Math.max(requestedSize, 0.1))
      : object.pdfText?.lineHeight
        ? Math.max(0.9, (object.pdfText.lineHeight * displayHeight) / Math.max(requestedSize, 0.1))
        : (style?.lineHeight ?? 1.2);
    const mode = object.pdfText?.fitMode ?? 'original';
    const fits = (size: number) => {
      const lines = this.wrapText(object.text ?? '', font, size, boxWidth, tracking);
      const lineHeight = size * sourceLineHeight;
      return { lines, lineHeight, fits: lines.length * lineHeight <= boxHeight + size * 0.15 };
    };
    if (mode !== 'auto') {
      const current = fits(requestedSize);
      return { fontSize: requestedSize, lineHeight: current.lineHeight, lines: current.lines };
    }
    let low = Math.max(3, requestedSize * 0.35);
    let high = requestedSize;
    let best = low;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (fits(mid).fits) { best = mid; low = mid; } else high = mid;
    }
    const current = fits(best);
    return { fontSize: best, lineHeight: current.lineHeight, lines: current.lines };
  }

  private wrapText(
    text: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
    tracking = 0,
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
          this.textWidthWithTracking(candidate, font, fontSize, tracking) > maxWidth
        ) {
          result.push(current);
          current = word;
          continue;
        }

        if (
          !current &&
          this.textWidthWithTracking(word, font, fontSize, tracking) > maxWidth
        ) {
          const chunks =
            this.breakLongWord(
              word,
              font,
              fontSize,
              maxWidth,
              tracking,
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
    tracking = 0,
  ): string[] {
    const parts: string[] = [];
    let current = '';

    for (const character of word) {
      const candidate =
        `${current}${character}`;

      if (current && this.textWidthWithTracking(candidate, font, fontSize, tracking) > maxWidth) {
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

  /** Phase 2 — authoritative source font size in PDF points. */
  private resolveSourceFontSize(
    sourceText: StudioPdfTextSource | undefined,
    fallbackNormalizedRatio: number,
    displayPageHeight: number,
  ): number {
    const sourceSize = sourceText?.fontSizePdf;
    if (typeof sourceSize === 'number' && Number.isFinite(sourceSize) && sourceSize > 0) {
      return Math.max(0.01, Math.min(500, sourceSize));
    }
    return this.resolveFontSize(fallbackNormalizedRatio, displayPageHeight);
  }

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

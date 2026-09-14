import {
  Injectable,
  signal
} from '@angular/core';

import type {
  StudioObject,
  StudioObjectBounds,
  StudioTextAlign,
  StudioTextFontStyle,
  StudioTextFontWeight,
  StudioTextFontFamily,
  StudioTextStyle,
  StudioImageData,
  StudioShapeKind,
  StudioShapeStyle,
  StudioDrawingData,
  StudioDrawingStyle,
  StudioPoint,
  StudioCommentData,
  StudioLinkData,
  StudioPdfTextSource,
  StudioPdfImageSource,
  StudioTextObject,
  StudioPdfTextObject,
  StudioImageObject,
  StudioPdfImageObject,
  StudioLinkObject
} from '../models/studio-selection.model';
import type { PdfExistingTextBlock, PdfExistingImageBlock } from '../models/pdf-content-analysis.model';

const DEFAULT_TEXT_STYLE: StudioTextStyle = {
  fontSize: 0.018,
  fontWeight: 400,
  fontStyle: 'normal',
  textAlign: 'left',
  fontFamily: 'Helvetica',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#101820'
};

@Injectable({
  providedIn: 'root'
})
export class StudioObjectService {

  private readonly objects =
    new Map<string, StudioObject>();

  /**
   * Reactive mutation version. Any Studio object mutation increments
   * this signal so OnPush templates can immediately reflect changes
   * to text, formatting, move/resize and deletion.
   */
  private readonly revision = signal(0);

  readonly changes = this.revision.asReadonly();

  listForPage(
    pageNumber: number
  ): readonly StudioObject[] {

    return Array.from(
      this.objects.values()
    )
      .filter(
        object =>
          object.pageNumber === pageNumber
      )
      .map(
        object =>
          this.cloneObject(object)
      );
  }

  /**
   * F5 — Return a deep, immutable snapshot of every Studio object.
   *
   * This is used by page-management history because insert/delete/reorder can
   * remap object page numbers. Restoring pages without restoring objects would
   * corrupt the document state.
   */
  snapshot(): readonly StudioObject[] {

    return Array.from(
      this.objects.values()
    ).map(
      object =>
        this.cloneObject(object)
    );
  }

  /**
   * F5 — Replace the complete object collection from a history snapshot.
   */
  restore(
    objects: readonly StudioObject[]
  ): void {

    this.objects.clear();

    for (
      const object of objects
    ) {
      const clone =
        this.cloneObject(object);

      this.objects.set(
        clone.id,
        clone
      );
    }

    this.touch();
  }

  get(
    objectId: string
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    return object
      ? this.cloneObject(object)
      : null;
  }

  add(
    object: StudioObject
  ): void {

    this.objects.set(
      object.id,
      this.cloneObject(object)
    );
    this.touch();
  }

  /**
   * Phase 5B — materialize extracted PDF text as transparent, selectable
   * Studio objects. Existing objects are never overwritten so edits survive
   * page navigation and repeated analysis.
   */
  syncPdfTextBlocks(blocks: readonly PdfExistingTextBlock[]): void {
    let changed = false;
    for (const block of blocks) {
      const existing = this.objects.get(block.id);
      if (existing) {
        // Re-analysis can discover more authoritative source metrics (for
        // example the real baseline spacing or embedded font face). Refresh
        // those fields without discarding a user's already committed edit.
        if (existing.type === 'text' && existing.pdfText) {
          const currentSource = existing.pdfText;
          const refreshedSource: StudioPdfTextSource = {
            ...currentSource,
            fontName: block.fontName,
            transform: [...block.transform],
            detectedFontSize: block.detectedFontSize,
            rotation: block.rotation,
            lineHeight: block.lineHeight,
            sourceFontFamily: block.sourceFontFamily ?? block.fontFamily,
            sourceFontCssFamily: block.sourceFontCssFamily,
            sourceFontWeight: block.fontWeight as StudioTextFontWeight,
            sourceFontStyle: block.fontStyle,
            textColor: block.textColor ?? currentSource.textColor ?? '#000000',
            ascent: block.ascent,
            descent: block.descent,
            ascentPdf: block.ascentPdf,
            descentPdf: block.descentPdf,
            pageWidthPdf: block.pageWidthPdf,
            pageHeightPdf: block.pageHeightPdf,
            fontSizePdf: block.fontSizePdf,
            textWidthPdf: block.textWidthPdf,
            textHeightPdf: block.textHeightPdf,
            lineHeightPdf: block.lineHeightPdf,
            transformScaleX: block.transformScaleX,
            transformScaleY: block.transformScaleY,
            baselineXPdf: block.baselineXPdf,
            baselineYPdf: block.baselineYPdf,
            sourceRuns: block.sourceRuns
          };
          const sourceBounds = this.resolvePdfSourceTextBounds(block);
          const refreshed: StudioObject = {
            ...existing,
            // Only move an unedited source overlay to newly detected geometry.
            // Once the user edits the text, preserve any intentional Studio
            // bounds changes.
            bounds: currentSource.edited ? existing.bounds : this.normalizeBounds(sourceBounds),
            pdfText: refreshedSource,
            textStyle: existing.textStyle
              ? {
                  ...existing.textStyle,
                  fontWeight: currentSource.typographyLocked
                    ? (block.fontWeight >= 600 ? 700 : 400)
                    : existing.textStyle.fontWeight,
                  fontStyle: currentSource.typographyLocked
                    ? block.fontStyle
                    : existing.textStyle.fontStyle
                }
              : existing.textStyle
          };
          this.objects.set(block.id, refreshed);
          changed = true;
        }
        continue;
      }

      const estimatedFontSize = this.clamp(
        Math.max(0.006, block.detectedFontSize || block.height * 0.82),
        0.006,
        0.08
      );

      const source: StudioPdfTextSource = {
        originalText: block.text,
        fontName: block.fontName,
        transform: [...block.transform],
        edited: false,
        detectedFontSize: block.detectedFontSize,
        rotation: block.rotation,
        lineHeight: block.lineHeight,
        sourceFontFamily: block.sourceFontFamily ?? block.fontFamily,
        sourceFontCssFamily: block.sourceFontCssFamily,
        sourceFontWeight: block.fontWeight as StudioTextFontWeight,
        sourceFontStyle: block.fontStyle,
        textColor: block.textColor ?? '#000000',
        ascent: block.ascent,
        descent: block.descent,
        ascentPdf: block.ascentPdf,
        descentPdf: block.descentPdf,
        pageWidthPdf: block.pageWidthPdf,
        pageHeightPdf: block.pageHeightPdf,
        fontSizePdf: block.fontSizePdf,
        textWidthPdf: block.textWidthPdf,
        textHeightPdf: block.textHeightPdf,
        lineHeightPdf: block.lineHeightPdf,
        transformScaleX: block.transformScaleX,
        transformScaleY: block.transformScaleY,
        baselineXPdf: block.baselineXPdf,
        baselineYPdf: block.baselineYPdf,
        sourceRuns: block.sourceRuns,
        // Source-PDF covers never use horizontal padding. The legacy field is
        // retained for backwards compatibility but is normalized to zero.
        coverPadding: 0,
        // Source PDF typography must never silently shrink when text is edited.
        fitMode: 'original',
        metricScaleX: 1,
        typographyLocked: true,
        backgroundColor: '#ffffff'
      };

      const sourceBounds = this.resolvePdfSourceTextBounds(block);

      const object: StudioPdfTextObject = {
        id: block.id,
        pageNumber: block.pageNumber,
        type: 'text',
        bounds: this.normalizeBounds(sourceBounds),
        text: block.text,
        textStyle: {
          ...DEFAULT_TEXT_STYLE,
          fontSize: estimatedFontSize,
          fontWeight: block.fontWeight >= 600 ? 700 : 400,
          fontStyle: block.fontStyle,
          fontFamily: this.mapPdfFontFamily(block.sourceFontFamily || block.fontFamily || block.fontName)
        },
        pdfText: source
      };

      this.objects.set(object.id, object);
      changed = true;
    }

    if (changed) this.touch();
  }

  /**
   * Resolve the DOM hit/edit rectangle for an existing PDF text run.
   *
   * Horizontal source text uses PDF.js's original text-item rectangle exactly.
   * The preserved transform/baseline/font metrics remain available on pdfText
   * for export and high-fidelity reconstruction.
   */
  private resolvePdfSourceTextBounds(block: PdfExistingTextBlock): {
    x: number; y: number; width: number; height: number;
  } {
    /*
     * LIVE EDITOR GEOMETRY
     * --------------------
     * PDF.js already gives us the exact text-item width/height in device
     * space. Those values are the geometry used by PDF.js's own text layer
     * and are a much safer overlay/cover rectangle than reconstructing a new
     * box from ascent/descent. Reconstructing that box can make the cover
     * taller than the actual source run and can cover the line below.
     *
     * Keep the original transform/baseline separately in pdfText for export;
     * this method is only responsible for the DOM hit/edit rectangle.
     */
    const rotation = Number.isFinite(block.rotation)
      ? Math.abs(block.rotation)
      : 0;

    const rawBounds = {
      x: Math.min(1, Math.max(0, block.x)),
      y: Math.min(1, Math.max(0, block.y)),
      width: Math.max(0.002, Math.min(1, block.width)),
      height: Math.max(0.012, Math.min(1, block.height))
    };

    /*
     * Horizontal/near-horizontal PDF text is the common case and should use
     * the exact PDF.js item rectangle without any extra padding.
     */
    if (rotation < 0.5) {
      return rawBounds;
    }

    /*
     * Rotated source runs still need an axis-aligned DOM rectangle. Rebuild
     * that rectangle from the preserved PDF transform and font metrics.
     * Export never relies on this fallback rectangle.
     */
    const pageWidth = Math.max(1, block.pageWidthPdf);
    const pageHeight = Math.max(1, block.pageHeightPdf);
    const [a, b, c, d, e, f] = block.transform;
    const uxLength = Math.hypot(a, b) || 1;
    const vyLength = Math.hypot(c, d) || 1;
    const ux = a / uxLength;
    const uy = b / uxLength;
    const vx = c / vyLength;
    const vy = d / vyLength;
    const ascent = Math.max(
      0.01,
      block.ascentPdf ?? block.fontSizePdf * 0.9
    );
    const descent = Math.min(
      -0.001,
      block.descentPdf ?? -block.fontSizePdf * 0.2
    );
    const width = Math.max(
      0.01,
      block.textWidthPdf
    );

    const corners = [
      [e, f],
      [e + ux * width, f + uy * width],
      [e + vx * ascent, f + vy * ascent],
      [e + vx * descent, f + vy * descent],
      [e + ux * width + vx * ascent, f + uy * width + vy * ascent],
      [e + ux * width + vx * descent, f + uy * width + vy * descent],
    ];

    const xs = corners.map(point => point[0]);
    const ys = corners.map(point => point[1]);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX / pageWidth,
      y: (pageHeight - maxY) / pageHeight,
      width: Math.max(0.002, (maxX - minX) / pageWidth),
      height: Math.max(0.012, (maxY - minY) / pageHeight),
    };
  }

  /** Phase 5C.1 — create transparent selectable overlays for detected original PDF images. */
  syncPdfImageBlocks(blocks: readonly PdfExistingImageBlock[]): void {
    let changed = false;
    for (const block of blocks) {
      const existing = this.objects.get(block.id);
      if (existing) continue;
      const object: StudioPdfImageObject = {
        id: block.id,
        pageNumber: block.pageNumber,
        type: 'image',
        bounds: this.normalizeBounds({ x: block.x, y: block.y, width: Math.max(block.width, 0.01), height: Math.max(block.height, 0.01) }),
        pdfImage: { sourceName: block.sourceName, confidence: block.confidence, rotation: block.rotation, replaced: false, fitMode: 'fit', backgroundMode: 'auto', backgroundColor: '#ffffff', backgroundConfidence: 'low' }
      };
      this.objects.set(object.id, object);
      changed = true;
    }
    if (changed) this.touch();
  }

  /** Update source appearance without changing text semantics. Used by 5B.2 sampling and inspector controls. */
  updatePdfTextAppearance(
    objectId: string,
    patch: Partial<Pick<StudioPdfTextSource, 'backgroundColor' | 'textColor' | 'rotation' | 'detectedFontSize' | 'lineHeight' | 'sourceFontFamily' | 'sourceFontWeight' | 'sourceFontStyle' | 'ascent' | 'descent' | 'coverPadding' | 'fitMode' | 'metricScaleX' | 'typographyLocked'>>
  ): StudioObject | null {
    const object = this.objects.get(objectId);
    if (!object || object.type !== 'text' || !object.pdfText) return null;
    const updated: StudioObject = {
      ...object,
      pdfText: { ...object.pdfText, ...patch }
    };
    this.objects.set(objectId, updated);
    this.touch();
    return this.cloneObject(updated);
  }

  restorePdfText(objectId: string): StudioObject | null {
    const object = this.objects.get(objectId);
    if (!object || object.type !== 'text' || !object.pdfText) return null;
    const updated: StudioObject = {
      ...object,
      text: object.pdfText.originalText,
      pdfText: { ...object.pdfText, edited: false }
    };
    this.objects.set(objectId, updated);
    this.touch();
    return this.cloneObject(updated);
  }



  private mapPdfFontFamily(name: string): StudioTextFontFamily {
    const value = this.normalizePdfFontName(name);
    if (/times|serif|georgia|garamond|cambria|baskerville|palatino|roman|bookman/.test(value)) return 'Times Roman';
    if (/courier|mono|consolas|monospace|menlo|code|fixed/.test(value)) return 'Courier';
    return 'Helvetica';
  }

  /** Remove common PDF subset/resource prefixes before family classification. */
  private normalizePdfFontName(name: string): string {
    return String(name ?? '')
      .replace(/^\/?[A-Z]{6}\+/, '')
      .replace(/^g_[a-z0-9_]+_f\d+$/i, '')
      .replace(/["']/g, '')
      .toLowerCase();
  }

  /** Create a clickable link region. The destination is edited in the inspector. */
  createLinkObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number
  ): StudioObject {
    const width = 0.22;
    const height = 0.055;
    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'link',
      bounds: {
        x: this.clamp(normalizedX, 0, 1 - width),
        y: this.clamp(normalizedY, 0, 1 - height),
        width,
        height
      },
      link: {
        kind: 'url',
        url: '',
        targetPage: Math.max(1, pageNumber)
      }
    };
    this.objects.set(object.id, object);
    this.touch();
    return this.cloneObject(object);
  }

  updateLink(
    objectId: string,
    patch: Partial<StudioLinkData>
  ): StudioObject | null {
    const object = this.objects.get(objectId);
    if (!object || object.type !== 'link' || !object.link) {
      return null;
    }
    const kind = patch.kind ?? object.link.kind;
    const url = patch.url !== undefined
      ? patch.url.trim().slice(0, 2048)
      : object.link.url;
    const targetPageRaw = patch.targetPage ?? object.link.targetPage;
    const targetPage = Number.isFinite(targetPageRaw)
      ? Math.max(1, Math.floor(targetPageRaw))
      : object.link.targetPage;
    const updated: StudioObject = {
      ...object,
      link: { kind, url, targetPage }
    };
    this.objects.set(objectId, updated);
    this.touch();
    return this.cloneObject(updated);
  }

  /** F7.2 — Create a page-anchored comment marker. */
  createCommentObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number,
    author = 'You'
  ): StudioObject {

    const size = 0.042;
    const now = Date.now();
    const bounds: StudioObjectBounds = {
      x: this.clamp(normalizedX - size / 2, 0, 1 - size),
      y: this.clamp(normalizedY - size / 2, 0, 1 - size),
      width: size,
      height: size
    };

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'comment',
      bounds,
      comment: {
        content: '',
        author: author.trim() || 'You',
        createdAt: now,
        updatedAt: now,
        resolved: false
      }
    };

    this.objects.set(object.id, object);
    this.touch();
    return this.cloneObject(object);
  }

  updateComment(
    objectId: string,
    patch: Partial<Pick<StudioCommentData, 'content' | 'resolved' | 'author'>>
  ): StudioObject | null {
    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'comment' ||
      !object.comment
    ) {
      return null;
    }

    const current =
      object.comment;

    const nextContent =
      patch.content !== undefined
        ? patch.content.slice(0, 4000)
        : current.content;

    const nextAuthor =
      patch.author !== undefined
        ? (patch.author.trim() || 'You').slice(0, 120)
        : current.author;

    const nextResolved =
      patch.resolved !== undefined
        ? patch.resolved
        : current.resolved;

    /**
     * Semantic no-ops must not refresh updatedAt or touch the reactive object
     * store. Re-saving unchanged text or resolving an already resolved comment
     * should not manufacture a new object mutation.
     */
    if (
      nextContent === current.content &&
      nextAuthor === current.author &&
      nextResolved === current.resolved
    ) {
      return this.cloneObject(object);
    }

    const updated: StudioObject = {
      ...object,
      comment: {
        ...current,
        content: nextContent,
        author: nextAuthor,
        resolved: nextResolved,
        updatedAt: Date.now()
      }
    };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return this.cloneObject(updated);
  }

  createTextObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number
  ): StudioObject {

    const width = 0.22;
    const height = 0.055;

    const bounds: StudioObjectBounds = {
      x: this.clamp(
        normalizedX,
        0,
        1 - width
      ),
      y: this.clamp(
        normalizedY,
        0,
        1 - height
      ),
      width,
      height
    };

    const object: StudioTextObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'text',
      bounds,
      text: '',
      textStyle: {
        ...DEFAULT_TEXT_STYLE
      }
    };

    this.objects.set(
      object.id,
      object
    );
    this.touch();

    return this.cloneObject(object);
  }

  createImageObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number,
    image: StudioImageData
  ): StudioObject {

    const maxDimension = 0.38;
    const sourceRatio =
      image.aspectRatio > 0
        ? image.aspectRatio
        : 1;

    let width = maxDimension;
    let height = width / sourceRatio;

    if (height > maxDimension) {
      height = maxDimension;
      width = height * sourceRatio;
    }

    width = Math.min(0.75, Math.max(0.06, width));
    height = Math.min(0.75, Math.max(0.06, height));

    const bounds: StudioObjectBounds = {
      x: this.clamp(
        normalizedX - width / 2,
        0,
        Math.max(0, 1 - width)
      ),
      y: this.clamp(
        normalizedY - height / 2,
        0,
        Math.max(0, 1 - height)
      ),
      width,
      height
    };

    const object: StudioImageObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'image',
      bounds,
      image
    };

    this.objects.set(
      object.id,
      object
    );

    this.touch();

    return this.cloneObject(object);
  }

  createShapeObject(
    pageNumber: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    kind: StudioShapeKind,
    style: StudioShapeStyle
  ): StudioObject {

    const normalized = this.normalizeDragBounds(
      startX,
      startY,
      endX,
      endY,
      0.02,
      0.02
    );

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'shape',
      bounds: normalized,
      shape: {
        kind,
        style: this.normalizeShapeStyle(style),
        points:
          (
            kind === 'line' ||
            kind === 'arrow'
          )
            ? [
                {
                  x: this.clamp(startX, 0, 1),
                  y: this.clamp(startY, 0, 1)
                },
                {
                  x: this.clamp(endX, 0, 1),
                  y: this.clamp(endY, 0, 1)
                }
              ]
            : undefined
      }
    };

    this.objects.set(object.id, object);
    this.touch();

    return this.cloneObject(object);
  }

  createDrawingObject(
    pageNumber: number,
    points: readonly StudioPoint[],
    style: StudioDrawingStyle,
    type: 'draw' | 'highlight'
  ): StudioObject | null {

    const normalizedPoints = this.normalizePoints(points);

    if (normalizedPoints.length < 2) {
      return null;
    }

    /**
     * Keep freehand/highlight bounds geometrically tight to the actual pointer
     * path. The SVG itself is allowed to render its round stroke caps outside
     * the tight geometry, so a fixed 0.004 page padding is unnecessary and
     * caused visible extra space at both ends of straight strokes.
     */
    const bounds = this.boundsFromPoints(
      normalizedPoints,
      0.0001
    );

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type,
      bounds,
      drawing: {
        points: normalizedPoints,
        style: this.normalizeDrawingStyle(style, type)
      }
    };

    this.objects.set(object.id, object);
    this.touch();

    return this.cloneObject(object);
  }

  updateShapeStyle(
    objectId: string,
    style: Partial<StudioShapeStyle>
  ): StudioObject | null {

    const object = this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'shape' ||
      !object.shape
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      shape: {
        ...object.shape,
        style: this.normalizeShapeStyle({
          ...object.shape.style,
          ...style
        })
      }
    };

    this.objects.set(objectId, updated);
    this.touch();

    return this.cloneObject(updated);
  }

  updateDrawingStyle(
    objectId: string,
    style: Partial<StudioDrawingStyle>
  ): StudioObject | null {

    const object = this.objects.get(objectId);

    if (
      !object ||
      (
        object.type !== 'draw' &&
        object.type !== 'highlight'
      ) ||
      !object.drawing
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      bounds: this.boundsFromPoints(
        object.drawing.points,
        0.0001
      ),
      drawing: {
        ...object.drawing,
        style: this.normalizeDrawingStyle(
          {
            ...object.drawing.style,
            ...style
          },
          object.type
        )
      }
    };

    this.objects.set(objectId, updated);
    this.touch();

    return this.cloneObject(updated);
  }

  duplicateObject(
    objectId: string
  ): StudioObject | null {

    const source =
      this.objects.get(objectId);

    if (!source) {
      return null;
    }

    const duplicatedBounds =
      this.normalizeBounds({
        ...source.bounds,
        x: source.bounds.x + 0.02,
        y: source.bounds.y + 0.02
      });

    const deltaX =
      duplicatedBounds.x - source.bounds.x;
    const deltaY =
      duplicatedBounds.y - source.bounds.y;

    const duplicated: StudioObject =
      (
        source.type === 'draw' ||
        source.type === 'highlight'
      ) && source.drawing
        ? {
            ...source,
            id: this.createObjectId(),
            bounds: duplicatedBounds,
            drawing: {
              ...source.drawing,
              points: this.offsetPoints(
                source.drawing.points,
                deltaX,
                deltaY
              )
            }
          }
        : source.type === 'shape' && source.shape?.points
          ? {
              ...source,
              id: this.createObjectId(),
              bounds: duplicatedBounds,
              shape: {
                ...source.shape,
                points: this.offsetPoints(
                  source.shape.points,
                  deltaX,
                  deltaY
                ) as [StudioPoint, StudioPoint]
              }
            }
          : {
              ...source,
              id: this.createObjectId(),
              bounds: duplicatedBounds
            };

    this.objects.set(
      duplicated.id,
      duplicated
    );

    this.touch();

    return this.cloneObject(duplicated);
  }

  updateImageData(
    objectId: string,
    image: StudioImageData
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'image'
    ) {
      return null;
    }

    if (object.pdfImage) {
      const updated: StudioPdfImageObject = {
        ...object,
        image,
        pdfImage: {
          ...object.pdfImage,
          replaced: true
        }
      };

      this.objects.set(objectId, updated);
      this.touch();
      return this.cloneObject(updated);
    }

    const updated: StudioImageObject = {
      ...object,
      image
    };

    this.objects.set(objectId, updated);
    this.touch();

    return this.cloneObject(updated);
  }

  clearImageData(objectId: string): StudioPdfImageObject | null {
    const object = this.objects.get(objectId);
    if (!object || object.type !== 'image' || !object.pdfImage) return null;

    const { image: _image, ...rest } = object;
    const updated: StudioPdfImageObject = {
      ...rest,
      pdfImage: { ...object.pdfImage, replaced: false }
    };

    this.objects.set(objectId, updated);
    this.touch();
    return this.cloneObject(updated);
  }

  updatePdfImage(
    objectId: string,
    patch: Partial<StudioPdfImageSource>
  ): StudioObject | null {
    const object = this.objects.get(objectId);
    if (!object || object.type !== 'image' || !object.pdfImage) return null;
    const updated: StudioObject = {
      ...object,
      pdfImage: { ...object.pdfImage, ...patch }
    };
    this.objects.set(objectId, updated);
    this.touch();
    return this.cloneObject(updated);
  }

  updateBounds(
    objectId: string,
    bounds: StudioObjectBounds
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (!object) {
      return null;
    }

    const normalizedBounds =
      this.normalizeBounds(bounds);

    const updated: StudioObject =
      (
        (
          object.type === 'draw' ||
          object.type === 'highlight'
        ) &&
        object.drawing
      )
        ? {
            ...object,
            bounds: normalizedBounds,
            drawing: {
              ...object.drawing,
              points: this.transformPointsToBounds(
                object.drawing.points,
                object.bounds,
                normalizedBounds
              )
            }
          }
        : (
            object.type === 'shape' &&
            object.shape?.points
          )
            ? {
                ...object,
                bounds: normalizedBounds,
                shape: {
                  ...object.shape,
                  points: this.transformPointsToBounds(
                    object.shape.points,
                    object.bounds,
                    normalizedBounds
                  ) as [
                    StudioPoint,
                    StudioPoint
                  ]
                }
              }
            : {
                ...object,
                bounds: normalizedBounds
              };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return this.cloneObject(updated);
  }

  updateText(
    objectId: string,
    text: string
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'text'
    ) {
      return null;
    }

    if (object.pdfText) {
      const updated: StudioPdfTextObject = {
        ...object,
        text,
        pdfText: {
          ...object.pdfText,
          edited: text !== object.pdfText.originalText
        }
      };

      this.objects.set(objectId, updated);
      this.touch();
      return this.cloneObject(updated);
    }

    const updated: StudioTextObject = {
      ...object,
      text
    };

    this.objects.set(objectId, updated);
    this.touch();

    return this.cloneObject(updated);
  }

  updateTextStyle(
    objectId: string,
    style: Partial<StudioTextStyle>
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'text'
    ) {
      return null;
    }

    const currentStyle =
      object.textStyle ??
      DEFAULT_TEXT_STYLE;

    // Existing PDF text owns immutable source typography. Generic Studio style
    // controls must not remap its font or size and destroy PDF fidelity.
    const sourceLocked =
      !!object.pdfText &&
      object.pdfText.typographyLocked !== false;

    const nextStyle: StudioTextStyle = {
      fontSize: sourceLocked
        ? currentStyle.fontSize
        : this.clamp(
            style.fontSize ??
              currentStyle.fontSize,
            0.006,
            0.12
          ),
      fontWeight: sourceLocked
        ? currentStyle.fontWeight
        : this.normalizeFontWeight(
            style.fontWeight ??
              currentStyle.fontWeight
          ),
      fontStyle: sourceLocked
        ? currentStyle.fontStyle
        : this.normalizeFontStyle(
            style.fontStyle ??
              currentStyle.fontStyle
          ),
      textAlign:
        this.normalizeTextAlign(
          style.textAlign ??
            currentStyle.textAlign
        ),
      fontFamily: sourceLocked
        ? currentStyle.fontFamily
        : this.normalizeFontFamily(
            style.fontFamily ?? currentStyle.fontFamily
          ),
      lineHeight: sourceLocked
        ? currentStyle.lineHeight
        : this.clamp(
            style.lineHeight ?? currentStyle.lineHeight,
            0.8,
            3
          ),
      letterSpacing: sourceLocked
        ? currentStyle.letterSpacing
        : this.clamp(
            style.letterSpacing ?? currentStyle.letterSpacing,
            -0.1,
            0.3
          ),
      color: this.normalizeHexColor(
        style.color ?? currentStyle.color
      )
    };

    const minimumHeightForFont =
      Math.min(1, nextStyle.fontSize * 1.6);

    const adjustedBounds: StudioObjectBounds =
      sourceLocked
        ? object.bounds
        : object.bounds.height < minimumHeightForFont
          ? this.normalizeBounds({
              ...object.bounds,
              height: minimumHeightForFont
            })
          : object.bounds;

    const updated: StudioObject = {
      ...object,
      bounds: adjustedBounds,
      textStyle: nextStyle
    };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return this.cloneObject(updated);
  }

  remove(
    objectId: string
  ): boolean {

    const removed = this.objects.delete(
      objectId
    );

    if (removed) {
      this.touch();
    }

    return removed;
  }

  clearPage(
    pageNumber: number
  ): void {

    let changed = false;

    for (
      const [
        id,
        object
      ] of this.objects
    ) {

      if (
        object.pageNumber === pageNumber
      ) {
        this.objects.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.touch();
    }
  }

  remapPageNumbers(mapping: ReadonlyMap<number, number>): void {
    let changed = false;

    for (const [id, object] of this.objects) {
      const pageNumber = mapping.get(object.pageNumber);
      const nextPageNumber = pageNumber ?? object.pageNumber;

      if (object.type === 'link') {
        const nextTargetPage =
          mapping.get(object.link.targetPage) ?? object.link.targetPage;

        if (
          nextPageNumber !== object.pageNumber ||
          nextTargetPage !== object.link.targetPage
        ) {
          const updated: StudioLinkObject = {
            ...object,
            pageNumber: nextPageNumber,
            link: {
              ...object.link,
              targetPage: nextTargetPage
            }
          };
          this.objects.set(id, updated);
          changed = true;
        }
        continue;
      }

      if (nextPageNumber !== object.pageNumber) {
        this.objects.set(id, {
          ...object,
          pageNumber: nextPageNumber
        });
        changed = true;
      }
    }

    if (changed) this.touch();
  }

  duplicatePage(sourcePageNumber: number,targetPageNumber: number): void {

  const sourceObjects = this.listForPage(sourcePageNumber);
  for (const source of sourceObjects) {

    const clone: StudioObject = {
      ...structuredClone(source),
      id: this.createObjectId(),
      pageNumber: targetPageNumber
    };

    this.objects.set(clone.id,clone);
  }

  if (sourceObjects.length) {
    this.touch();
  }
}

  shiftPageNumbers(startPageNumber: number, delta: number): void {
    if (!delta) return;

    let changed = false;

    for (const [id, object] of this.objects) {
      const nextPageNumber =
        object.pageNumber >= startPageNumber
          ? object.pageNumber + delta
          : object.pageNumber;

      if (object.type === 'link') {
        const nextTargetPage =
          object.link.targetPage >= startPageNumber
            ? Math.max(1, object.link.targetPage + delta)
            : object.link.targetPage;

        if (
          nextPageNumber !== object.pageNumber ||
          nextTargetPage !== object.link.targetPage
        ) {
          const updated: StudioLinkObject = {
            ...object,
            pageNumber: nextPageNumber,
            link: {
              ...object.link,
              targetPage: nextTargetPage
            }
          };
          this.objects.set(id, updated);
          changed = true;
        }
        continue;
      }

      if (nextPageNumber !== object.pageNumber) {
        this.objects.set(id, {
          ...object,
          pageNumber: nextPageNumber
        });
        changed = true;
      }
    }

    if (changed) this.touch();
  }

  clearAll(): void {
    if (this.objects.size === 0) {
      return;
    }

    this.objects.clear();
    this.touch();
  }


  private offsetPoints(
    points: readonly StudioPoint[],
    deltaX: number,
    deltaY: number
  ): readonly StudioPoint[] {
    return points.map(point => ({
      x: this.clamp(point.x + deltaX, 0, 1),
      y: this.clamp(point.y + deltaY, 0, 1)
    }));
  }

  private normalizeDragBounds(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    minWidth: number,
    minHeight: number
  ): StudioObjectBounds {

    const width = Math.max(
      minWidth,
      Math.abs(endX - startX)
    );

    const height = Math.max(
      minHeight,
      Math.abs(endY - startY)
    );

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);

    return this.normalizeBounds({
      x,
      y,
      width,
      height
    });
  }

  private normalizePoints(
    points: readonly StudioPoint[]
  ): readonly StudioPoint[] {

    const finite = points
      .filter(
        point =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
      )
      .map(
        point => ({
          x: this.clamp(point.x, 0, 1),
          y: this.clamp(point.y, 0, 1)
        })
      );

    return finite;
  }

  private boundsFromPoints(
    points: readonly StudioPoint[],
    padding: number
  ): StudioObjectBounds {

    if (!points.length) {
      return {
        x: 0,
        y: 0,
        width: 0.0001,
        height: 0.0001
      };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const width = Math.max(
      0.0001,
      maxX - minX + padding * 2
    );

    const height = Math.max(
      0.0001,
      maxY - minY + padding * 2
    );

    return this.normalizeBounds({
      x: minX - padding,
      y: minY - padding,
      width,
      height
    });
  }

  private transformPointsToBounds(
    points: readonly StudioPoint[],
    oldBounds: StudioObjectBounds,
    newBounds: StudioObjectBounds
  ): readonly StudioPoint[] {

    return points.map(point => {
      const localX =
        oldBounds.width > 0
          ? (point.x - oldBounds.x) / oldBounds.width
          : 0.5;

      const localY =
        oldBounds.height > 0
          ? (point.y - oldBounds.y) / oldBounds.height
          : 0.5;

      return {
        x: this.clamp(
          newBounds.x +
            localX * newBounds.width,
          0,
          1
        ),
        y: this.clamp(
          newBounds.y +
            localY * newBounds.height,
          0,
          1
        )
      };
    });
  }

  private normalizeShapeStyle(
    style: StudioShapeStyle
  ): StudioShapeStyle {

    return {
      strokeColor:
        this.normalizeColor(
          style.strokeColor,
          '#00d4b3'
        ),
      fillColor:
        style.fillColor
          ? this.normalizeColor(
              style.fillColor,
              '#00d4b3'
            )
          : null,
      strokeWidth:
        this.clamp(
          style.strokeWidth,
          0.001,
          0.03
        ),
      opacity:
        this.clamp(
          style.opacity,
          0.05,
          1
        )
    };
  }

  private normalizeDrawingStyle(
    style: StudioDrawingStyle,
    type: 'draw' | 'highlight'
  ): StudioDrawingStyle {

    return {
      strokeColor:
        this.normalizeColor(
          style.strokeColor,
          type === 'highlight'
            ? '#f4d03f'
            : '#00d4b3'
        ),
      strokeWidth:
        this.clamp(
          style.strokeWidth,
          0.001,
          0.05
        ),
      opacity:
        this.clamp(
          style.opacity,
          0.05,
          1
        )
    };
  }

  private cloneObject<T extends StudioObject>(
    object: T
  ): T {

    return JSON.parse(
      JSON.stringify(object)
    ) as T;
  }

  private normalizeColor(
    value: string,
    fallback: string
  ): string {

    if (
      typeof value !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(value.trim())
    ) {
      return fallback;
    }

    return value.trim().toLowerCase();
  }

  private normalizeBounds(
    bounds: StudioObjectBounds
  ): StudioObjectBounds {

    const width =
      this.clamp(
        bounds.width,
        0.0001,
        1
      );

    const height =
      this.clamp(
        bounds.height,
        0.0001,
        1
      );

    return {
      x: this.clamp(
        bounds.x,
        0,
        Math.max(
          0,
          1 - width
        )
      ),
      y: this.clamp(
        bounds.y,
        0,
        Math.max(
          0,
          1 - height
        )
      ),
      width,
      height
    };
  }


  private normalizeFontFamily(
    value: StudioTextFontFamily | undefined
  ): StudioTextFontFamily {
    return value === 'Times Roman' || value === 'Courier' ? value : 'Helvetica';
  }

  private normalizeHexColor(value: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#101820';
  }

  private normalizeTextAlign(
    value: StudioTextAlign
  ): StudioTextAlign {

    return (
      value === 'center' ||
      value === 'right'
        ? value
        : 'left'
    );
  }

  private normalizeFontWeight(
    value: StudioTextFontWeight
  ): StudioTextFontWeight {

    return (
      value === 700
        ? 700
        : 400
    );
  }

  private normalizeFontStyle(
    value: StudioTextFontStyle
  ): StudioTextFontStyle {

    return (
      value === 'italic'
        ? 'italic'
        : 'normal'
    );
  }

  private clamp(
    value: number,
    min: number,
    max: number
  ): number {

    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.min(
      max,
      Math.max(
        min,
        value
      )
    );
  }

  private touch(): void {
    this.revision.update((value: number) => value + 1);
  }

  private createObjectId(): string {

    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `studio-object-${crypto.randomUUID()}`;
    }

    return (
      `studio-object-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );
  }
}

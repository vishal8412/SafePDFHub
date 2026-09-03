import {
  Injectable
} from '@angular/core';

import type {
  PDFDocumentProxy
} from 'pdfjs-dist';


interface ActiveThumbnailRender {
  cancel: () => void;
  pdfId: number;
}


interface CachedThumbnail {
  width: number;
  height: number;
  bitmap: ImageBitmap;
  lastUsed: number;
}


/**
 * Thumbnail rendering service.
 *
 * Responsibilities:
 *
 * - Render PDF pages as thumbnails.
 * - Prevent duplicate PDF.js renders on the same canvas.
 * - Cancel stale canvas renders.
 * - Cache recently rendered thumbnails.
 * - Keep cache bounded with LRU eviction.
 */
@Injectable({
  providedIn: 'root'
})
export class ThumbnailService {

  /**
   * ----------------------------------------------------------
   * ACTIVE RENDER TRACKING
   * ----------------------------------------------------------
   *
   * One active PDF.js render per thumbnail canvas.
   */
  private readonly activeRenders =
    new WeakMap<
      HTMLCanvasElement,
      ActiveThumbnailRender
    >();

  /**
   * Iterable companion index used only for document-level
   * invalidation so every in-flight render for one PDF can
   * be cancelled during replacement/close.
   */
  private readonly activeCanvasesByPdf =
    new Map<number, Set<HTMLCanvasElement>>();


  /**
   * ----------------------------------------------------------
   * PDF ID REGISTRY
   * ----------------------------------------------------------
   *
   * PDFDocumentProxy objects do not expose a guaranteed
   * application-level ID.
   *
   * Therefore we assign each PDF instance a stable internal ID.
   */
  private readonly pdfIds =
    new WeakMap<
      PDFDocumentProxy,
      number
    >();

  /**
 * Iterable PDF registry used only for global
 * cache invalidation.
 */
private readonly registeredPdfs = new Set<PDFDocumentProxy>();  

  /**
   * Generation token used to invalidate stale asynchronous
   * thumbnail work after a PDF is replaced or closed.
   */
  private readonly pdfGenerations =
    new WeakMap<
      PDFDocumentProxy,
      number
    >();


  private nextPdfId = 1;


  /**
   * ----------------------------------------------------------
   * THUMBNAIL CACHE
   * ----------------------------------------------------------
   *
   * Cache key:
   *
   *   pdfId + pageNumber + targetWidth
   *
   * This prevents:
   *
   *   PDF A / page 10
   *
   * from ever colliding with:
   *
   *   PDF B / page 10
   *
   * or:
   *
   *   page 10 / width 168
   *
   * with:
   *
   *   page 10 / width 220
   */
  private readonly cache =
    new Map<
      string,
      CachedThumbnail
    >();


  /**
   * Maximum number of cached thumbnails.
   *
   * Keep this bounded because very large PDFs can contain
   * hundreds or thousands of pages.
   */
  private readonly MAX_CACHE_ENTRIES = 60;


  /**
   * Maximum DPR for thumbnail rendering.
   */
  private readonly MAX_DPR = 2;


  /**
   * ----------------------------------------------------------
   * RENDER THUMBNAIL
   * ----------------------------------------------------------
   */
  async renderThumbnail(
    pdf: PDFDocumentProxy,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    targetWidth = 168,
    rotation: 0 | 90 | 180 | 270 = 0
  ): Promise<void> {

    /**
     * Always cancel a render currently using this canvas.
     */
    this.cancel(canvas);


    /**
     * Validate page number before doing any work.
     */
    if (
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    ) {
      throw new RangeError(
        `Invalid thumbnail page number: ${pageNumber}`
      );
    }


    /**
     * Normalize requested width.
     */
    const safeTargetWidth =
      Math.max(
        96,
        Math.min(
          targetWidth,
          220
        )
      );


    /**
     * --------------------------------------------------------
     * CACHE LOOKUP
     * --------------------------------------------------------
     */
    const cacheKey =
      this.createCacheKey(
        pdf,
        pageNumber,
        safeTargetWidth,
        rotation
      );

    const pdfGeneration =
      this.getPdfGeneration(pdf);


    const cached =
      this.cache.get(cacheKey);


    if (cached) {

      /**
       * Refresh LRU timestamp.
       */
      cached.lastUsed =
        Date.now();


      /**
       * Draw the cached bitmap.
       */
      this.drawCachedThumbnail(
        cached,
        canvas
      );

      return;
    }


    /**
     * --------------------------------------------------------
     * FIRST RENDER
     * --------------------------------------------------------
     */
    const page =
      await pdf.getPage(pageNumber);

    // The PDF may have been replaced or closed while getPage()
    // was awaiting. Do not continue stale work.
    if (
      !this.isPdfGenerationCurrent(
        pdf,
        pdfGeneration
      )
    ) {
      return;
    }


    try {

      const baseViewport =
        page.getViewport({
          scale: 1,
          rotation
        });


      const scale =
        safeTargetWidth /
        baseViewport.width;


      const viewport =
        page.getViewport({
          scale,
          rotation
        });


      const outputScale =
        this.getDevicePixelRatio();


      const context =
        canvas.getContext(
          '2d',
          {
            alpha: false
          }
        );


      if (!context) {
        throw new Error(
          'Unable to create thumbnail canvas context.'
        );
      }


      /**
       * Physical bitmap dimensions.
       */
      canvas.width =
        Math.max(
          1,
          Math.ceil(
            viewport.width *
            outputScale
          )
        );


      canvas.height =
        Math.max(
          1,
          Math.ceil(
            viewport.height *
            outputScale
          )
        );


      /**
       * Logical CSS dimensions.
       */
      canvas.style.width =
        `${Math.ceil(viewport.width)}px`;


      canvas.style.height =
        `${Math.ceil(viewport.height)}px`;


      /**
       * Reset previous drawing state.
       */
      context.setTransform(
        1,
        0,
        0,
        1,
        0,
        0
      );


      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );


      /**
       * PDF.js HiDPI transform.
       */
      const transform =
        outputScale !== 1
          ? [
              outputScale,
              0,
              0,
              outputScale,
              0,
              0
            ]
          : undefined;


      /**
       * Start PDF.js rendering.
       */
      const renderTask =
        page.render({
          canvasContext: context,
          viewport,
          transform
        });


      /**
       * Track the active render for this canvas.
       */
      const pdfId =
        this.getPdfId(pdf);

      const activeRender: ActiveThumbnailRender = {
        cancel: () => renderTask.cancel(),
        pdfId
      };

      this.activeRenders.set(
        canvas,
        activeRender
      );

      let activePdfCanvases =
        this.activeCanvasesByPdf.get(pdfId);

      if (!activePdfCanvases) {
        activePdfCanvases = new Set<HTMLCanvasElement>();
        this.activeCanvasesByPdf.set(
          pdfId,
          activePdfCanvases
        );
      }

      activePdfCanvases.add(canvas);


      try {

        await renderTask.promise;

      } catch (
        error: unknown
      ) {

        /**
         * A render cancelled because another render started
         * is normal lifecycle behavior.
         */
        if (
          this.isRenderCancellation(
            error
          )
        ) {
          return;
        }

        throw error;

      } finally {

        const active =
          this.activeRenders.get(canvas);

        // Only clean up the PDF index if this render still owns
        // the canvas. A newer render may already have replaced it.
        if (active === activeRender) {
          this.activeRenders.delete(canvas);

          const canvases =
            this.activeCanvasesByPdf.get(pdfId);

          canvases?.delete(canvas);

          if (canvases?.size === 0) {
            this.activeCanvasesByPdf.delete(pdfId);
          }
        }
      }


      /**
       * ------------------------------------------------------
       * CACHE THE FINISHED THUMBNAIL
       * ------------------------------------------------------
       *
       * Convert the rendered canvas into an ImageBitmap.
       *
       * ImageBitmap is much safer for reuse than storing the
       * original HTML canvas element.
       */
      const bitmap =
        await this.createBitmap(
          canvas
        );


      if (!bitmap) {
        return;
      }

      // createImageBitmap() is asynchronous too. Discard the bitmap
      // if this PDF was invalidated while it was being created.
      if (
        !this.isPdfGenerationCurrent(
          pdf,
          pdfGeneration
        )
      ) {
        bitmap.close();
        return;
      }


      /**
       * Replace an existing entry if necessary.
       */
      const previous =
        this.cache.get(
          cacheKey
        );


      previous?.bitmap.close();


      this.cache.set(
        cacheKey,
        {
          width:
            Math.ceil(
              viewport.width
            ),

          height:
            Math.ceil(
              viewport.height
            ),

          bitmap,

          lastUsed:
            Date.now()
        }
      );


      /**
       * Keep the cache bounded.
       */
      this.evictOldEntries();

    } finally {

      page.cleanup();
    }
  }


  /**
   * ----------------------------------------------------------
   * DRAW CACHED THUMBNAIL
   * ----------------------------------------------------------
   */
  private drawCachedThumbnail(
    cached: CachedThumbnail,
    canvas: HTMLCanvasElement
  ): void {

    canvas.width =
      Math.max(
        1,
        Math.ceil(
          cached.width *
          this.getDevicePixelRatio()
        )
      );


    canvas.height =
      Math.max(
        1,
        Math.ceil(
          cached.height *
          this.getDevicePixelRatio()
        )
      );


    canvas.style.width =
      `${cached.width}px`;


    canvas.style.height =
      `${cached.height}px`;


    const context =
      canvas.getContext(
        '2d',
        {
          alpha: false
        }
      );


    if (!context) {
      throw new Error(
        'Unable to create cached thumbnail canvas context.'
      );
    }


    context.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );


    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    const dpr =
      this.getDevicePixelRatio();


    context.drawImage(
      cached.bitmap,
      0,
      0,
      cached.width * dpr,
      cached.height * dpr
    );
  }


  /**
   * ----------------------------------------------------------
   * CREATE IMAGE BITMAP
   * ----------------------------------------------------------
   */
  private async createBitmap(
    canvas: HTMLCanvasElement
  ): Promise<ImageBitmap | null> {

    if (
      typeof createImageBitmap !==
      'function'
    ) {
      return null;
    }


    try {

      return await createImageBitmap(
        canvas
      );

    } catch {

      return null;
    }
  }


  /**
   * ----------------------------------------------------------
   * CACHE KEY
   * ----------------------------------------------------------
   */
  private createCacheKey(
    pdf: PDFDocumentProxy,
    pageNumber: number,
    targetWidth: number,
    rotation: 0 | 90 | 180 | 270
  ): string {

    const pdfId =
      this.getPdfId(pdf);


    return [
      pdfId,
      pageNumber,
      targetWidth,
      rotation
    ].join(':');
  }


  /**
   * ----------------------------------------------------------
   * PDF GENERATION
   * ----------------------------------------------------------
   */
  private getPdfGeneration(
    pdf: PDFDocumentProxy
  ): number {
    const existing =
      this.pdfGenerations.get(pdf);

    if (existing !== undefined) {
      return existing;
    }

    this.pdfGenerations.set(pdf, 0);
    return 0;
  }

  private isPdfGenerationCurrent(
    pdf: PDFDocumentProxy,
    generation: number
  ): boolean {
    return (
      this.getPdfGeneration(pdf) ===
      generation
    );
  }


  /**
   * ----------------------------------------------------------
   * PDF ID
   * ----------------------------------------------------------
   */
  private getPdfId(pdf: PDFDocumentProxy): number {

  const existing = this.pdfIds.get(pdf);

  if (existing) {
    return existing;
  }

  const id = this.nextPdfId++;

  this.pdfIds.set(pdf,id);

  this.registeredPdfs.add(pdf);

  return id;
}


  /**
   * ----------------------------------------------------------
   * LRU EVICTION
   * ----------------------------------------------------------
   */
  private evictOldEntries(): void {

    while (
      this.cache.size >
      this.MAX_CACHE_ENTRIES
    ) {

      let oldestKey:
        string | null = null;

      let oldestTime =
        Number.POSITIVE_INFINITY;


      for (
        const [
          key,
          entry
        ] of this.cache
      ) {

        if (
          entry.lastUsed <
          oldestTime
        ) {

          oldestTime =
            entry.lastUsed;

          oldestKey =
            key;
        }
      }


      if (
        oldestKey === null
      ) {
        return;
      }


      const oldest =
        this.cache.get(
          oldestKey
        );


      oldest?.bitmap.close();


      this.cache.delete(
        oldestKey
      );
    }
  }


  /**
   * ----------------------------------------------------------
   * CANCEL ACTIVE RENDER
   * ----------------------------------------------------------
   */
  cancel(
    canvas: HTMLCanvasElement
  ): void {

    const render =
      this.activeRenders.get(
        canvas
      );


    if (!render) {
      return;
    }


    try {

      render.cancel();

    } finally {

      this.activeRenders.delete(
        canvas
      );

      const canvases =
        this.activeCanvasesByPdf.get(
          render.pdfId
        );

      canvases?.delete(canvas);

      if (canvases?.size === 0) {
        this.activeCanvasesByPdf.delete(
          render.pdfId
        );
      }
    }
  }


  /**
   * ----------------------------------------------------------
   * CLEAR CANVAS
   * ----------------------------------------------------------
   *
   * Important:
   *
   * clear() clears the visual canvas only.
   *
   * It intentionally does NOT clear the thumbnail cache.
   *
   * This allows a thumbnail to be destroyed and recreated
   * without forcing PDF.js to render the page again.
   */
  clear(
    canvas: HTMLCanvasElement
  ): void {

    this.cancel(canvas);


    const context =
      canvas.getContext(
        '2d'
      );


    if (context) {

      context.setTransform(
        1,
        0,
        0,
        1,
        0,
        0
      );


      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }


    canvas.width = 0;
    canvas.height = 0;


    canvas.style.width = '0';
    canvas.style.height = '0';
  }


  /**
   * ----------------------------------------------------------
   * CLEAR ONE PDF CACHE
   * ----------------------------------------------------------
   *
   * Used when a document is replaced or closed. It invalidates
   * cached thumbnails, cancels in-flight renders, and advances
   * the generation token so late async completions are ignored.
   */
  clearPdf(
  pdf: PDFDocumentProxy
): void {

  const pdfId =
    this.getPdfId(pdf);

  const currentGeneration =
    this.getPdfGeneration(pdf);

  this.pdfGenerations.set(
    pdf,
    currentGeneration + 1
  );

  const canvases =
    this.activeCanvasesByPdf.get(
      pdfId
    );

  if (canvases) {

    for (
      const canvas of Array.from(canvases)
    ) {
      this.cancel(canvas);
    }

    this.activeCanvasesByPdf.delete(
      pdfId
    );
  }

  const prefix =
    `${pdfId}:`;

  for (
    const [
      key,
      entry
    ] of this.cache
  ) {

    if (!key.startsWith(prefix)) {
      continue;
    }

    entry.bitmap.close();

    this.cache.delete(
      key
    );
  }

  this.registeredPdfs.delete(
    pdf
  );
}


  /**
   * ----------------------------------------------------------
   * CLEAR ALL CACHE
   * ----------------------------------------------------------
   *
   * Useful when a completely new document replaces the old
   * document and we deliberately want to release all cached
   * thumbnail memory.
   */
  clearCache(): void {

  /**
   * Invalidate every registered PDF first.
   *
   * This prevents asynchronous thumbnail renders
   * from repopulating the cache after the reset.
   */
  for (
    const pdf of Array.from(
      this.registeredPdfs
    )
  ) {

    const currentGeneration =
      this.getPdfGeneration(pdf);

    this.pdfGenerations.set(
      pdf,
      currentGeneration + 1
    );

    const pdfId =
      this.getPdfId(pdf);

    const canvases =
      this.activeCanvasesByPdf.get(
        pdfId
      );

    if (canvases) {

      for (
        const canvas of Array.from(
          canvases
        )
      ) {
        this.cancel(canvas);
      }

      this.activeCanvasesByPdf.delete(
        pdfId
      );
    }
  }

  /**
   * Release every cached ImageBitmap.
   */
  for (
    const entry of this.cache.values()
  ) {

    entry.bitmap.close();
  }

  this.cache.clear();
}


  /**
   * ----------------------------------------------------------
   * SAFE DPR
   * ----------------------------------------------------------
   */
  private getDevicePixelRatio(): number {

    if (
      typeof window ===
      'undefined'
    ) {
      return 1;
    }


    return Math.min(
      Math.max(
        window.devicePixelRatio || 1,
        1
      ),
      this.MAX_DPR
    );
  }


  /**
   * ----------------------------------------------------------
   * PDF.js CANCELLATION DETECTION
   * ----------------------------------------------------------
   */
  private isRenderCancellation(
    error: unknown
  ): boolean {

    if (
      !error ||
      typeof error !==
      'object'
    ) {
      return false;
    }


    const name =
      'name' in error
        ? String(
            (
              error as {
                name?: unknown
              }
            ).name
          )
        : '';


    return (
      name ===
      'RenderingCancelledException'
    );
  }
}
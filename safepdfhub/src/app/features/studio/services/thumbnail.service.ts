import {
  Injectable
} from '@angular/core';

import type {
  PDFDocumentProxy
} from 'pdfjs-dist';


interface ActiveThumbnailRender {
  cancel: () => void;
  pdfId: number;
  requestVersion: number;
}


interface CachedThumbnail {
  width: number;
  height: number;
  bytes: number;
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
   * Per-canvas request ownership.
   *
   * A render can still be awaiting pdf.getPage() before a PDF.js render task
   * exists. This token prevents that older request from starting later on the
   * same canvas after a newer request has already taken ownership.
   */
  private readonly canvasRequestVersions =
    new WeakMap<
      HTMLCanvasElement,
      number
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
   * Approximate memory ceiling for cached ImageBitmaps.
   *
   * Entry-count limits alone are not sufficient because one large rotated
   * thumbnail can consume far more memory than another entry.
   */
  private readonly MAX_CACHE_BYTES =
    96 * 1024 * 1024;

  private cacheBytes = 0;


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
     * Every call immediately takes ownership of the canvas.
     *
     * This must happen before awaiting pdf.getPage(). Otherwise an older call
     * that is still waiting for getPage() could start rendering after a newer
     * call already owns the same canvas.
     */
    const requestVersion =
      this.beginCanvasRequest(canvas);

    /**
     * Cancel any active PDF.js render that already owns this canvas.
     */
    this.cancel(canvas);

    if (
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    ) {
      throw new RangeError(
        `Invalid thumbnail page number: ${pageNumber}`
      );
    }

    const safeTargetWidth =
      Math.max(
        96,
        Math.min(
          targetWidth,
          220
        )
      );

    const cacheKey =
      this.createCacheKey(
        pdf,
        pageNumber,
        safeTargetWidth,
        rotation
      );

    const pdfGeneration =
      this.getPdfGeneration(pdf);

    if (
      !this.isCanvasRequestCurrent(
        canvas,
        requestVersion
      )
    ) {
      return;
    }

    const cached =
      this.cache.get(cacheKey);

    if (cached) {

      if (
        !this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        return;
      }

      cached.lastUsed =
        Date.now();

      try {
        this.drawCachedThumbnail(
          cached,
          canvas
        );
      } catch (error: unknown) {
        /**
         * A bitmap can become unusable if the browser releases its backing
         * resource. Remove only this bad entry and fall through to a fresh
         * PDF.js render.
         */
        this.removeCacheEntry(cacheKey);

        if (
          !this.isCanvasRequestCurrent(
            canvas,
            requestVersion
          )
        ) {
          return;
        }
      }

      if (
        this.cache.has(cacheKey) &&
        this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        return;
      }
    }

    const page =
      await pdf.getPage(pageNumber);

    if (
      !this.isPdfGenerationCurrent(
        pdf,
        pdfGeneration
      ) ||
      !this.isCanvasRequestCurrent(
        canvas,
        requestVersion
      )
    ) {
      page.cleanup();
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

      if (
        !this.isPdfGenerationCurrent(
          pdf,
          pdfGeneration
        ) ||
        !this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        return;
      }

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

      canvas.style.width =
        `${Math.ceil(viewport.width)}px`;

      canvas.style.height =
        `${Math.ceil(viewport.height)}px`;

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

      const renderTask =
        page.render({
          canvasContext: context,
          viewport,
          transform
        });

      const pdfId =
        this.getPdfId(pdf);

      const activeRender: ActiveThumbnailRender = {
        cancel: () => renderTask.cancel(),
        pdfId,
        requestVersion
      };

      /**
       * A newer request can arrive between renderTask creation and tracking.
       * Do not let this stale task become the active owner.
       */
      if (
        !this.isPdfGenerationCurrent(
          pdf,
          pdfGeneration
        ) ||
        !this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        renderTask.cancel();
        return;
      }

      this.activeRenders.set(
        canvas,
        activeRender
      );

      let activePdfCanvases =
        this.activeCanvasesByPdf.get(pdfId);

      if (!activePdfCanvases) {
        activePdfCanvases =
          new Set<HTMLCanvasElement>();

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

        if (
          active === activeRender
        ) {
          this.activeRenders.delete(canvas);

          const canvases =
            this.activeCanvasesByPdf.get(pdfId);

          canvases?.delete(canvas);

          if (
            canvases?.size === 0
          ) {
            this.activeCanvasesByPdf.delete(pdfId);
          }
        }
      }

      if (
        !this.isPdfGenerationCurrent(
          pdf,
          pdfGeneration
        ) ||
        !this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        return;
      }

      const bitmap =
        await this.createBitmap(canvas);

      if (!bitmap) {
        return;
      }

      if (
        !this.isPdfGenerationCurrent(
          pdf,
          pdfGeneration
        ) ||
        !this.isCanvasRequestCurrent(
          canvas,
          requestVersion
        )
      ) {
        bitmap.close();
        return;
      }

      this.setCacheEntry(
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

          bytes:
            this.estimateBitmapBytes(
              bitmap
            ),

          bitmap,

          lastUsed:
            Date.now()
        }
      );

      this.evictOldEntries();

    } finally {

      page.cleanup();
    }
  }


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
   * CANVAS REQUEST OWNERSHIP
   * ----------------------------------------------------------
   */
  private beginCanvasRequest(
    canvas: HTMLCanvasElement
  ): number {

    const next =
      (this.canvasRequestVersions.get(canvas) ?? 0) +
      1;

    this.canvasRequestVersions.set(
      canvas,
      next
    );

    return next;
  }

  private isCanvasRequestCurrent(
    canvas: HTMLCanvasElement,
    requestVersion: number
  ): boolean {
    return (
      this.canvasRequestVersions.get(canvas) ===
      requestVersion
    );
  }


  /**
   * ----------------------------------------------------------
   * CACHE MEMORY ACCOUNTING
   * ----------------------------------------------------------
   */
  private estimateBitmapBytes(
    bitmap: ImageBitmap
  ): number {

    return (
      Math.max(
        1,
        bitmap.width
      ) *
      Math.max(
        1,
        bitmap.height
      ) *
      4
    );
  }

  private setCacheEntry(
    key: string,
    entry: CachedThumbnail
  ): void {

    const previous =
      this.cache.get(key);

    if (previous) {
      this.cacheBytes =
        Math.max(
          0,
          this.cacheBytes -
          previous.bytes
        );

      this.closeBitmap(
        previous.bitmap
      );
    }

    this.cache.set(
      key,
      entry
    );

    this.cacheBytes +=
      entry.bytes;
  }

  private removeCacheEntry(
    key: string
  ): void {

    const entry =
      this.cache.get(key);

    if (!entry) {
      return;
    }

    this.cache.delete(key);

    this.cacheBytes =
      Math.max(
        0,
        this.cacheBytes -
        entry.bytes
      );

    this.closeBitmap(
      entry.bitmap
    );
  }

  private closeBitmap(
    bitmap: ImageBitmap
  ): void {

    try {
      bitmap.close();
    } catch {
      /**
       * ImageBitmap.close() is best-effort cleanup.
       */
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
        this.MAX_CACHE_ENTRIES ||
      this.cacheBytes >
        this.MAX_CACHE_BYTES
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

      this.removeCacheEntry(
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
      this.activeCanvasesByPdf.get(pdfId);

    if (canvases) {

      for (
        const canvas of Array.from(
          canvases
        )
      ) {
        /**
         * Invalidate pre-render ownership too, not only active PDF.js tasks.
         */
        this.beginCanvasRequest(canvas);
        this.cancel(canvas);
      }

      this.activeCanvasesByPdf.delete(pdfId);
    }

    const prefix =
      `${pdfId}:`;

    for (
      const key of Array.from(
        this.cache.keys()
      )
    ) {
      if (
        key.startsWith(prefix)
      ) {
        this.removeCacheEntry(key);
      }
    }

    this.registeredPdfs.delete(pdf);
  }


  /**
   * ----------------------------------------------------------
   * CLEAR ALL CACHE
   * ----------------------------------------------------------
   */
  clearCache(): void {

    /**
     * Invalidate every known PDF first so asynchronous getPage(),
     * renderTask and createImageBitmap completions become non-authoritative.
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
    }

    /**
     * Invalidate every active canvas request before cancelling PDF.js tasks.
     */
    for (
      const [
        pdfId,
        canvases
      ] of Array.from(
        this.activeCanvasesByPdf.entries()
      )
    ) {

      for (
        const canvas of Array.from(
          canvases
        )
      ) {
        this.beginCanvasRequest(canvas);
        this.cancel(canvas);
      }

      this.activeCanvasesByPdf.delete(pdfId);
    }

    for (
      const key of Array.from(
        this.cache.keys()
      )
    ) {
      this.removeCacheEntry(key);
    }

    this.cacheBytes = 0;

    /**
     * This Set is intentionally strong. Leaving old PDF proxies here would
     * retain replaced documents during a long session even after their cache
     * entries were released.
     */
    this.registeredPdfs.clear();
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
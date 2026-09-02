import {
  Injectable
} from '@angular/core';

import type {
  PDFDocumentProxy,
  PDFPageProxy
} from 'pdfjs-dist';

export interface RenderedPageSize {
  width: number;
  height: number;

  /** PDF.js display scale used for this render. */
  scale: number;
}

export interface RenderPageOptions {
  mode:
    | 'fit-page'
    | 'fit-width'
    | 'zoom';
  viewportWidth?: number;
  viewportHeight?: number;
  padding?: number;
  zoomPercent?: number;
}

interface ActiveRenderTask {
  promise: Promise<unknown>;
  cancel(extraDelay?: number): void;
}

interface CanvasRenderState {
  queue: Promise<void>;
  task?: ActiveRenderTask;
}

@Injectable({
  providedIn: 'root'
})
export class PdfPageRendererService {

  private readonly MAX_DPR = 2;

  /**
   * Each canvas gets its own tiny render coordinator.
   *
   * PDF.js explicitly rejects starting a second render
   * against the same canvas while the previous render is
   * still active. This coordinator serializes the work and
   * cancels the obsolete render when a newer request arrives.
   */
  private readonly canvasStates =
    new WeakMap<HTMLCanvasElement, CanvasRenderState>();

  async renderPage(
    pdf: PDFDocumentProxy,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    options: RenderPageOptions | number
  ): Promise<RenderedPageSize> {

    if (
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    ) {
      throw new RangeError(
        `Invalid PDF page number: ${pageNumber}`
      );
    }

    const state =
      this.getCanvasState(canvas);

    /*
     * Latest request wins.
     *
     * Cancel an active PDF.js render immediately.
     * The queued execution below will wait until that
     * cancelled task has fully settled before touching
     * the canvas again.
     */
    state.task?.cancel();

    const previousQueue =
      state.queue;

    let release!: () => void;

    const currentGate =
      new Promise<void>(resolve => {
        release = resolve;
      });

    state.queue =
      previousQueue.then(
        () => currentGate
      );

    await previousQueue;

    let page: PDFPageProxy | undefined;
    let renderTask: ActiveRenderTask | undefined;

    try {

      /*
       * If the previous render was cancelled, wait for
       * PDF.js to finish unwinding it before reusing the canvas.
       */
      if (state.task) {
        try {
          await state.task.promise;
        } catch (error: unknown) {
          if (!this.isRenderCancellation(error)) {
            throw error;
          }
        } finally {
          state.task = undefined;
        }
      }

      page =
        await pdf.getPage(pageNumber);

      const scale =
        this.resolveScale(
          page,
          options
        );

      const viewport =
        page.getViewport({
          scale,
          rotation: page.rotate
        });

      const outputScale =
        this.getDevicePixelRatio();

      const context =
        canvas.getContext('2d', {
          alpha: false
        });

      if (!context) {
        throw new Error(
          'Unable to create PDF canvas context.'
        );
      }

      canvas.width =
        Math.max(
          1,
          Math.floor(
            viewport.width *
            outputScale
          )
        );

      canvas.height =
        Math.max(
          1,
          Math.floor(
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

      renderTask =
        page.render({
          canvasContext: context,
          viewport,
          transform
        });

      state.task =
        renderTask;

      try {
        await renderTask.promise;
      } catch (error: unknown) {
        /*
         * A cancellation caused by a newer render request
         * is expected control flow, not an application error.
         */
        if (!this.isRenderCancellation(error)) {
          throw error;
        }
      } finally {
        if (state.task === renderTask) {
          state.task = undefined;
        }
      }

      return {
        width: viewport.width,
        height: viewport.height,
        scale
      };

    } finally {

      page?.cleanup();

      release();

      if (state.queue === currentGate) {
        state.queue =
          Promise.resolve();
      }
    }
  }

  clearCanvas(
    canvas: HTMLCanvasElement
  ): void {

    const state =
      this.canvasStates.get(canvas);

    state?.task?.cancel();

    const context =
      canvas.getContext('2d');

    if (!context) {
      return;
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

    canvas.width = 0;
    canvas.height = 0;

    canvas.style.width = '0';
    canvas.style.height = '0';

    state?.task &&
      (state.task = undefined);
  }

  private getCanvasState(
    canvas: HTMLCanvasElement
  ): CanvasRenderState {

    const existing =
      this.canvasStates.get(canvas);

    if (existing) {
      return existing;
    }

    const state: CanvasRenderState = {
      queue: Promise.resolve()
    };

    this.canvasStates.set(
      canvas,
      state
    );

    return state;
  }

  private isRenderCancellation(
    error: unknown
  ): boolean {

    if (
      !error ||
      typeof error !== 'object'
    ) {
      return false;
    }

    const candidate =
      error as {
        name?: unknown;
        message?: unknown;
      };

    const name =
      String(
        candidate.name ?? ''
      );

    const message =
      String(
        candidate.message ?? ''
      ).toLowerCase();

    return (
      name ===
      'RenderingCancelledException' ||
      message.includes(
        'rendering cancelled'
      )
    );
  }

  private resolveScale(
  page: PDFPageProxy,
  options: RenderPageOptions | number
): number {

  if (
    typeof options === 'number'
  ) {
    return this.normalizeZoom(
      options
    );
  }

  if (
    options.mode === 'zoom'
  ) {
    return this.normalizeZoom(
      options.zoomPercent ?? 100
    );
  }

  const viewportWidth =
    options.viewportWidth ?? 0;

  const viewportHeight =
    options.viewportHeight ?? 0;

  const padding =
    Math.max(
      0,
      options.padding ?? 24
    );

  if (
    viewportWidth <= 0
  ) {
    return 1;
  }

  const baseViewport =
    page.getViewport({
      scale: 1,
      rotation: page.rotate
    });

  const availableWidth =
    Math.max(
      1,
      viewportWidth -
        padding * 2
    );

  /**
   * --------------------------------------------------------
   * FIT WIDTH
   * --------------------------------------------------------
   */
  if (
    options.mode ===
    'fit-width'
  ) {

    const widthScale =
      availableWidth /
      baseViewport.width;

    if (
      !Number.isFinite(
        widthScale
      ) ||
      widthScale <= 0
    ) {
      return 1;
    }

    return Math.min(
      Math.max(
        widthScale,
        0.25
      ),
      4
    );
  }

  /**
   * --------------------------------------------------------
   * FIT PAGE
   * --------------------------------------------------------
   */
  if (
    viewportHeight <= 0
  ) {
    return 1;
  }

  const availableHeight =
    Math.max(
      1,
      viewportHeight -
        padding * 2
    );

  const widthScale =
    availableWidth /
    baseViewport.width;

  const heightScale =
    availableHeight /
    baseViewport.height;

  const fitScale =
    Math.min(
      widthScale,
      heightScale
    );

  if (
    !Number.isFinite(
      fitScale
    ) ||
    fitScale <= 0
  ) {
    return 1;
  }

  return Math.min(
    Math.max(
      fitScale,
      0.25
    ),
    4
  );
}

  private normalizeZoom(
    zoomPercent: number
  ): number {

    if (
      !Number.isFinite(zoomPercent)
    ) {
      return 1;
    }

    return Math.min(
      Math.max(
        zoomPercent / 100,
        0.5
      ),
      2
    );
  }

  private getDevicePixelRatio(): number {

    if (
      typeof window === 'undefined'
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
}

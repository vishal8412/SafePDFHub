import {
  Injectable,
  computed,
  inject
} from '@angular/core';

import { LoaderService } from '../../../shared/services/loader.service';
import { ToastService } from '../../../shared/services/toast.service';

import { PdfEngineService } from '../services/pdf-engine.service';
import { StudioStateService, StudioViewMode } from '../state/studio-state.service';
import { ThumbnailService } from '../services/thumbnail.service';

import {
  PdfPageRendererService,
  RenderedPageSize
} from '../services/pdf-page-renderer.service';
import { StudioToolId } from '../models/studio-tool.model';
import { StudioObjectService } from '../services/studio-object.service';
import { StudioSelection } from '../models/studio-selection.model';
import type {
  StudioImageData,
  StudioTextStyle,
  StudioShapeKind,
  StudioShapeStyle,
  StudioDrawingStyle,
  StudioPoint
} from '../models/studio-selection.model';
import { StudioPdfExportService } from '../services/studio-pdf-export.service';
import { StudioPageService } from '../services/studio-page.service';
import {
  StudioHistoryService,
  StudioHistorySnapshot
} from '../services/studio-history.service';
import type { StudioPage } from '../models/studio-page.model';

@Injectable({
  providedIn: 'root'
})
export class StudioFacade {

  private readonly pdfEngine =
    inject(PdfEngineService);

  private readonly state =
    inject(StudioStateService);

  private readonly loader =
    inject(LoaderService);

  private readonly toast =
    inject(ToastService);

  private readonly pageRenderer =
    inject(PdfPageRendererService);

  private readonly thumbnailService =
    inject(ThumbnailService);

  private readonly objectService =
    inject(StudioObjectService);

  private readonly pdfExportService =
    inject(StudioPdfExportService);

  private readonly pageService =
    inject(StudioPageService);

  private readonly history =
    inject(StudioHistoryService);

  /**
   * F6.3 — One live pointer transform is treated as one history mutation.
   * Pointer-move frames update the object immediately for smooth UI feedback,
   * while pointer-up records a single immutable before/after entry.
   */
  private pendingObjectTransform: {
    readonly objectId: string;
    readonly before: StudioHistorySnapshot;
  } | null = null;

  /** F7.2 — Empty comment markers stay draft-only until saved. */
  private readonly pendingCommentDrafts =
    new Map<string, StudioHistorySnapshot>();

  /**
   * F6.4.5 — Document/render lifecycle generation.
   *
   * A render may still be awaiting PDF.js when the current document is
   * replaced or closed. The generation makes that older request obsolete,
   * while the active canvas reference lets the Facade actively cancel and
   * release the main canvas at the document lifecycle boundary.
   */
  private renderSession = 0;

  private activeRenderCanvas:
    | HTMLCanvasElement
    | null = null;

  /**
   * Public readonly state exposed to UI.
   */
  readonly studioState = this.state.state;

  readonly document = this.state.document;

  readonly status = this.state.status;

  readonly isLoading = this.state.isLoading;

  readonly isReady = this.state.isReady;

  readonly hasDocument = this.state.hasDocument;

  readonly fileName = this.state.fileName;

  readonly pages = this.pageService.pages;

  readonly pageCount = this.pageService.pageCount;

  readonly currentPage = this.state.currentPage;

  readonly zoom = this.state.zoom;

  readonly viewMode = this.state.viewMode;

  readonly activeTool = this.state.activeTool;

  readonly selectedObjectId = this.state.selectedObjectId;

  readonly selection = this.state.selection;

  readonly error = this.state.error;

  /**
   * F5 — Header and keyboard bindings consume these reactive signals.
   */
  readonly canUndo =
    this.history.canUndo;

  readonly canRedo =
    this.history.canRedo;

  /** F7.2 — Saved comments only, sorted newest first. */
  readonly comments = computed(() => {
    this.objectService.changes();

    return this.objectService.snapshot()
      .filter(
        object =>
          object.type === 'comment' &&
          !!object.comment &&
          object.comment.content.trim().length > 0
      )
      .sort(
        (a, b) =>
          (b.comment?.updatedAt ?? 0) -
          (a.comment?.updatedAt ?? 0)
      );
  });

  /**
   * Load a PDF into Studio.
   *
   * This method intentionally owns the workflow.
   * Components should never call PdfEngineService directly.
   */
  async loadPdf(file: File): Promise<void> {
    if (this.isLoading()) {
      return;
    }

    if (!this.isPdfFile(file)) {
      this.toast.show(
        'Please select a valid PDF file.',
        'error'
      );

      return;
    }

    this.state.beginLoading();

    this.loader.show(
      'Opening your PDF...'
    );

    this.loader.setText(
      'Reading PDF document...'
    );

    try {
      /**
       * Load the new document first.
       *
       * This is important when replacing an existing PDF:
       * if the new PDF fails, the old PDF remains usable.
       */
      const newDocument =
        await this.pdfEngine.loadFile(file);

      const previousDocument =
        this.document();

      /**
       * F6.4.5 — The new document becomes a new render session before
       * application state is committed. This actively cancels any main-canvas
       * work still owned by the previous document and prevents a late render
       * from painting after replacement.
       */
      this.invalidateMainCanvasRenderSession();

      /**
       * Commit the new document to application state.
       */
      this.state.setDocument(newDocument);
      this.pageService.initialize(newDocument.pageCount);

      /**
       * A successfully opened document starts a new Studio
       * editing session, so objects belonging to the previous
       * document must never leak into the new document.
       */
      this.objectService.clearAll();
      this.pendingCommentDrafts.clear();

      /**
       * A new PDF is a new history session.
       */
      this.history.reset();

      /**
       * Only destroy the old document after
       * the replacement has loaded successfully.
       */
      if (
        previousDocument &&
        previousDocument.id !== newDocument.id
      ) {
        this.thumbnailService.clearPdf(
          previousDocument.pdf
        );

        await this.pdfEngine.destroy(
          previousDocument
        );
      }

      this.loader.setText(
        'PDF ready'
      );

      this.toast.show(
        `${file.name} opened successfully.`,
        'success'
      );

    } catch (error: unknown) {
      const message =
        this.getLoadErrorMessage(error);

      this.state.setError(
        message
      );

      this.loader.setText(
        'Unable to open PDF'
      );

      this.toast.show(
        message,
        'error'
      );

      console.error(
        '[SafePDFHub Studio] PDF loading failed:',
        error
      );

    } finally {
      this.loader.hide();
    }
  }

  /**
 * Render the current page into the Studio canvas.
 */
async renderCurrentPage(
  canvas: HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number
): Promise<RenderedPageSize | null> {

  const document =
    this.document();

  if (!document) {
    return null;
  }

  /**
   * F6.4.5 — The Facade owns the document-level main canvas lifecycle.
   *
   * The renderer owns per-canvas PDF.js serialization, while the Facade owns
   * the higher-level question of whether this render still belongs to the
   * currently active Studio document.
   */
  this.activeRenderCanvas =
    canvas;

  const renderSession =
    this.renderSession;

  const pageNumber =
    this.currentPage();

  const logicalPage =
    this.pageService.pageAt(
      pageNumber
    );

  if (!logicalPage) {
    return null;
  }

  let rendered: RenderedPageSize;

  if (logicalPage.kind === 'blank') {

    rendered =
      await this.renderBlankPage(
        canvas,
        logicalPage,
        viewportWidth,
        viewportHeight
      );

  } else {

    const sourcePageNumber =
      logicalPage.sourcePageNumber ??
      pageNumber;

    const rotation =
      logicalPage.rotation;

    const viewMode =
      this.viewMode();

    switch (viewMode) {

      case 'fit-width':

        rendered =
          await this.pageRenderer.renderPage(
            document.pdf,
            sourcePageNumber,
            canvas,
            {
              mode: 'fit-width',
              rotation,
              viewportWidth,
              padding: 32
            }
          );

        break;

      case 'zoom':

        rendered =
          await this.pageRenderer.renderPage(
            document.pdf,
            sourcePageNumber,
            canvas,
            {
              mode: 'zoom',
              rotation,
              zoomPercent: this.zoom()
            }
          );

        break;

      case 'fit-page':
      default:

        rendered =
          await this.pageRenderer.renderPage(
            document.pdf,
            sourcePageNumber,
            canvas,
            {
              mode: 'fit-page',
              rotation,
              viewportWidth,
              viewportHeight,
              padding: 32
            }
          );

        break;
    }
  }

  /**
   * Do not report a stale render as the current page. The lifecycle transition
   * itself already cancels/clears the renderer, but this final guard keeps a
   * completed async call from updating component state after replacement or
   * close.
   */
  if (
    renderSession !==
      this.renderSession ||
    this.activeRenderCanvas !==
      canvas ||
    this.document() !==
      document
  ) {
    return null;
  }

  return rendered;
}

  /**
   * Render a Studio-created blank page through the shared canvas renderer.
   *
   * F6.2: blank pages now participate in the same per-canvas cancellation and
   * serialization lifecycle as PDF.js pages. This prevents a late PDF render
   * from painting over a newly selected blank logical page.
   */
  private async renderBlankPage(
    canvas: HTMLCanvasElement,
    page: StudioPage,
    viewportWidth: number,
    viewportHeight: number
  ): Promise<RenderedPageSize> {

    const baseWidth =
      page.blankWidth ?? 595.28;

    const baseHeight =
      page.blankHeight ?? 841.89;

    const rotated =
      page.rotation === 90 ||
      page.rotation === 270;

    const logicalWidth =
      rotated
        ? baseHeight
        : baseWidth;

    const logicalHeight =
      rotated
        ? baseWidth
        : baseHeight;

    const padding = 32;

    let scale = 1;

    switch (this.viewMode()) {

      case 'zoom':
        scale = this.normalizeRenderZoom(
          this.zoom()
        );
        break;

      case 'fit-width':
        scale = this.fitRenderScale(
          logicalWidth,
          logicalHeight,
          viewportWidth,
          viewportHeight,
          padding,
          'fit-width'
        );
        break;

      case 'fit-page':
      default:
        scale = this.fitRenderScale(
          logicalWidth,
          logicalHeight,
          viewportWidth,
          viewportHeight,
          padding,
          'fit-page'
        );
        break;
    }

    return this.pageRenderer.renderBlankPage(
      canvas,
      logicalWidth,
      logicalHeight,
      scale
    );
  }

  private fitRenderScale(
    width: number,
    height: number,
    viewportWidth: number,
    viewportHeight: number,
    padding: number,
    mode: 'fit-page' | 'fit-width'
  ): number {

    const availableWidth =
      Math.max(
        1,
        viewportWidth - padding * 2
      );

    const widthScale =
      availableWidth /
      Math.max(1, width);

    if (mode === 'fit-width') {
      return this.clampRenderScale(
        widthScale
      );
    }

    const availableHeight =
      Math.max(
        1,
        viewportHeight - padding * 2
      );

    const heightScale =
      availableHeight /
      Math.max(1, height);

    return this.clampRenderScale(
      Math.min(
        widthScale,
        heightScale
      )
    );
  }

  private normalizeRenderZoom(
    zoomPercent: number
  ): number {

    if (!Number.isFinite(zoomPercent)) {
      return 1;
    }

    return this.clampRenderScale(
      zoomPercent / 100,
      0.5,
      2
    );
  }

  private clampRenderScale(
    scale: number,
    minimum = 0.25,
    maximum = 4
  ): number {

    if (
      !Number.isFinite(scale) ||
      scale <= 0
    ) {
      return 1;
    }

    return Math.min(
      Math.max(
        scale,
        minimum
      ),
      maximum
    );
  }

  /**
   * Update zoom state.
   *
   * Actual canvas scaling comes in Task 3.
   */
  setZoom(
  zoom: number
): void {

  if (
    !this.hasDocument()
  ) {
    return;
  }

  if (
    !Number.isFinite(zoom)
  ) {
    return;
  }

  const normalized =
    Math.min(
      200,
      Math.max(
        50,
        Math.round(zoom)
      )
    );

  this.state.setZoom(
    normalized
  );

  this.state.setViewMode(
    'zoom'
  );
}

resetView(): void {

  if (
    !this.hasDocument()
  ) {
    return;
  }

  this.state.setZoom(
    100
  );

  this.state.setViewMode(
    'zoom'
  );
}

setViewMode(
  mode: StudioViewMode
): void {

  if (
    !this.hasDocument()
  ) {
    return;
  }

  this.state.setViewMode(
    mode
  );
}

setActiveTool(
  tool: StudioToolId
): void {

  if (
    !this.hasDocument()
  ) {
    return;
  }

  this.state.setActiveTool(
    tool
  );
}

runToolAction(
  tool: StudioToolId
): void {

  if (
    !this.hasDocument()
  ) {
    return;
  }

  switch (tool) {

    case 'rotate':

      this.rotateCurrentPage('right');
      return;

    case 'delete':

      this.deleteSelectedObject();

      return;

    case 'extract':

      void this.extractCurrentPage();
      return;

    case 'comment':

      this.setActiveTool('comment');
      this.toast.show('Click a page to add a comment.', 'info');
      return;

    case 'link':

      this.toast.show(
        'Link editing will be available in the next editing stage.',
        'info'
      );

      return;

    case 'more':

      this.toast.show(
        'Additional Studio tools will be available here.',
        'info'
      );

      return;

    default:
      return;
  }
}

/**
 * Delete the currently selected Studio object.
 *
 * Returns true only when an object was actually removed.
 */
  /** F7.2 — Delete a specific object while preserving history semantics. */
  deleteObject(objectId: string): boolean {
    if (!this.hasDocument()) {
      return false;
    }

    const object = this.objectService.get(objectId);
    if (!object) {
      return false;
    }

    const draftBefore = this.pendingCommentDrafts.get(objectId);
    const before = draftBefore ?? this.captureHistorySnapshot();

    if (this.pendingObjectTransform?.objectId === objectId) {
      this.pendingObjectTransform = null;
    }

    const removed = this.objectService.remove(objectId);

    if (!removed) {
      return false;
    }

    this.pendingCommentDrafts.delete(objectId);

    if (this.selectedObjectId() === objectId) {
      this.state.clearSelection();
    }

    if (!draftBefore) {
      this.commitHistoryMutation(
        object.type === 'comment' ? 'Delete comment' : 'Delete object',
        before
      );
    }

    return true;
  }

  deleteSelectedObject(): boolean {

    if (!this.hasDocument()) {
      return false;
    }

    const selectedObjectId =
      this.selectedObjectId();

    if (!selectedObjectId) {
      this.toast.show(
        'Select an object first.',
        'info'
      );

      return false;
    }

    /**
     * Keep all deletion entry points on the same lifecycle path.
     *
     * This is especially important for comment drafts: an empty draft has not
     * been committed to history yet, so deleting it must discard the pending
     * draft instead of creating a phantom "Delete object" history entry.
     */
    const removed =
      this.deleteObject(
        selectedObjectId
      );

    if (!removed) {
      return false;
    }

    this.toast.show(
      'Object deleted.',
      'success'
    );

    return true;
  }

discardTextObject(
  objectId: string
): boolean {

  if (!this.hasDocument()) {
    return false;
  }

  const object =
    this.objectService.get(objectId);

  if (
    !object ||
    object.type !== 'text'
  ) {
    return false;
  }

  const before =
    this.captureHistorySnapshot();

  const removed =
    this.objectService.remove(objectId);

  if (!removed) {
    return false;
  }

  this.state.clearSelection();

  this.commitHistoryMutation(
    'Delete text',
    before
  );

  return true;
}

fitPage(): void {
  this.setViewMode(
    'fit-page'
  );
}

fitWidth(): void {
  this.setViewMode(
    'fit-width'
  );
}

  /**
   * Update current page.
   *
   * Actual navigation comes later.
   */
  setCurrentPage(page: number): void {
   this.goToPage(page);
  }

  /**
   * Close the current PDF.
   */
  async closePdf(): Promise<void> {
    /**
     * F6.4.5 — Close is a hard document lifecycle boundary. Cancel the main
     * canvas before destroying the PDF so no in-flight render can outlive the
     * document that created it.
     */
    this.invalidateMainCanvasRenderSession();

    const document =
      this.document();

    if (!document) {
      return;
    }

    try {
      this.thumbnailService.clearPdf(
        document.pdf
      );

      await this.pdfEngine.destroy(
        document
      );
    } finally {
      /**
       * Clear every document-scoped store together.
       *
       * The logical page collection is intentionally cleared here as well.
       * Keeping old logical pages after the PDF document has been destroyed can
       * leave stale page metadata observable by a component during teardown or
       * while a replacement document is opening.
       */
      this.objectService.clearAll();
      this.pendingCommentDrafts.clear();
      this.pageService.clear();
      this.history.reset();
      this.state.clear();
    }
  }

  /**
   * F6.4.5 — Invalidate the document-level main canvas render session.
   *
   * PdfPageRendererService owns the low-level PDF.js task and per-canvas
   * serialization. The Facade calls this only at document lifecycle
   * boundaries, so page navigation itself remains lightweight.
   */
  /**
   * Release a specific main canvas from the document-level render lifecycle.
   *
   * F6.4.6 — StudioCanvas owns the DOM element, while the Facade owns the
   * document-level association and the shared renderer owns the underlying
   * PDF.js task. A component must therefore release its canvas explicitly
   * during teardown instead of only clearing visible pixels locally.
   */
  releaseMainCanvas(
    canvas: HTMLCanvasElement
  ): void {

    const ownsActiveCanvas =
      this.activeRenderCanvas ===
      canvas;

    if (ownsActiveCanvas) {
      this.renderSession++;

      this.pendingObjectTransform =
        null;

      this.activeRenderCanvas =
        null;
    }

    /**
     * Always invalidate the renderer's per-canvas request, even when this
     * canvas is no longer the active Facade canvas. This prevents a stale
     * queued PDF.js operation from painting into a DOM element that is being
     * hidden or destroyed.
     */
    this.pageRenderer.clearCanvas(
      canvas
    );
  }

  /**
   * F6.4.5/F6.4.6 — Invalidate the document-level main canvas render session.
   */
  private invalidateMainCanvasRenderSession(): void {
    this.renderSession++;

    this.pendingObjectTransform =
      null;

    const canvas =
      this.activeRenderCanvas;

    this.activeRenderCanvas =
      null;

    if (!canvas) {
      return;
    }

    this.pageRenderer.clearCanvas(
      canvas
    );
  }

  /**
   * Validate PDF selection.
   */
  private isPdfFile(file: File): boolean {
    const hasPdfMimeType =
      file.type === 'application/pdf';

    const hasPdfExtension =
      file.name
        .toLowerCase()
        .endsWith('.pdf');

    return (
      hasPdfMimeType ||
      hasPdfExtension
    );
  }

  /**
   * Convert PDF.js errors into useful
   * user-facing messages.
   */
  private getLoadErrorMessage(
    error: unknown
  ): string {

    if (
      error &&
      typeof error === 'object' &&
      'name' in error
    ) {
      const name =
        String(
          (error as { name?: unknown }).name
        );

      if (
        name === 'PasswordException'
      ) {
        return (
          'This PDF is password protected. ' +
          'Password handling will be available in a later Studio feature.'
        );
      }
    }

    if (error instanceof Error) {
      const message =
        error.message.toLowerCase();

      if (
        message.includes('invalid pdf') ||
        message.includes('invalid pdf structure')
      ) {
        return (
          'This PDF appears to be invalid or corrupted.'
        );
      }

      return (
        'Unable to open this PDF. ' +
        'Please verify that the file is valid.'
      );
    }

    return (
      'Unable to open this PDF. ' +
      'Please try another file.'
    );
  }

  goToPreviousPage(): void {
  if (!this.hasDocument()) {
    return;
  }

  const current = this.currentPage();
  const total = this.pageCount();

  if (current <= 1 || total <= 0) {
    return;
  }

  this.state.clearSelection();
  this.state.setCurrentPage(current - 1);
}


goToNextPage(): void {
  if (!this.hasDocument()) {
    return;
  }

  const current = this.currentPage();
  const total = this.pageCount();

  if (current >= total || total <= 0) {
    return;
  }

  this.state.clearSelection();
  this.state.setCurrentPage(current + 1);
}


goToFirstPage(): void {
  if (!this.hasDocument()) {
    return;
  }

  const total = this.pageCount();

  if (total <= 0) {
    return;
  }

  this.state.clearSelection();
  this.state.setCurrentPage(1);
}


goToLastPage(): void {
  if (!this.hasDocument()) {
    return;
  }

  const total = this.pageCount();

  if (total <= 0) {
    return;
  }

  this.state.clearSelection();
  this.state.setCurrentPage(total);
}


  /**
   * F5 — Undo the most recent page-management mutation.
   */
  undo(): boolean {

    this.pendingObjectTransform = null;

    if (!this.hasDocument()) {
      return false;
    }

    const snapshot =
      this.history.undo();

    if (!snapshot) {
      return false;
    }

    this.restoreHistorySnapshot(
      snapshot
    );

    return true;
  }

  /**
   * F5 — Reapply the next history entry.
   */
  redo(): boolean {

    this.pendingObjectTransform = null;

    if (!this.hasDocument()) {
      return false;
    }

    const snapshot =
      this.history.redo();

    if (!snapshot) {
      return false;
    }

    this.restoreHistorySnapshot(
      snapshot
    );

    return true;
  }

  /**
   * Move a logical page and preserve every object mapping in one history entry.
   */
  movePage(
    fromPage: number,
    toPage: number
  ): void {

    const count =
      this.pageCount();

    if (
      fromPage === toPage ||
      fromPage < 1 ||
      toPage < 1 ||
      fromPage > count ||
      toPage > count
    ) {
      return;
    }

    this.recordPageMutation(
      'Move page',
      () => {

        const mapping =
          new Map<number, number>();

        for (
          let old = 1;
          old <= count;
          old++
        ) {

          let next =
            old;

          if (
            old === fromPage
          ) {
            next =
              toPage;

          } else if (
            fromPage < toPage &&
            old > fromPage &&
            old <= toPage
          ) {
            next =
              old - 1;

          } else if (
            fromPage > toPage &&
            old >= toPage &&
            old < fromPage
          ) {
            next =
              old + 1;
          }

          mapping.set(
            old,
            next
          );
        }

        if (
          !this.pageService.move(
            fromPage,
            toPage
          )
        ) {
          return false;
        }

        this.objectService.remapPageNumbers(
          mapping
        );

        this.state.clearSelection();

        this.state.setCurrentPage(
          mapping.get(
            this.currentPage()
          ) ??
          this.currentPage()
        );

        return true;
      }
    );
  }

  duplicateCurrentPage(): void {

    this.recordPageMutation(
      'Duplicate page',
      () => {

        const source =
          this.currentPage();

        const target =
          this.pageService.duplicate(
            source
          );

        if (!target) {
          return false;
        }

        this.objectService.shiftPageNumbers(
          target,
          1
        );

        this.objectService.duplicatePage(
          source,
          target
        );

        this.state.setPageCount(
          this.pageCount()
        );

        this.state.clearSelection();

        this.state.setCurrentPage(
          target
        );

        return true;
      }
    );
  }

  insertBlankPage(
    afterCurrent = true
  ): void {

    this.recordPageMutation(
      afterCurrent
        ? 'Insert page after'
        : 'Insert page before',
      () => {

        const current =
          this.currentPage();

        const position =
          afterCurrent
            ? current + 1
            : current;

        const target =
          this.pageService.insertBlank(
            position
          );

        this.objectService.shiftPageNumbers(
          target,
          1
        );

        this.state.setPageCount(
          this.pageCount()
        );

        this.state.clearSelection();

        this.state.setCurrentPage(
          target
        );

        return true;
      }
    );
  }

  deleteCurrentPage(): void {

    if (
      this.pageCount() <= 1
    ) {
      this.toast.show(
        'A PDF must contain at least one page.',
        'info'
      );

      return;
    }

    this.recordPageMutation(
      'Delete page',
      () => {

        const current =
          this.currentPage();

        const countBefore =
          this.pageCount();

        if (
          !this.pageService.delete(
            current
          )
        ) {
          return false;
        }

        this.objectService.clearPage(
          current
        );

        const mapping =
          new Map<number, number>();

        for (
          let old = current + 1;
          old <= countBefore;
          old++
        ) {
          mapping.set(
            old,
            old - 1
          );
        }

        this.objectService.remapPageNumbers(
          mapping
        );

        this.state.setPageCount(
          this.pageCount()
        );

        this.state.clearSelection();

        this.state.setCurrentPage(
          Math.min(
            current,
            this.pageCount()
          )
        );

        return true;
      }
    );
  }

  rotateCurrentPage(
    direction:
      | 'left'
      | 'right' = 'right'
  ): void {

    this.recordPageMutation(
      direction === 'left'
        ? 'Rotate page left'
        : 'Rotate page right',
      () => {

        const changed =
          this.pageService.rotate(
            this.currentPage(),
            direction === 'left'
              ? -90
              : 90
          );

        if (changed) {
          this.state.clearSelection();
        }

        return changed;
      }
    );
  }

  /**
   * Capture, execute and record one atomic logical page mutation.
   *
   * The current page is part of the snapshot because Undo/Redo must restore
   * not only the document structure but also the page the user was editing.
   */
  private recordPageMutation(
    label: string,
    mutation: () => boolean
  ): boolean {

    if (!this.hasDocument()) {
      return false;
    }

    const before =
      this.captureHistorySnapshot();

    const changed =
      mutation();

    if (!changed) {
      return false;
    }

    const after =
      this.captureHistorySnapshot();

    this.history.record(
      label,
      before,
      after
    );

    return true;
  }

  /**
   * F5 — Record a successful non-page mutation.
   *
   * Page management and object editing share the same immutable history
   * timeline. Keeping the snapshot boundary in the Facade guarantees that
   * every UI mutation can be undone through the same Undo/Redo controls.
   */
  private commitHistoryMutation(
    label: string,
    before: StudioHistorySnapshot
  ): void {

    this.history.record(
      label,
      before,
      this.captureHistorySnapshot()
    );
  }

  private captureHistorySnapshot():
    StudioHistorySnapshot {

    return {
      pages:
        this.pageService.snapshot(),

      objects:
        this.objectService.snapshot(),

      currentPage:
        this.currentPage()
    };
  }

  /**
   * Restore page and object state as one transaction.
   *
   * Page count must be synchronized before currentPage because
   * StudioStateService validates page navigation against pageCount.
   */
  private restoreHistorySnapshot(
    snapshot:
      StudioHistorySnapshot
  ): void {

    this.pendingObjectTransform = null;
    this.pendingCommentDrafts.clear();

    this.pageService.restore(
      snapshot.pages
    );

    this.objectService.restore(
      snapshot.objects
    );

    this.state.setPageCount(
      this.pageCount()
    );

    this.state.clearSelection();

    const total =
      this.pageCount();

    const target =
      total <= 0
        ? 1
        : Math.min(
            Math.max(
              1,
              snapshot.currentPage
            ),
            total
          );

    this.state.setCurrentPage(
      target
    );
  }

readonly canPreviousPage = computed(() => {
  return (
    this.hasDocument() &&
    this.currentPage() > 1
  );
});


readonly canNextPage = computed(() => {
  return (
    this.hasDocument() &&
    this.currentPage() < this.pageCount()
  );
});

/**
 * Navigate to a specific page.
 *
 * Page numbers are 1-based and must be within
 * the currently loaded PDF's page range.
 */
goToPage(page: number): void {

  if (!this.hasDocument()) {
    return;
  }

  if (!Number.isInteger(page)) {
    return;
  }

  const total = this.pageCount();

  if (
    page < 1 ||
    page > total
  ) {
    return;
  }

  if (
    page === this.currentPage()
  ) {
    return;
  }

  this.state.clearSelection();

  this.state.setCurrentPage(
    page
  );
}


/**
 * F1.5 — Export the current Studio document as a new PDF.
 *
 * The original uploaded PDF remains untouched. Studio-created text objects
 * are persisted on top of the original PDF pages and downloaded as an
 * `_edited.pdf` file.
 */
async exportPdf(): Promise<void> {
  if (!this.hasDocument()) {
    this.toast.show(
      'Open a PDF before exporting.',
      'info'
    );
    return;
  }

  const document = this.document();

  if (!document) {
    return;
  }

  try {
    this.loader.show(
      'Preparing your edited PDF...'
    );
    this.loader.setText(
      'Writing Studio changes into PDF...'
    );

    const objects = Array.from(
      { length: this.pageCount() },
      (_, index) =>
        this.objectService.listForPage(index + 1)
    ).flat();

    await this.pdfExportService.exportAndDownload(
      document.file,
      objects,
      this.pages()
    );

    this.loader.setText(
      'PDF exported successfully'
    );

    this.toast.show(
      'Edited PDF exported successfully.',
      'success'
    );
  } catch (error: unknown) {
    console.error(
      '[SafePDFHub Studio] PDF export failed:',
      error
    );

    this.toast.show(
      'Unable to export the edited PDF. Please try again.',
      'error'
    );
  } finally {
    this.loader.hide();
  }
}

/**
 * F7.1 — Extract the currently active logical Studio page into a new PDF.
 *
 * This remains the existing toolbar entry point. Internally it now delegates
 * to the shared multi-page extraction pipeline so single-page and range
 * extraction always use exactly the same export behavior.
 *
 * The original Studio document remains open and unchanged.
 */
async extractCurrentPage(): Promise<void> {
  await this.extractPages(
    [ this.currentPage() ]
  );
}

/**
 * F7.1.2 — Extract a validated set of logical Studio pages.
 *
 * Page numbers are always interpreted against the current logical Studio
 * document, not against the original source PDF. This is important because
 * the user may have reordered, duplicated, rotated, inserted, or removed
 * pages before extraction.
 *
 * The extracted output always follows the current logical Studio order.
 */
async extractPages(
  requestedPageNumbers: readonly number[]
): Promise<void> {
  if (!this.hasDocument()) {
    this.toast.show(
      'Open a PDF before extracting pages.',
      'info'
    );
    return;
  }

  const document =
    this.document();

  if (!document) {
    return;
  }

  const pageNumbers =
    this.normalizeExtractionPageNumbers(
      requestedPageNumbers
    );

  if (pageNumbers.length === 0) {
    this.toast.show(
      'Select at least one valid page to extract.',
      'info'
    );
    return;
  }

  const totalPages =
    this.pageCount();

  if (
    pageNumbers.some(
      pageNumber =>
        pageNumber < 1 ||
        pageNumber > totalPages
    )
  ) {
    this.toast.show(
      `Select pages between 1 and ${totalPages}.`,
      'error'
    );
    return;
  }

  const logicalPages: StudioPage[] = [];
  const outputObjects = [];

  for (
    let index = 0;
    index < pageNumbers.length;
    index++
  ) {
    const logicalPageNumber =
      pageNumbers[index];

    const logicalPage =
      this.pageService.pageAt(
        logicalPageNumber
      );

    if (!logicalPage) {
      this.toast.show(
        `Page ${logicalPageNumber} is no longer available for extraction.`,
        'error'
      );
      return;
    }

    logicalPages.push(
      logicalPage
    );

    /**
     * Studio objects are stored against the current logical page number.
     * The extracted PDF, however, is a new document whose pages are numbered
     * from 1. Remap each selected page's objects to that output page index.
     *
     * This fixes the single-page case as well: extracting logical page 4 must
     * paint its objects onto extracted output page 1, not look for page 4 in a
     * one-page PDF.
     */
    const outputPageNumber =
      index + 1;

    outputObjects.push(
      ...this.objectService
        .listForPage(
          logicalPageNumber
        )
        .map(
          object => ({
            ...object,
            pageNumber:
              outputPageNumber
          })
        )
    );
  }

  try {
    const extractionLabel =
      pageNumbers.length === 1
        ? `Extracting page ${pageNumbers[0]}...`
        : `Extracting ${pageNumbers.length} pages...`;

    this.loader.show(
      'Preparing extracted pages...'
    );

    this.loader.setText(
      extractionLabel
    );

    await this.pdfExportService.extractPagesAndDownload(
      document.file,
      outputObjects,
      logicalPages,
      this.createExtractedPagesFileName(
        document.file.name,
        pageNumbers
      )
    );

    this.loader.setText(
      pageNumbers.length === 1
        ? 'Page extracted successfully'
        : 'Pages extracted successfully'
    );

    this.toast.show(
      pageNumbers.length === 1
        ? `Page ${pageNumbers[0]} extracted successfully.`
        : `${pageNumbers.length} pages extracted successfully.`,
      'success'
    );

  } catch (error: unknown) {
    console.error(
      '[SafePDFHub Studio] Page extraction failed:',
      error
    );

    this.toast.show(
      pageNumbers.length === 1
        ? 'Unable to extract the current page. Please try again.'
        : 'Unable to extract the selected pages. Please try again.',
      'error'
    );

  } finally {
    this.loader.hide();
  }
}

/**
 * F7.1.2 — Extract pages from a user range expression.
 *
 * Supported examples:
 *   1-5
 *   1, 3, 5
 *   1-3, 7, 10-12
 *
 * Whitespace is ignored. Duplicate page references are collapsed. The final
 * output follows the current logical Studio page order.
 */
async extractPagesByRange(
  rangeExpression: string
): Promise<void> {
  const parsed =
    this.parseExtractionRange(
      rangeExpression
    );

  if (!parsed.ok) {
    this.toast.show(
      parsed.message,
      'error'
    );
    return;
  }

  await this.extractPages(
    parsed.pageNumbers
  );
}

/**
 * Parse a comma-separated list of page numbers and inclusive page ranges.
 *
 * Parsing intentionally performs no source-PDF lookup. Bounds are validated
 * against the current logical Studio page count, so inserted/duplicated pages
 * remain addressable exactly as shown in the Studio UI.
 */
private parseExtractionRange(
  value: string
):
  | {
      readonly ok: true;
      readonly pageNumbers: readonly number[];
    }
  | {
      readonly ok: false;
      readonly message: string;
    } {

  const source =
    value.trim();

  if (!source) {
    return {
      ok: false,
      message:
        'Enter a page number or range, for example 1-3, 7, 10-12.'
    };
  }

  const totalPages =
    this.pageCount();

  if (totalPages < 1) {
    return {
      ok: false,
      message:
        'There are no pages available for extraction.'
    };
  }

  const selected =
    new Set<number>();

  const tokens =
    source.split(',');

  for (const rawToken of tokens) {
    const token =
      rawToken.trim();

    if (!token) {
      return {
        ok: false,
        message:
          'The page range contains an empty entry.'
      };
    }

    const singleMatch =
      /^(\d+)$/.exec(
        token
      );

    if (singleMatch) {
      const pageNumber =
        Number(
          singleMatch[1]
        );

      if (
        !Number.isSafeInteger(
          pageNumber
        ) ||
        pageNumber < 1 ||
        pageNumber > totalPages
      ) {
        return {
          ok: false,
          message:
            `Page numbers must be between 1 and ${totalPages}.`
        };
      }

      selected.add(
        pageNumber
      );
      continue;
    }

    const rangeMatch =
      /^(\d+)\s*-\s*(\d+)$/.exec(
        token
      );

    if (!rangeMatch) {
      return {
        ok: false,
        message:
          `Invalid page range "${token}". Use values such as 1-3, 7, 10-12.`
      };
    }

    const start =
      Number(
        rangeMatch[1]
      );

    const end =
      Number(
        rangeMatch[2]
      );

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < 1 ||
      start > totalPages ||
      end > totalPages
    ) {
      return {
        ok: false,
        message:
          `Page ranges must stay between 1 and ${totalPages}.`
      };
    }

    if (start > end) {
      return {
        ok: false,
        message:
          `Invalid range "${token}". The first page must not be greater than the last page.`
      };
    }

    for (
      let pageNumber = start;
      pageNumber <= end;
      pageNumber++
    ) {
      selected.add(
        pageNumber
      );
    }
  }

  const pageNumbers =
    Array.from(
      selected
    ).sort(
      (left, right) =>
        left - right
    );

  if (pageNumbers.length === 0) {
    return {
      ok: false,
      message:
        'Select at least one page to extract.'
    };
  }

  return {
    ok: true,
    pageNumbers
  };
}

/**
 * Normalize direct page-number input into the current logical Studio order.
 */
private normalizeExtractionPageNumbers(
  requestedPageNumbers: readonly number[]
): number[] {
  const selected =
    new Set<number>();

  for (const value of requestedPageNumbers) {
    if (
      Number.isInteger(
        value
      )
    ) {
      selected.add(
        value
      );
    }
  }

  return Array.from(
    selected
  ).sort(
    (left, right) =>
      left - right
  );
}

private createExtractedPagesFileName(
  fileName: string,
  pageNumbers: readonly number[]
): string {

  const trimmed =
    fileName.trim() || 'document.pdf';

  const baseName =
    trimmed.toLowerCase().endsWith('.pdf')
      ? trimmed.slice(0, -4)
      : trimmed;

  if (pageNumbers.length === 1) {
    return (
      `${baseName}_page_${pageNumbers[0]}_extracted.pdf`
    );
  }

  const selection =
    this.createExtractionSelectionLabel(
      pageNumbers
    );

  return (
    `${baseName}_pages_${selection}_extracted.pdf`
  );
}

private createExtractionSelectionLabel(
  pageNumbers: readonly number[]
): string {

  if (pageNumbers.length === 0) {
    return 'selection';
  }

  const groups: string[] = [];
  let start =
    pageNumbers[0];
  let previous =
    pageNumbers[0];

  for (
    let index = 1;
    index < pageNumbers.length;
    index++
  ) {
    const current =
      pageNumbers[index];

    if (
      current === previous + 1
    ) {
      previous = current;
      continue;
    }

    groups.push(
      start === previous
        ? String(start)
        : `${start}-${previous}`
    );

    start = current;
    previous = current;
  }

  groups.push(
    start === previous
      ? String(start)
      : `${start}-${previous}`
  );

  return groups.join(
    '_'
  );
}


selectObject(selection: StudioSelection): void {
  if (!this.hasDocument()) {
    return;
  }

  if (selection.pageNumber !== this.currentPage()) {
    return;
  }

  this.state.setSelection(selection);
}

clearSelection(): void {
  this.state.clearSelection();
}

createCommentObject(
  x: number,
  y: number
): StudioSelection | null {
  if (!this.hasDocument()) {
    return null;
  }

  const before = this.captureHistorySnapshot();
  const object = this.objectService.createCommentObject(
    this.currentPage(),
    x,
    y
  );

  this.pendingCommentDrafts.set(object.id, before);

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);
  return selection;
}

updateComment(
  objectId: string,
  content: string
): StudioSelection | null {
  if (!this.hasDocument()) {
    return null;
  }

  const existing =
    this.objectService.get(objectId);

  if (
    !existing ||
    existing.type !== 'comment' ||
    !existing.comment
  ) {
    return null;
  }

  const nextContent =
    content.slice(0, 4000);

  const draftBefore =
    this.pendingCommentDrafts.get(objectId);

  /**
   * Saving unchanged text is a lifecycle no-op. This prevents duplicate
   * Edit comment history entries when Save is clicked without an edit.
   */
  if (
    !draftBefore &&
    nextContent === existing.comment.content
  ) {
    const selection: StudioSelection = {
      objectId: existing.id,
      pageNumber: existing.pageNumber,
      bounds: existing.bounds,
      type: existing.type
    };

    this.state.setSelection(selection);

    return selection;
  }

  const before =
    draftBefore ?? this.captureHistorySnapshot();

  const object =
    this.objectService.updateComment(
      objectId,
      { content: nextContent }
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  if (draftBefore) {
    if (object.comment?.content.trim().length) {
      this.pendingCommentDrafts.delete(objectId);
      this.commitHistoryMutation(
        'Add comment',
        before
      );
    }
  } else {
    this.commitHistoryMutation(
      'Edit comment',
      before
    );
  }

  return selection;
}

setCommentResolved(
  objectId: string,
  resolved: boolean
): StudioSelection | null {
  if (!this.hasDocument()) {
    return null;
  }

  const existing =
    this.objectService.get(objectId);

  if (
    !existing ||
    existing.type !== 'comment' ||
    !existing.comment
  ) {
    return null;
  }

  const draftBefore =
    this.pendingCommentDrafts.get(objectId);

  /**
   * Resolve/Reopen is idempotent. Repeating the current state must not create
   * another history entry or refresh the comment timestamp.
   */
  if (existing.comment.resolved === resolved) {
    const selection: StudioSelection = {
      objectId: existing.id,
      pageNumber: existing.pageNumber,
      bounds: existing.bounds,
      type: existing.type
    };

    this.state.setSelection(selection);

    return selection;
  }

  const before =
    draftBefore ?? this.captureHistorySnapshot();

  const object =
    this.objectService.updateComment(
      objectId,
      { resolved }
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  if (!draftBefore) {
    this.commitHistoryMutation(
      resolved
        ? 'Resolve comment'
        : 'Reopen comment',
      before
    );
  }

  return selection;
}

createTextObject(
  x: number,
  y: number
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.createTextObject(
      this.currentPage(),
      x,
      y
    );

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    'Add text',
    before
  );

  return selection;
}

createImageObject(
  x: number,
  y: number,
  image: StudioImageData
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.createImageObject(
      this.currentPage(),
      x,
      y,
      image
    );

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    'Add image',
    before
  );

  return selection;
}

createShapeObject(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  kind: StudioShapeKind,
  style: StudioShapeStyle
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.createShapeObject(
      this.currentPage(),
      startX,
      startY,
      endX,
      endY,
      kind,
      style
    );

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    'Add shape',
    before
  );

  return selection;
}

createDrawingObject(
  points: readonly StudioPoint[],
  style: StudioDrawingStyle,
  type: 'draw' | 'highlight'
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.createDrawingObject(
      this.currentPage(),
      points,
      style,
      type
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    type === 'draw'
      ? 'Draw stroke'
      : 'Add highlight',
    before
  );

  return selection;
}

/**
 * Begin a pointer-driven object transform.
 *
 * This captures history once instead of once per pointer-move frame.
 */
beginObjectTransform(
  objectId: string
): boolean {

  if (!this.hasDocument()) {
    return false;
  }

  const object =
    this.objectService.get(objectId);

  if (
    !object ||
    object.pageNumber !== this.currentPage()
  ) {
    return false;
  }

  this.pendingObjectTransform = {
    objectId,
    before: this.captureHistorySnapshot()
  };

  return true;
}

/**
 * Apply one live pointer-move frame without creating a history entry.
 */
previewObjectBounds(
  objectId: string,
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const object =
    this.objectService.updateBounds(
      objectId,
      bounds
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  if (object.pageNumber === this.currentPage()) {
    this.state.setSelection(selection);
  }

  return selection;
}

/**
 * Commit one completed pointer transform as one undoable operation.
 */
commitObjectTransform(
  objectId: string
): boolean {

  const pending =
    this.pendingObjectTransform;

  if (
    !pending ||
    pending.objectId !== objectId
  ) {
    return false;
  }

  this.pendingObjectTransform = null;

  /**
   * A draft comment is committed as one atomic Add comment mutation when its
   * first non-empty content is saved. Moving/resizing that draft must remain
   * part of the same pending creation instead of creating an orphaned history
   * entry before the comment exists as a saved annotation.
   */
  if (this.pendingCommentDrafts.has(objectId)) {
    return true;
  }

  this.commitHistoryMutation(
    'Transform object',
    pending.before
  );

  return true;
}

/**
 * Cancel a live pointer transform after the caller restores its original
 * bounds. No history entry is produced.
 */
cancelObjectTransform(
  objectId: string
): void {

  if (
    this.pendingObjectTransform?.objectId === objectId
  ) {
    this.pendingObjectTransform = null;
  }
}

updateObjectBounds(
  objectId: string,
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateBounds(
      objectId,
      bounds
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  if (object.pageNumber === this.currentPage()) {
    this.state.setSelection(selection);
  }

  this.commitHistoryMutation(
    'Transform object',
    before
  );

  return selection;
}

updateShapeStyle(
  objectId: string,
  style: Partial<StudioShapeStyle>
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateShapeStyle(
      objectId,
      style
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    'Change shape style',
    before
  );

  return selection;
}

updateDrawingStyle(
  objectId: string,
  style: Partial<StudioDrawingStyle>
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateDrawingStyle(
      objectId,
      style
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(selection);

  this.commitHistoryMutation(
    'Change drawing style',
    before
  );

  return selection;
}

replaceImageData(
  objectId: string,
  image: StudioImageData
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateImageData(
      objectId,
      image
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(
    selection
  );

  this.commitHistoryMutation(
    'Replace image',
    before
  );

  return selection;
}

duplicateSelectedObject(): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const selectedObjectId =
    this.selectedObjectId();

  if (!selectedObjectId) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.duplicateObject(
      selectedObjectId
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  this.state.setSelection(
    selection
  );

  this.commitHistoryMutation(
    'Duplicate object',
    before
  );

  return selection;
}

updateTextObject(
  objectId: string,
  text: string
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateText(
      objectId,
      text
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  if (
    object.pageNumber ===
    this.currentPage()
  ) {
    this.state.setSelection(
      selection
    );
  }

  this.commitHistoryMutation(
    'Edit text',
    before
  );

  return selection;
}

updateTextStyle(
  objectId: string,
  style: Partial<StudioTextStyle>
): StudioSelection | null {

  if (!this.hasDocument()) {
    return null;
  }

  const before =
    this.captureHistorySnapshot();

  const object =
    this.objectService.updateTextStyle(
      objectId,
      style
    );

  if (!object) {
    return null;
  }

  const selection: StudioSelection = {
    objectId: object.id,
    pageNumber: object.pageNumber,
    bounds: object.bounds,
    type: object.type
  };

  if (
    object.pageNumber ===
    this.currentPage()
  ) {
    this.state.setSelection(
      selection
    );
  }

  this.commitHistoryMutation(
    'Change text style',
    before
  );

  return selection;
}

}
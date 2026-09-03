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

  const pageNumber = this.currentPage();
  const logicalPage = this.pageService.pageAt(pageNumber);
  if (!logicalPage) return null;
  if (logicalPage.kind === 'blank') {
    const width = logicalPage.blankWidth ?? 595.28;
    const height = logicalPage.blankHeight ?? 841.89;
    const context = canvas.getContext('2d');
    if (!context) return null;
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return { width, height, scale: 1 };
  }
  const sourcePageNumber = logicalPage.sourcePageNumber ?? pageNumber;
  const rotation = logicalPage.rotation;

  const viewMode =
    this.viewMode();

  switch (viewMode) {

    case 'fit-width':

      return this.pageRenderer.renderPage(
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

    case 'zoom':

      return this.pageRenderer.renderPage(
        document.pdf,
        sourcePageNumber,
        canvas,
        {
          mode: 'zoom',
          rotation,
          zoomPercent: this.zoom()
        }
      );

    case 'fit-page':
    default:

      return this.pageRenderer.renderPage(
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
  }
}

/**
 * Render a specific page.
 */
async renderPage(
  canvas: HTMLCanvasElement,
  pageNumber: number,
  viewportWidth: number,
  viewportHeight: number
): Promise<RenderedPageSize | null> {

  const document =
    this.document();

  if (!document) {
    return null;
  }

  this.state.setCurrentPage(
    pageNumber
  );

  return this.renderCurrentPage(
    canvas,
    viewportWidth,
    viewportHeight
  );
}

/**
 * Clear the current Studio canvas.
 */
clearCanvas(
  canvas: HTMLCanvasElement
): void {

  this.pageRenderer.clearCanvas(
    canvas
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

      this.toast.show(
        'Extract will be available in the next editing stage.',
        'info'
      );

      return;

    case 'comment':

      this.toast.show(
        'Comments will be available in the next editing stage.',
        'info'
      );

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

    const object =
      this.objectService.get(
        selectedObjectId
      );

    if (!object) {
      this.state.clearSelection();
      return false;
    }

    const before =
      this.captureHistorySnapshot();

    const removed =
      this.objectService.remove(
        selectedObjectId
      );

    this.state.clearSelection();

    if (!removed) {
      return false;
    }

    this.commitHistoryMutation(
      'Delete object',
      before
    );

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
      this.objectService.clearAll();
      this.history.reset();
      this.state.clear();
    }
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
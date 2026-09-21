import {
  Injectable,
  computed,
  inject,
  signal
} from '@angular/core';

import { LoaderService } from '../../../shared/services/loader.service';
import { ToastService } from '../../../shared/services/toast.service';

import { PdfEngineService } from '../services/pdf-engine.service';
import { PdfContentAnalysisService } from '../services/pdf-content-analysis.service';
import { StudioStateService, StudioViewMode } from '../state/studio-state.service';
import { ThumbnailService } from '../services/thumbnail.service';

import {
  PdfPageRendererService,
  RenderedPageSize
} from '../services/pdf-page-renderer.service';
import { StudioToolId } from '../models/studio-tool.model';
import { StudioObjectService } from '../services/studio-object.service';
import { StudioSelection } from '../models/studio-selection.model';
import type { SigningAsset } from '../../../core/signing/models/signing.models';

import type {
  StudioObject,
  StudioImageData,
  StudioTextStyle,
  StudioShapeKind,
  StudioShapeStyle,
  StudioDrawingStyle,
  StudioPoint,
  StudioLinkData,
  StudioSignatureObject,
  StudioObjectBounds
} from '../models/studio-selection.model';
import { StudioPdfExportService } from '../services/studio-pdf-export.service';
import { PdfSecurityService } from '../../../core/security/pdf-security.service';
import type { PdfSecurityMode, PdfSecurityRequest } from '../../../core/security/pdf-security.types';
import { saveAs } from 'file-saver';
import { StudioPageService } from '../services/studio-page.service';
import {
  StudioHistoryService,
  StudioHistorySnapshot
} from '../services/studio-history.service';
import type { StudioPage } from '../models/studio-page.model';
import type { StudioPdfDocument } from '../models/pdf-document.model';

@Injectable({
  providedIn: 'root'
})
export class StudioFacade {

  private readonly pdfEngine =
    inject(PdfEngineService);

  private readonly state =
    inject(StudioStateService);

  private readonly contentAnalysis =
    inject(PdfContentAnalysisService);

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

  private readonly pdfSecurity =
    inject(PdfSecurityService);

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

  /** Phase 5A — extracted map of content already present in the uploaded PDF. */
  readonly contentAnalysisState = this.contentAnalysis.analysis;

  /**
   * F5 — Header and keyboard bindings consume these reactive signals.
   */
  readonly canUndo =
    this.history.canUndo;

  readonly canRedo =
    this.history.canRedo;

  readonly passwordPromptOpen = signal(false);
  readonly passwordPromptFileName = signal('');
  readonly passwordPromptError = signal<string | null>(null);
  readonly securityDialogOpen = signal(false);
  readonly securityDialogMode = signal<PdfSecurityMode>('protect');
  readonly securityDialogBusy = signal(false);
  readonly securityDialogError = signal<string | null>(null);

  private pendingPasswordFile: File | null = null;

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
  async loadPdf(file: File, password?: string): Promise<void> {
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
        await this.pdfEngine.loadFile(file, password);

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
       * A successfully opened document starts a new Studio editing session, so
       * old objects must be cleared BEFORE content analysis is allowed to sync
       * new page overlays. The previous order started page-1 analysis and then
       * cleared the object store, creating a timing race that could erase the
       * detected overlays (especially on page 1).
       */
      this.objectService.clearAll();
      this.pendingCommentDrafts.clear();

      // Start the editable-content foundation with page 1 only after the new
      // document session is clean. Remaining pages are analyzed lazily.
      this.contentAnalysis.begin(newDocument);
      void this.contentAnalysis.ensurePage(
        newDocument,
        1,
        pageNumber => this.pdfEngine.getPage(newDocument, pageNumber)
      ).then(result => {
        // Ignore stale analysis from a PDF that has since been replaced.
        if (result && this.document()?.id === newDocument.id) {
          this.objectService.syncPdfTextBlocks(result.textBlocks);
          this.objectService.syncPdfImageBlocks(result.imageBlocks);
        }
      });

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
      if (!password && this.isPasswordRequiredError(error)) {
        this.pendingPasswordFile = file;
        this.passwordPromptFileName.set(file.name);
        this.passwordPromptError.set(null);
        this.passwordPromptOpen.set(true);
        this.state.setError('Password required to open this PDF.');
        this.loader.hide();
        return;
      }

      if (password && this.isInvalidSecurityPasswordError(error)) {
        this.passwordPromptError.set('The password is incorrect. Please try again.');
        this.state.setError('The PDF password was incorrect.');
        return;
      }

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

  submitPdfPassword(password: string): void {
    const file = this.pendingPasswordFile;
    const value = password.trim();

    if (!file || !value) {
      this.passwordPromptError.set('Enter the PDF password.');
      return;
    }

    this.passwordPromptError.set(null);
    void this.loadPdf(file, value).then(() => {
      if (this.hasDocument()) {
        this.passwordPromptOpen.set(false);
        this.pendingPasswordFile = null;
      }
    });
  }

  cancelPdfPasswordPrompt(): void {
    if (this.isLoading()) return;
    this.passwordPromptOpen.set(false);
    this.passwordPromptError.set(null);
    this.pendingPasswordFile = null;
  }

  openSecurityDialog(mode: PdfSecurityMode): void {
    if (!this.hasDocument()) return;
    this.securityDialogMode.set(mode);
    this.securityDialogError.set(null);
    this.securityDialogOpen.set(true);
  }

  closeSecurityDialog(): void {
    if (this.securityDialogBusy()) return;
    this.securityDialogOpen.set(false);
    this.securityDialogError.set(null);
  }

  async runSecurityOperation(request: PdfSecurityRequest): Promise<void> {
    const document = this.document();
    if (!document || this.securityDialogBusy()) return;

    this.securityDialogBusy.set(true);
    this.securityDialogError.set(null);
    this.loader.show('Applying PDF security...');
    this.loader.setProgress?.(0);
    this.loader.setText('Preparing PDF security operation...');

    try {
      if (request.mode !== 'protect' && document.sourceWasProtected) {
        // Verify the supplied password against the original protected source.
        // The returned decrypted bytes are intentionally kept only in memory.
        await this.pdfSecurity.unlock(
          document.sourceFile ?? document.file,
          request.password,
          progress => {
            this.loader.setProgress?.(progress);
            this.loader.setText('Verifying PDF password locally...');
          }
        );
      }

      const sourceBlob = await this.pdfExportService.exportTextObjects(
        document.file,
        this.collectAllObjects(),
        this.pages()
      );

      const exportedFile = new File(
        [sourceBlob],
        document.file.name,
        { type: 'application/pdf' }
      );

      let outputFile = exportedFile;

      if (request.mode === 'protect') {
        const result = await this.pdfSecurity.protect(
          exportedFile,
          {
            userPassword: request.password,
            permissions: request.permissions ?? {
              allowPrinting: true,
              allowCopying: true,
              allowModifying: false,
              allowAnnotations: true,
              allowForms: true,
              allowAssembly: false
            },
            bits: 256
          },
          progress => {
            this.loader.setProgress?.(progress);
            this.loader.setText('Encrypting PDF locally...');
          }
        );
        outputFile = result.file;
      }

      saveAs(outputFile, request.mode === 'protect'
        ? outputFile.name
        : this.securityOutputName(document.file.name, request.mode));
      this.securityDialogOpen.set(false);
      this.toast.show(
        request.mode === 'protect'
          ? 'Protected PDF exported successfully.'
          : request.mode === 'unlock'
            ? 'Unlocked PDF exported successfully.'
            : 'Password-free PDF exported successfully.',
        'success'
      );
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'PDF security operation failed.';
      this.securityDialogError.set(message);
      this.toast.show(message, 'error');
    } finally {
      this.securityDialogBusy.set(false);
      this.loader.hide();
    }
  }

  private securityOutputName(name: string, mode: PdfSecurityMode): string {
    const base = name.replace(/\.pdf$/i, '') || 'document';
    const suffix = mode === 'unlock' ? 'unlocked' : 'password-removed';
    return `${base}_${suffix}.pdf`;
  }

  private collectAllObjects(): readonly StudioObject[] {
    return Array.from(
      { length: this.pageCount() },
      (_, index) => this.objectService.listForPage(index + 1)
    ).flat();
  }

  private isPasswordRequiredError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'name' in error) {
      return String((error as { name?: unknown }).name) === 'PasswordException';
    }
    return false;
  }

  private isInvalidSecurityPasswordError(error: unknown): boolean {
    return error instanceof Error && (
      error.name === 'PdfSecurityError' ||
      error.message.toLowerCase().includes('password')
    );
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

  /**
   * Dedicated source-edit tools require page-scoped analysis overlays.
   * Ensure the current page is analyzed when either toolbar tool is activated,
   * so the tool never depends on a previous navigation/render finishing first.
   */
  if (
    tool === 'edit-pdf-text' ||
    tool === 'edit-pdf-image'
  ) {
    const document = this.document();
    if (document) {
      void this.ensurePageContent(
        document,
        this.currentPage()
      );
    }
  }
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
      this.setActiveTool('link');
      this.toast.show('Click the page to add a link, then set its destination in the inspector.', 'info');
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

    // Existing PDF text is part of the source document. Deleting its Studio
    // representation must restore the original text, not remove the hit target.
    if (object.type === 'text' && object.pdfText) {
      const restored = this.objectService.restorePdfText(objectId);
      if (restored) {
        this.state.setSelection({ objectId: restored.id, pageNumber: restored.pageNumber, bounds: restored.bounds, type: restored.type });
        this.commitHistoryMutation('Restore original PDF text', before);
        return true;
      }
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

  // Existing PDF text may be intentionally cleared. Keep its source mapping so
  // export can cover the original region instead of deleting the editable map.
  if (object.pdfText) {
    this.updateTextObject(objectId, '');
    return true;
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
          'This PDF is password protected. Enter the password to continue.'
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

  /**
   * F7.3 — Move a selected set of logical pages as one ordered group.
   *
   * Page identity remains stable while object page numbers are remapped from
   * the exact before/after logical ordering. This avoids fragile arithmetic
   * remapping for non-contiguous selections.
   */
  movePages(
    pageNumbers: readonly number[],
    targetPage: number
  ): boolean {

    const selected =
      this.normalizePageNumbers(
        pageNumbers
      );

    const count =
      this.pageCount();

    if (
      selected.length === 0 ||
      !Number.isInteger(targetPage) ||
      targetPage < 1 ||
      targetPage > count + 1
    ) {
      return false;
    }

    return this.recordPageMutation(
      selected.length === 1
        ? 'Move page'
        : 'Move pages',
      () => {

        const beforePages =
          this.pageService.pages();

        const currentId =
          beforePages[
            this.currentPage() - 1
          ]?.id ?? null;

        const oldPositions =
          new Map(
            beforePages.map(
              (page, index) => [
                page.id,
                index + 1
              ] as const
            )
          );

        if (
          !this.pageService.moveMany(
            selected,
            targetPage
          )
        ) {
          return false;
        }

        const afterPages =
          this.pageService.pages();

        const mapping =
          new Map<number, number>();

        for (
          let index = 0;
          index < afterPages.length;
          index++
        ) {
          const page =
            afterPages[index];

          const oldPosition =
            oldPositions.get(
              page.id
            );

          if (
            oldPosition !== undefined
          ) {
            mapping.set(
              oldPosition,
              index + 1
            );
          }
        }

        this.objectService.remapPageNumbers(
          mapping
        );

        this.state.clearSelection();

        const nextCurrent =
          currentId
            ? afterPages.findIndex(
                page =>
                  page.id === currentId
              ) + 1
            : 0;

        this.state.setCurrentPage(
          nextCurrent > 0
            ? nextCurrent
            : this.currentPage()
        );

        return true;
      }
    );
  }

  /**
   * Move selected pages by one visual position while preserving gaps in a
   * non-contiguous selection. This is used by the Move Up/Down bulk actions.
   */
  movePagesOneStep(
    pageNumbers: readonly number[],
    direction: 'up' | 'down'
  ): boolean {
    const selected = this.normalizePageNumbers(pageNumbers);
    if (!selected.length) return false;

    return this.recordPageMutation(
      direction === 'up'
        ? (selected.length === 1 ? 'Move page up' : 'Move pages up')
        : (selected.length === 1 ? 'Move page down' : 'Move pages down'),
      () => {
        const beforePages = this.pageService.pages();
        const currentId = beforePages[this.currentPage() - 1]?.id ?? null;
        const oldPositions = new Map(
          beforePages.map((page, index) => [page.id, index + 1] as const)
        );

        if (!this.pageService.moveManyOneStep(selected, direction)) {
          return false;
        }

        const afterPages = this.pageService.pages();
        const mapping = new Map<number, number>();
        afterPages.forEach((page, index) => {
          const oldPosition = oldPositions.get(page.id);
          if (oldPosition !== undefined) mapping.set(oldPosition, index + 1);
        });

        this.objectService.remapPageNumbers(mapping);
        this.state.clearSelection();

        const nextCurrent = currentId
          ? afterPages.findIndex(page => page.id === currentId) + 1
          : 0;
        this.state.setCurrentPage(nextCurrent > 0 ? nextCurrent : this.currentPage());
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

  async insertBlankPage(
  afterCurrent = true
): Promise<void> {

  if (!this.hasDocument()) {
    return;
  }

  const current =
    this.currentPage();

  const dimensions =
    await this.resolveBlankPageDimensions(
      current
    );

  this.recordPageMutation(
    afterCurrent
      ? 'Insert page after'
      : 'Insert page before',
    () => {

      const position =
        afterCurrent
          ? current + 1
          : current;

      const target =
        this.pageService.insertBlank(
          position,
          dimensions.width,
          dimensions.height
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

private async resolveBlankPageDimensions(
  pageNumber: number
): Promise<{
  width: number;
  height: number;
}> {

  const fallback = {
    width: 595.28,
    height: 841.89
  };

  const logicalPage =
    this.pageService.pageAt(
      pageNumber
    );

  if (!logicalPage) {
    return fallback;
  }

  /**
   * Existing blank page:
   *
   * Resolve its displayed dimensions, including
   * any Studio rotation.
   */
  if (
    logicalPage.kind === 'blank'
  ) {

    const baseWidth =
      logicalPage.blankWidth ??
      fallback.width;

    const baseHeight =
      logicalPage.blankHeight ??
      fallback.height;

    const rotated =
      logicalPage.rotation === 90 ||
      logicalPage.rotation === 270;

    return {
      width:
        rotated
          ? baseHeight
          : baseWidth,

      height:
        rotated
          ? baseWidth
          : baseHeight
    };
  }

  const document =
    this.document();

  if (
    !document ||
    logicalPage.sourcePageNumber === null
  ) {
    return fallback;
  }

  try {

    const pdfPage =
      await document.pdf.getPage(
        logicalPage.sourcePageNumber
      );

    const viewport =
      pdfPage.getViewport({
        scale: 1,
        rotation:
          logicalPage.rotation
      });

    return {
      width:
        viewport.width > 0
          ? viewport.width
          : fallback.width,

      height:
        viewport.height > 0
          ? viewport.height
          : fallback.height
    };

  } catch {

    /**
     * Insertion must remain functional even if
     * page-dimension lookup fails.
     */
    return fallback;
  }
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


  /**
   * F7.3 — Duplicate multiple logical pages as one atomic history mutation.
   * Selection is supplied as current logical positions and is normalized before
   * any insertion shifts those positions.
   */
  duplicatePages(pageNumbers: readonly number[]): void {
    const selected = this.normalizePageNumbers(pageNumbers);

    if (!selected.length) {
      return;
    }

    this.recordPageMutation(
      selected.length === 1 ? 'Duplicate page' : 'Duplicate pages',
      () => {
        let offset = 0;
        const current = this.currentPage();
        let nextCurrent = current;

        for (const originalPosition of selected) {
          const source = originalPosition + offset;
          const target = this.pageService.duplicate(source);

          if (!target) {
            return false;
          }

          this.objectService.shiftPageNumbers(target, 1);
          this.objectService.duplicatePage(source, target);

          if (nextCurrent >= target) {
            nextCurrent++;
          }

          offset++;
        }

        this.state.setPageCount(this.pageCount());
        this.state.clearSelection();
        this.state.setCurrentPage(nextCurrent);
        return true;
      }
    );
  }

  /** Rotate a set of logical pages without changing page identity/order. */
  rotatePages(
    pageNumbers: readonly number[],
    direction: 'left' | 'right' = 'right'
  ): void {
    const selected = this.normalizePageNumbers(pageNumbers);

    if (!selected.length) {
      return;
    }

    this.recordPageMutation(
      direction === 'left'
        ? (selected.length === 1 ? 'Rotate page left' : 'Rotate pages left')
        : (selected.length === 1 ? 'Rotate page right' : 'Rotate pages right'),
      () => {
        const delta = direction === 'left' ? -90 : 90;
        let changed = false;

        for (const pageNumber of selected) {
          changed = this.pageService.rotate(pageNumber, delta) || changed;
        }

        if (changed) {
          this.state.clearSelection();
        }

        return changed;
      }
    );
  }

  /**
   * Delete multiple pages atomically while preserving all remaining object
   * mappings. The last page is protected, matching single-page deletion.
   */
  deletePages(pageNumbers: readonly number[]): void {
    const selected = this.normalizePageNumbers(pageNumbers);

    if (!selected.length) {
      return;
    }

    const count = this.pageCount();

    if (selected.length >= count) {
      this.toast.show(
        'A PDF must contain at least one page.',
        'info'
      );
      return;
    }

    this.recordPageMutation(
      selected.length === 1 ? 'Delete page' : 'Delete pages',
      () => {
        const deleted = new Set(selected);
        const currentBefore = this.currentPage();

        /* Remove objects from deleted pages before remapping survivors. */
        for (const pageNumber of selected) {
          this.objectService.clearPage(pageNumber);
        }

        /* Build the old -> new mapping from the pre-mutation positions. */
        const mapping = new Map<number, number>();
        let next = 1;

        for (let old = 1; old <= count; old++) {
          if (!deleted.has(old)) {
            mapping.set(old, next++);
          }
        }

        /* Delete from the end so original positions remain valid. */
        for (let index = selected.length - 1; index >= 0; index--) {
          if (!this.pageService.delete(selected[index])) {
            return false;
          }
        }

        this.objectService.remapPageNumbers(mapping);
        this.state.setPageCount(this.pageCount());
        this.state.clearSelection();

        const nextCurrent = mapping.get(currentBefore)
          ?? Math.min(
            currentBefore,
            this.pageCount()
          );

        this.state.setCurrentPage(nextCurrent);
        return true;
      }
    );
  }

  private normalizePageNumbers(
    pageNumbers: readonly number[]
  ): number[] {
    const count = this.pageCount();

    return Array.from(
      new Set(
        pageNumbers.filter(
          page => Number.isInteger(page) && page >= 1 && page <= count
        )
      )
    ).sort((a, b) => a - b);
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

  const document = this.document();

  /**
   * Content analysis is asynchronous. Re-requesting the already-visible page
   * must therefore still ensure its source overlays are materialized; the old
   * early return could leave the current page permanently without editable PDF
   * text/image objects after a timing race.
   */
  if (
    page === this.currentPage()
  ) {
    if (document) {
      void this.ensurePageContent(document, page);
    }
    return;
  }

  this.state.clearSelection();

  this.state.setCurrentPage(
    page
  );

  if (document) {
    void this.ensurePageContent(document, page);
  }
}

  /**
   * Ensure the currently visible logical page has source PDF overlays.
   *
   * This is intentionally public so interaction tools can await the same
   * page-analysis lifecycle used by navigation. In particular, the
   * edit-pdf-text tool must not require a tool toggle after page navigation
   * just because PDF.js text extraction is asynchronous.
   */
  async ensureCurrentPageContent(): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    const page = this.currentPage();
    await this.ensurePageContent(document, page);
  }

  /**
   * Ensure one logical page has source text/image overlays. This helper is
   * shared by navigation and dedicated edit-tool activation so every PDF page
   * follows the same analysis lifecycle.
   */
  private async ensurePageContent(
    document: StudioPdfDocument,
    pageNumber: number
  ): Promise<void> {
    const result = await this.contentAnalysis.ensurePage(
      document,
      pageNumber,
      currentPageNumber =>
        this.pdfEngine.getPage(document, currentPageNumber)
    );

    // A late analysis result must never mutate a replacement document.
    if (
      !result ||
      this.document()?.id !== document.id
    ) {
      return;
    }

    this.objectService.syncPdfTextBlocks(
      result.textBlocks
    );
    this.objectService.syncPdfImageBlocks(
      result.imageBlocks
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


  createLinkObject(x: number, y: number): StudioSelection | null {
    if (!this.hasDocument()) return null;
    const before = this.captureHistorySnapshot();
    const object = this.objectService.createLinkObject(this.currentPage(), x, y);
    const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
    this.state.setSelection(selection);
    this.commitHistoryMutation('Add link', before);
    return selection;
  }

  updateLink(objectId: string, patch: Partial<StudioLinkData>): StudioSelection | null {
    if (!this.hasDocument()) return null;
    const before = this.captureHistorySnapshot();
    const object = this.objectService.updateLink(objectId, patch);
    if (!object) return null;
    const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
    this.state.setSelection(selection);
    this.commitHistoryMutation('Edit link', before);
    return selection;
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

createSignatureObject(
  x: number,
  y: number,
  asset: SigningAsset
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.createSignatureObject(this.currentPage(), x, y, asset);
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation('Add signature', before);
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

createSigningFieldObject(
  x: number,
  y: number,
  kind: 'text' | 'date' | 'checkbox'
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.createSigningFieldObject(this.currentPage(), x, y, kind);
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation(`Add ${kind}`, before);
  return selection;
}

async applySigningObjectToPages(
  objectId: string,
  pageNumbers: readonly number[],
  position: 'same' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'same'
): Promise<boolean> {
  if (!this.hasDocument()) return false;
  const source = this.objectService.get(objectId);
  if (!source || source.type !== 'signature') return false;

  const pages = [...new Set(pageNumbers)].filter(page => page >= 1 && page <= this.pages().length);
  if (!pages.length) return false;

  this.loader.show(`Applying ${this.signingLabel(source.signing.kind)} to ${pages.length.toLocaleString()} pages…`);
  this.loader.setProgress(2);
  this.loader.setText('Preparing signing pages…');

  try {
    const before = this.captureHistorySnapshot();
    const groupId = source.signing.bulkGroupId ?? this.createSigningId();
    const existingByPage = new Map<number, StudioSignatureObject>();
    for (const item of this.objectService.snapshot()) {
      if (item.type === 'signature' && item.signing.bulkGroupId === groupId && item.signing.kind === source.signing.kind) {
        existingByPage.set(item.pageNumber, item);
      }
    }

    const changes: StudioObject[] = [];
    const total = pages.length;
    for (let index = 0; index < total; index += 1) {
      const pageNumber = pages[index];
      const bounds = this.positionSigningBounds(source.bounds, position);
      const existing = existingByPage.get(pageNumber);

      if (existing) {
        changes.push({
          ...source,
          id: existing.id,
          pageNumber,
          bounds,
          signing: { ...source.signing, bulkGroupId: groupId },
        });
      } else if (pageNumber === source.pageNumber) {
        changes.push({
          ...source,
          bounds,
          signing: { ...source.signing, bulkGroupId: groupId },
        });
      } else {
        const { asset: _asset, ...signingWithoutAsset } = source.signing;
        changes.push({
          ...source,
          id: this.createSigningId(),
          pageNumber,
          bounds,
          signing: {
            ...signingWithoutAsset,
            assetId: source.signing.assetId ?? source.signing.asset?.id,
            bulkGroupId: groupId,
          },
        });
      }

      if ((index + 1) % 32 === 0 || index === total - 1) {
        this.loader.setProgress(5 + ((index + 1) / total) * 88);
        this.loader.setText(`Preparing page ${(index + 1).toLocaleString()} of ${total.toLocaleString()}…`);
        if (index !== total - 1) await this.yieldToBrowser();
      }
    }

    this.objectService.addMany(changes);
    this.loader.setProgress(94);
    this.loader.setText('Saving this change to Undo history…');
    await this.yieldToBrowser();
    this.commitHistoryMutation('Apply signing field to pages', before);
    this.loader.setProgress(100);
    this.loader.setText(`Applied to ${total.toLocaleString()} pages ✓`);
    return true;
  } catch (error) {
    console.error('[SafePDFHub Studio] Bulk signing apply failed:', error);
    this.toast.show('Could not apply the signing field to all selected pages.', 'error');
    this.loader.setText('Applying signing field failed');
    return false;
  } finally {
    this.loader.hide();
  }
}

private signingLabel(kind: StudioSignatureObject['signing']['kind']): string {
  switch (kind) {
    case 'date': return 'date';
    case 'text': return 'text';
    case 'checkbox': return 'checkbox';
    case 'initials': return 'initials';
    default: return 'signature';
  }
}

private yieldToBrowser(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

removeSigningObjectFromPages(objectId: string, pageNumbers: readonly number[]): boolean {
  if (!this.hasDocument()) return false;
  const source = this.objectService.get(objectId);
  if (!source || source.type !== 'signature' || !source.signing.bulkGroupId) return false;
  const before = this.captureHistorySnapshot();
  const groupId = source.signing.bulkGroupId;
  const pages = new Set(pageNumbers);
  for (const object of this.objectService.snapshot()) {
    if (object.type === 'signature' && object.signing.bulkGroupId === groupId && pages.has(object.pageNumber)) {
      this.objectService.remove(object.id);
    }
  }
  this.commitHistoryMutation('Remove signing field from pages', before);
  this.state.clearSelection();
  return true;
}

private positionSigningBounds(
  bounds: StudioObjectBounds,
  position: 'same' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
): StudioObjectBounds {
  if (position === 'same') return { ...bounds };
  const margin = 0.06;
  let x = bounds.x;
  let y = bounds.y;
  if (position.includes('left')) x = margin;
  if (position.includes('right')) x = 1 - margin - bounds.width;
  if (position.includes('top')) y = margin;
  if (position.includes('bottom')) y = 1 - margin - bounds.height;
  if (position === 'center') { x = (1 - bounds.width) / 2; y = (1 - bounds.height) / 2; }
  return { ...bounds, x: Math.max(0, Math.min(1 - bounds.width, x)), y: Math.max(0, Math.min(1 - bounds.height, y)) };
}

private createSigningId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

updateSigningFieldStyle(
  objectId: string,
  style: { value?: string; fontFamily?: string; fontSize?: number; fontStyle?: 'normal' | 'italic'; color?: string; checked?: boolean; opacity?: number; bulkGroupId?: string },
  historyLabel = 'Change signing field'
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updateSigningFieldStyle(objectId, style);
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation(historyLabel, before);
  return selection;
}

updateSignatureStyle(objectId: string, style: { opacity?: number }): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updateSignatureStyle(objectId, style);
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation('Change signature appearance', before);
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

updatePdfImageFitMode(
  objectId: string,
  fitMode: 'fit' | 'fill' | 'stretch'
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updatePdfImage(objectId, { fitMode });
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation('Change image replacement fit', before);
  return selection;
}

updatePdfImageBackground(
  objectId: string,
  patch: { backgroundMode?: 'auto' | 'solid' | 'white' | 'pixel' | 'layered'; backgroundColor?: string; backgroundConfidence?: 'high' | 'medium' | 'low'; pixelReconstructionDataUrl?: string; pixelReconstructionConfidence?: 'high' | 'medium' | 'low'; layeredReconstructionDataUrl?: string; seamBlendDataUrl?: string; seamBlendWidth?: number; seamBlendConfidence?: 'high' | 'medium' | 'low' }
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updatePdfImage(objectId, patch);
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation('Reconstruct image background', before);
  return selection;
}

restoreOriginalPdfImage(objectId: string): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updatePdfImage(objectId, { replaced: false });
  if (!object) return null;
  // Remove replacement artwork while keeping the selectable source mapping.
  this.objectService.clearImageData(objectId);
  const selection: StudioSelection = { objectId, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  this.state.setSelection(selection);
  this.commitHistoryMutation('Restore original PDF image', before);
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

updatePdfTextAppearance(
  objectId: string,
  patch: { backgroundColor?: string; textColor?: string; coverPadding?: number; fitMode?: 'original' | 'auto'; metricScaleX?: number }
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.updatePdfTextAppearance(objectId, patch);
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  if (object.pageNumber === this.currentPage()) this.state.setSelection(selection);
  this.commitHistoryMutation('Change PDF text replacement appearance', before);
  return selection;
}

restoreOriginalPdfText(
  objectId: string
): StudioSelection | null {
  if (!this.hasDocument()) return null;
  const before = this.captureHistorySnapshot();
  const object = this.objectService.restorePdfText(objectId);
  if (!object) return null;
  const selection: StudioSelection = { objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type };
  if (object.pageNumber === this.currentPage()) this.state.setSelection(selection);
  this.commitHistoryMutation('Restore original PDF text', before);
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
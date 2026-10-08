import { pdfFontSize, textFontWeight, textFontStyle, pdfFontFaceChanged } from '../../services/studio-text-typography';
import { fitPreviewFontSize } from '../../services/studio-text-preview';
import { readStudioImage } from '../../services/studio-image-import';
import { visibleStudioSources, studioDisplayBounds } from '../../services/studio-source-visibility';
import { isPlatformBrowser } from '@angular/common';
import { SigningStateService } from '../../../../core/signing/services/signing-state.service';
import type { SigningAsset } from '../../../../core/signing/models/signing.models';
import {
  AfterViewInit,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';

import { StudioPdfExportService } from '../../services/studio-pdf-export.service';
import { StudioFacade } from '../../facade/studio.facade';
import { SelectionEngineService } from '../../services/selection-engine.service';
import { StudioObjectService } from '../../services/studio-object.service';
import type { StudioToolId } from '../../models/studio-tool.model';
import { StudioWatermarkStateService } from '../../state/studio-watermark-state.service';
import { watermarkDisplayPositionCenter, watermarkTiledCenters, watermarkTiledScale, resolveWatermarkPageSelection } from '../../../../core/watermark/pdf-watermark.service';
import { PdfWatermarkMetricsService, type WatermarkTextMetrics } from '../../../../core/watermark/pdf-watermark-metrics.service';
import type {
  StudioObject,
  StudioImageData,
  StudioTextStyle,
  StudioShapeKind,
  StudioShapeStyle,
  StudioDrawingStyle,
  StudioPoint
} from '../../models/studio-selection.model';

type SelectionResizeHandle =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se';

type F3PaletteId = 'shape' | 'draw' | 'highlight';

interface PalettePosition {
  left: number;
  top: number;
}

interface PaletteDragState {
  readonly palette: F3PaletteId;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startLeft: number;
  readonly startTop: number;
}

interface ObjectInteraction {
  readonly mode: 'move' | 'resize';
  readonly objectId: string;
  readonly objectType: StudioObject['type'];
  readonly pointerId: number;
  readonly handle?: SelectionResizeHandle;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly preserveAspectRatio: boolean;
}

@Component({
  selector: 'app-studio-canvas',
  standalone: true,
  templateUrl: './studio-canvas.html',
  styleUrl: './studio-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioCanvas implements AfterViewInit, OnDestroy {
  private lastRenderState = '';
  private currentRender: Promise<void> = Promise.resolve();
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly signingState = inject(SigningStateService);

  readonly signingPointer = signal<{ x:number; y:number } | null>(null);
  get signingPlacementReady(): boolean {
    if (this.facade.activeTool() !== 'sign' || !this.facade.hasDocument()) return false;
    const kind = this.signingState.activeKind();
    return kind === 'text' || kind === 'date' || kind === 'checkbox' || this.signingState.activeAsset()?.kind === kind;
  }
  get signingPlacementLabel(): string {
    return this.signingState.activeKind() === 'initials' ? 'initials' : this.signingState.activeKind() === 'signature' ? 'signature' : this.signingState.activeKind() + ' field';
  }
  get signingGhostBounds(): {x:number;y:number;width:number;height:number} | null {
    const point = this.signingPointer();
    if (!point || !this.signingPlacementReady) return null;
    const asset = this.signingState.activeAsset(), kind = this.signingState.activeKind();
    const width = kind === 'initials' ? .15 : kind === 'checkbox' ? .04 : .23;
    const height = asset && (kind === 'signature' || kind === 'initials')
      ? Math.max(.045,Math.min(.14,width * asset.naturalHeight / Math.max(1,asset.naturalWidth))) : .045;
    return {x:Math.max(0,Math.min(1-width,point.x-width/2)),y:Math.max(0,Math.min(1-height,point.y-height/2)),width,height};
  }
  cancelSigningPlacement(): void { this.signingPointer.set(null); this.facade.setActiveTool('select'); }
  private updateSigningPointer(event: PointerEvent): void {
    const rect = this.pageRef?.nativeElement.getBoundingClientRect();
    if (!this.signingPlacementReady || !rect || event.pointerType === 'touch' || this.spacePressed
      || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      this.signingPointer.set(null); return;
    }
    this.signingPointer.set({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
  }

  getSigningAsset(object: StudioObject): SigningAsset | null {
    if (object.type !== 'signature' || !object.signing) return null;
    return object.signing.asset ?? null;
  }

  readonly facade =
    inject(StudioFacade);

  readonly watermark =
    inject(StudioWatermarkStateService);

  readonly watermarkImageUrl = signal('');
  readonly watermarkImageAspectRatio = signal(1);
  readonly watermarkTextMetrics = signal<WatermarkTextMetrics | null>(null);
  private watermarkTextMetricsGeneration = 0;
  private watermarkImageFile: File | null = null;
  private readonly watermarkMetrics = inject(PdfWatermarkMetricsService);

  @ViewChild('pdfCanvas', {
    static: true
  })
  private canvasRef?: ElementRef<HTMLCanvasElement>;

  /**
   * Scroll container.
   *
   * The viewport is responsible ONLY for scrolling.
   */
  @ViewChild('pdfViewport', {
    static: true
  })
  private viewportRef?: ElementRef<HTMLDivElement>;

  /**
   * Interaction surface.
   *
   * Mouse wheel / pointer interactions are handled
   * by the stage rather than the scroll container.
   */
  @ViewChild('pdfStage', {
    static: true
  })
  private stageRef?: ElementRef<HTMLDivElement>;

  /**
   * Actual PDF page wrapper.
   */
  @ViewChild('pdfPage', {
    static: true
  })
  private pageRef?: ElementRef<HTMLDivElement>;

  /**
   * Prevent stale asynchronous render completions
   * from changing the current UI.
   */
  private renderVersion = 0;

  /**
 * True once the component has entered destruction.
 *
 * Prevents late asynchronous render completions from updating
 * component state after Angular has destroyed the canvas view.
 */
private destroyed = false;

/**
 * The render version currently considered the owner of the
 * main canvas lifecycle.
 *
 * This is component-level ownership only. The shared page renderer
 * remains responsible for cancelling/serializing the underlying
 * PDF.js work for the canvas.
 */
private activeRenderVersion: number | null = null;


  /**
   * Actual PDF.js page scale used for the current render.
   *
   * F3 stroke widths are stored in document-normalized page space, so
   * this value converts between the current CSS viewport and PDF units
   * without making exported strokes depend on the current zoom/fit mode.
   */
  private currentPageRenderScale = 1;

  /**
   * True after Angular has created the view.
   */
  private viewReady = false;

  /**
   * Observes the available canvas viewport.
   */
  private resizeObserver?: ResizeObserver;

  /**
   * Coalesces multiple resize/state changes into one
   * animation-frame render.
   */
  private resizeFrame: number | null = null;

  /**
   * Last viewport dimensions observed by ResizeObserver.
   *
   * This prevents duplicate observer notifications with unchanged geometry
   * from continuously invalidating the active render during long sessions.
   */
  private observedViewportWidth = -1;

  private observedViewportHeight = -1;

  /**
   * ----------------------------------------------------------
   * PAN STATE
   * ----------------------------------------------------------
   */
  private isPanning = false;

  private panPointerId: number | null = null;

  private panStartX = 0;

  private panStartY = 0;

  private panScrollLeft = 0;

  private panScrollTop = 0;

  private spacePressed = false;

  /**
   * ----------------------------------------------------------
   * ZOOM ANCHOR
   * ----------------------------------------------------------
   *
   * Stores the point underneath the mouse before a zoom.
   */
  private zoomAnchor: {
    clientX: number;
    clientY: number;
    relativeX: number;
    relativeY: number;
  } | null = null;

  /**
   * ----------------------------------------------------------
   * ZOOM STEPS
   * ----------------------------------------------------------
   */
  private readonly zoomSteps = [50,75,100,125,150,175,200];
  private readonly selectionEngine = inject(SelectionEngineService);
  readonly objectService = inject(StudioObjectService);

  /** Selection-through state for overlapping annotations. */
  private selectionCycle = {
    key: '',
    objectIds: [] as string[],
    index: -1,
    timestamp: 0,
    x: 0,
    y: 0,
    pageNumber: 0
  };
  /**
   * F3 palettes keep independent collapse state. Collapsing Draw must not
   * collapse Highlight or Shape, and the PDF viewport/layout never changes.
   */
  readonly paletteCollapsed = {
    shape: false,
    draw: false,
    highlight: false
  };

  /**
   * User-adjusted positions are stored in CSS pixels relative to the PDF page.
   * A null value means the palette uses its responsive centered/default CSS
   * position. Positions are independent for Shape, Draw and Highlight.
   */
  readonly palettePositions: Record<
    F3PaletteId,
    PalettePosition | null
  > = {
    shape: null,
    draw: null,
    highlight: null
  };

  private paletteDrag: PaletteDragState | null = null;

  private readonly selectionCycleWindowMs = 900;

  /**
   * ----------------------------------------------------------
   * OBJECT MOVE / RESIZE
   * ----------------------------------------------------------
   */
  private objectInteraction: ObjectInteraction | null = null;

  /**
   * ----------------------------------------------------------
   * TEXT EDITING
   * ----------------------------------------------------------
   */
  editingObjectId: string | null = null;

  editingText = '';

  private editingOriginalText = '';

  private editingOriginalStyle: StudioTextStyle | null = null;
  private editingOriginalObject: StudioObject | null = null;
  private readonly editingVisualBounds = signal<{id: string; bounds: StudioObject['bounds']} | null>(null);
  private editorLayoutFrame = 0;
  private readonly requestedEditorFonts = new Set<string>();
  readonly getObjectFontStyleCss = textFontStyle;

  /** Current font-size field value while the user is typing. */
  editingFontSizeInput = '14';

  @ViewChild('textEditor')
  private textEditorRef?: ElementRef<HTMLTextAreaElement>;

  /** F7.2 Phase E — focus target for the comment editor. */
  @ViewChild('commentEditor')
  private commentEditorRef?: ElementRef<HTMLTextAreaElement>;

  @ViewChild('imageInput')
  private imageInputRef?: ElementRef<HTMLInputElement>;

  private pendingImagePlacement: {
    x: number;
    y: number;
  } | null = null;

  private pendingImageReplacementId:
    string | null = null;

  /**
   * F3 — shape/drawing gesture state.
   * Points are normalized to the current PDF page (0..1).
   */
  drawingInteraction: {
    readonly tool: 'shape' | 'draw' | 'highlight';
    readonly pointerId: number;
    readonly start: StudioPoint;
    readonly points: readonly StudioPoint[];
    readonly shapeKind: StudioShapeKind;
    readonly shapeStyle: StudioShapeStyle;
    readonly drawingStyle: StudioDrawingStyle;
  } | null = null;

  /**
   * Last committed tool. Used to cancel an in-progress drawing gesture
   * when the user intentionally switches to another tool.
   */
  /** F7.2 — Inline editor state for page-anchored comments. */
  editingCommentId: string | null = null;
  editingCommentText = '';
  private editingCommentOriginalText = '';
  private editingCommentOriginalResolved = false;
  private editingCommentOriginalUpdatedAt = 0;

  /** Element that had focus before the comment editor opened. */
  private commentEditorReturnFocus: HTMLElement | null = null;

  /**
   * Tracks the last logical comment selection seen by the reactive effect.
   */
  private lastObservedCommentSelectionId: string | null = null;

  private lastActiveTool: StudioToolId = 'select';

  selectedShapeKind: StudioShapeKind = 'rectangle';

  selectedShapeStrokeColor = '#00d4b3';

  selectedShapeFillColor = '#00d4b3';

  selectedShapeFillEnabled = false;

  selectedDrawingColor = '#00d4b3';

  selectedHighlightColor = '#f4d03f';

  selectedDrawingWidthPx = 3;

  /** Independent highlight width control. */
  selectedHighlightWidthPx = 8;

  selectedShapeWidthPx = 2;

  private readonly MIN_OBJECT_WIDTH = 40;
  private readonly MIN_OBJECT_HEIGHT = 24;
  private readonly MIN_COMMENT_SIZE = 18;

  readonly committedPreview = signal<string | null>(null);
  readonly previewBounds = signal<Record<string,{x:number;y:number;width:number;height:number}>>({});
  readonly textDraft = this.facade.inlineTextDraft;
  readonly previewError = signal('');
  private readonly previewExporter = inject(StudioPdfExportService);
  private previewGeneration = 0;
  private previewContext = '';
  private previewSignature = '';
  private previewDocumentId: string | undefined;
  private readonly previewPages = new Map<string, { signature: string; image: string;
    bounds: Record<string, StudioObject['bounds']>; sourceBounds: Record<string, StudioObject['bounds']> }>();
  private readonly previewSources = new Map<string, Promise<File>>();
  private readonly previewSourceBounds = signal<Record<string, StudioObject['bounds']>>({});
  readonly previewBusy = signal(false);
  readonly textTransformActive = signal(false);
  readonly editingSession = signal<string | null>(null);
  private editRequest = 0;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.facade.flushTextDraft = () => this.commitTextEdit();
    effect(() => {
      this.objectService.changes();
      this.editingSession();
      this.facade.zoom();
      this.scheduleTextEditorLayout();
    });
    effect(() => {
      this.objectService.changes();
      const transforming = this.textTransformActive() || !!this.editingSession();
      const source = this.facade.document();
      const pageNumber = this.facade.currentPage();
      const logicalPage = this.facade.pages()[pageNumber - 1];
      const objects = this.objectService.listForPage(pageNumber)
        .filter(o => o.pdfText || o.pdfImage)
        .map(o => ({ ...o, pageNumber: 1 }));
      const context = `${source?.id}:${logicalPage?.id}:${logicalPage?.sourcePageNumber}:${logicalPage?.rotation}`;
      // Drafts stay in the native editor. Only committed changes need a PDF round trip.
      const signature = JSON.stringify(objects.map(object => object.pdfText?.edited || object.pdfImage?.replaced
        ? object : { id: object.id, bounds: object.bounds }));
      if (!transforming && context === this.previewContext && signature === this.previewSignature) return;
      const generation = ++this.previewGeneration;
      clearTimeout(this.previewTimer);
      if (this.previewDocumentId !== source?.id) {
        this.previewPages.clear();
        this.previewSources.clear();
        this.previewDocumentId = source?.id;
      }
      this.previewSignature = transforming ? '' : signature;
      this.previewContext = context;
      const cached = this.previewPages.get(context);
      const exact = cached?.signature === signature ? cached : undefined;
      // Never show an older edit after undo, or a different page's raster.
      // Wrapped HTML replacements remain visible until the exact raster is ready.
      this.committedPreview.set(exact?.image ?? null);
      this.previewBounds.set(exact?.bounds ?? {});
      this.previewSourceBounds.set(exact?.sourceBounds ?? {});
      this.previewError.set('');
      this.previewBusy.set(false);
      const hasEdits = objects.some(o => o.pdfText?.edited || o.pdfImage?.replaced);
      if (!this.isBrowser || !source || !logicalPage || !hasEdits || exact || transforming) return;
      this.previewBusy.set(true);
      // Serialize and debounce document parsing; stale requests never paint.
      this.previewTimer = setTimeout(() => {
        this.previewQueue = this.previewQueue.catch(() => {}).then(async () => {
          if (this.destroyed || generation !== this.previewGeneration) return;
          let pdf: import('pdfjs-dist/types/src/display/api').PDFDocumentProxy | undefined;
          const canvas = document.createElement('canvas');
          try {
            let positions: Record<string,{x:number;y:number;width:number;height:number}> = {};
            let sourceFile = this.previewSources.get(context);
            if (!sourceFile) {
              sourceFile = this.previewExporter.createPreviewFile(source.file, logicalPage);
              this.previewSources.set(context, sourceFile);
              if (this.previewSources.size > 4) this.previewSources.delete(this.previewSources.keys().next().value!);
            }
            const previewFile = await sourceFile;
            if (this.destroyed || generation !== this.previewGeneration) return;
            const previewPage = {...logicalPage, kind: 'source' as const, sourcePageNumber: 1, rotation: 0 as const};
            const blob = await this.previewExporter.exportTextObjects(previewFile, objects, [previewPage], bounds=>positions=bounds);
            if (this.destroyed || generation !== this.previewGeneration) return;
            const pdfjs = await import('pdfjs-dist');
            pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';
            pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
            const page = await pdf.getPage(1);
            const natural = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 1600 / Math.max(natural.width, natural.height));
            const viewport = page.getViewport({ scale });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
            if (!this.destroyed && generation === this.previewGeneration) {
              this.previewSourceBounds.set(Object.fromEntries(objects.map(object => [object.id, object.bounds])));
              this.previewBounds.set(positions);
              const image = canvas.toDataURL('image/png');
              this.committedPreview.set(image);
              this.previewPages.delete(context);
              this.previewPages.set(context, { signature, image, bounds: positions,
                sourceBounds: Object.fromEntries(objects.map(object => [object.id, object.bounds])) });
              if (this.previewPages.size > 8) this.previewPages.delete(this.previewPages.keys().next().value!);
            }
          } catch (error) {
            if (!this.destroyed && generation === this.previewGeneration) {
              this.previewSources.delete(context);
              this.committedPreview.set(null);
              this.previewBounds.set({});
              this.previewSourceBounds.set({});
              this.previewError.set(error instanceof Error ? error.message : 'Unable to render the edited preview.');
            }
          } finally {
            if(generation===this.previewGeneration)this.previewBusy.set(false);
            canvas.width = canvas.height = 0;
            await pdf?.destroy();
          }
        });
      }, 80);
    });
    effect(() => {
      const request = this.watermark.isOpen()
        ? this.watermark.draft()
        : this.watermark.committed();
      const file = request?.kind === 'image' ? (request.imageFile ?? null) : null;
      if (file === this.watermarkImageFile) return;

      this.revokeWatermarkImagePreview();
      this.watermarkImageFile = file;
      if (!file) return;

      const url = URL.createObjectURL(file);
      this.watermarkImageUrl.set(url);
      const image = new Image();
      image.onload = () => {
        if (this.watermarkImageUrl() !== url) return;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          this.watermarkImageAspectRatio.set(image.naturalWidth / image.naturalHeight);
        }
      };
      image.src = url;
    });

    effect(() => {
      const request = this.watermark.isOpen()
        ? this.watermark.draft()
        : this.watermark.committed();
      if (!request || request.kind !== 'text') {
        this.watermarkTextMetrics.set(null);
        return;
      }

      const generation = ++this.watermarkTextMetricsGeneration;
      void this.watermarkMetrics.measure(request.font, request.text || 'WATERMARK', request.fontSize).then(metrics => {
        if (generation === this.watermarkTextMetricsGeneration) {
          this.watermarkTextMetrics.set(metrics);
        }
      }).catch(() => {
        if (generation === this.watermarkTextMetricsGeneration) {
          this.watermarkTextMetrics.set(null);
        }
      });
    });

    /**
     * Re-render whenever a render-relevant Studio
     * state value changes.
     */
    /**
     * F7.2 — Sidebar selection and marker selection share the same opening
     * path. Selecting a comment while the Comment tool is active must reveal
     * its editor, not leave the user with only a highlighted marker.
     */    effect(() => {
      const selection = this.facade.selection();
      const activeTool = this.facade.activeTool();

      const selectedCommentId =
        activeTool === 'comment' &&
        selection?.type === 'comment'
          ? selection.objectId
          : null;

      /**
       * Save/update re-selects the same comment. That state update must not
       * reopen an editor that the user has just closed.
       */
      if (
        selectedCommentId &&
        selectedCommentId !== this.lastObservedCommentSelectionId &&
        selectedCommentId !== this.editingCommentId
      ) {
        this.openCommentEditor(selectedCommentId);
      }

      this.lastObservedCommentSelectionId =
        selectedCommentId;
    });

    /**
     * F7.2 Phase B — The editor must never outlive its backing comment.
     *
     * Comments can disappear through Delete, Undo, Redo, document replacement
     * or other object-store mutations. Register the object revision as a
     * dependency so an externally removed comment immediately tears down the
     * editor instead of leaving a stale popup that blocks further comments.
     */
    effect(() => {
      const objectId = this.editingCommentId;
      this.objectService.changes();

      if (!objectId) {
        return;
      }

      const object = this.objectService.get(objectId);

      if (
        !object ||
        object.type !== 'comment' ||
        !object.comment
      ) {
        this.resetCommentEditorState(true);
        return;
      }

      /**
       * Undo/Redo restores complete object snapshots. If that restored state
       * changes the comment currently being edited, keeping the old textarea
       * would allow stale text to be saved over restored history state.
       * Bounds-only mutations intentionally keep the editor open.
       */
      if (
        object.comment.content !== this.editingCommentOriginalText ||
        object.comment.resolved !== this.editingCommentOriginalResolved ||
        object.comment.updatedAt !== this.editingCommentOriginalUpdatedAt
      ) {
        this.resetCommentEditorState(true);
      }
    });

    effect(() => {

      const hasDocument =
        this.facade.hasDocument();

      const zoom =
        this.facade.zoom();

      const page =
        this.facade.currentPage();

      const viewMode =
        this.facade.viewMode();

      const activeTool =
        this.facade.activeTool();

      /**
       * A comment editor is page-scoped. Navigation must not leave a stale
       * editor attached to an object from another page.
       */
      this.closeCommentEditorForPageChange(page);

      /**
       * F4/F5 — Register the logical page collection as a render dependency.
       *
       * Page-management operations can change the source page, blank/source
       * kind or rotation while the numeric currentPage remains unchanged.
       * Undo/Redo therefore must trigger a fresh PDF render even when the user
       * stays on the same page number.
       */
      const logicalPages =
        this.facade.pages();

      const logicalPage =
        logicalPages[page - 1] ??
        null;

      /**
       * Explicitly register signal dependencies.
       */
      void zoom;
      void page;
      void viewMode;
      void logicalPage;

      /**
       * A drawing gesture belongs only to the tool that started it.
       * Switching to Text, Select, Image, Hand, etc. must cancel the
       * unfinished gesture instead of letting the old tool keep reacting
       * to pointer events. Switching between shape/draw/highlight also
       * cancels the old gesture so the new tool starts cleanly.
       */
      if (
        this.drawingInteraction &&
        activeTool !== this.lastActiveTool
      ) {
        this.cancelDrawingInteraction();
      }

      if (activeTool !== this.lastActiveTool) {
        this.resetSelectionCycle();
      }

      /**
       * F7.2 Phase D — A comment editor may remain open while the user is in
       * Select mode so the same comment can still be moved/resized. Switching
       * to any other interaction tool must end the comment session; otherwise
       * the popup can block another tool while retaining stale edit state.
       * Commit meaningful content on an intentional tool switch so typed work
       * is not silently lost. Explicit Cancel remains the discard path.
       */
      if (
        this.editingCommentId &&
        activeTool !== 'comment' &&
        activeTool !== 'select'
      ) {
        this.closeCommentEditor(true);
      }

      this.lastActiveTool = activeTool;

      /*
       * Keep the dedicated PDF text tool warm across page navigation.
       * Navigation itself also calls ensurePageContent(), but this additional
       * tool-scoped request closes the timing window where the page canvas is
       * already visible while its source text objects are still being indexed.
       */
      if (activeTool === 'edit-pdf-text') {
        void this.facade.ensureCurrentPageContent();
      }

      /**
       * Existing PDF text editing is a persistent editing mode too.
       * Do not immediately commit the editor merely because the dedicated
       * `edit-pdf-text` tool is active; doing so made the toolbar look as if
       * clicks were ignored because the editor opened and closed in the same
       * reactive turn.
       */
      if (
        this.editingObjectId &&
        activeTool !== 'text' &&
        activeTool !== 'edit-pdf-text'
      ) {
        this.commitTextEdit();
      }

      if (
  !hasDocument
) {
  /**
   * Invalidate ownership of every current or pending render.
   */
  this.renderVersion++;

  this.cancelScheduledRender();

  this.activeRenderVersion = null;

  if (this.canvasRef) {
    this.clearCanvas();
  }

  this.currentPageRenderScale = 1;

  this.zoomAnchor = null;

  this.editingObjectId = null;
  this.editingSession.set(null);
  this.editingText = '';
  this.editingOriginalText = '';
  this.editingOriginalStyle = null;
  this.editingFontSizeInput = '14';

  /** F7.2 Phase D — document teardown must also clear comment editor state. */
  this.resetCommentEditorState(false);

  return;
}

      if (
        this.editingObjectId
      ) {
        const editingObject =
          this.objectService.get(
            this.editingObjectId
          );

        if (
          !editingObject ||
          editingObject.pageNumber !== page
        ) {
          this.commitTextEdit();
        }
      }

      if (
        !this.viewReady
      ) {
        return;
      }

      const renderState = JSON.stringify([this.facade.document()?.id, page, zoom, viewMode, logicalPage]);
      if (renderState !== this.lastRenderState) {
        this.lastRenderState = renderState;
        this.scheduleRender();
      }
    });
  }

  /**
   * ----------------------------------------------------------
   * VIEW INITIALIZATION
   * ----------------------------------------------------------
   */
ngAfterViewInit(): void {

  this.destroyed = false;

  this.viewReady = true;

  this.observeViewport();

  this.scheduleRender();
}

  get pdfEditPreparationMessage(): string {
    if (this.facade.activeTool() !== 'edit-pdf-text') return '';
    const sourcePage = this.facade.pages()[this.facade.currentPage() - 1];
    if (!sourcePage || sourcePage.kind !== 'source') return '';
    const analysis = this.facade.contentAnalysisState();
    if (analysis?.pages[sourcePage.sourcePageNumber ?? 1]) return '';
    return analysis?.status === 'error'
      ? 'Unable to prepare this page for editing. Select Edit PDF to retry.'
      : 'Preparing text and images for editing… You can click a text area to edit when ready.';
  }

  resizeEditingTextArea(axis: 'width' | 'height', value: string): void {
    const object = this.editingTextObject;
    const points = Number(value);
    const dimension = axis === 'width' ? object?.pdfText?.pageWidthPdf : object?.pdfText?.pageHeightPdf;
    if (!object?.pdfText || !dimension || !Number.isFinite(points) || points <= 0) return;
    this.syncTextEditorValue();
    this.facade.updateObjectBounds(object.id, { ...object.bounds, [axis]: points / dimension });
    requestAnimationFrame(() => this.syncTextEditorLayout());
  }

  get activeToolCursorClass(): string {
    switch (this.facade.activeTool()) {
  
      case 'hand':
        return 'studio-canvas__stage--hand';
  
      case 'text':
        return 'studio-canvas__stage--text';
  
      case 'draw':
      case 'highlight':
      case 'shape':
        return 'studio-canvas__stage--crosshair';
  
      case 'image':
        return 'studio-canvas__stage--copy';
      case 'sign':
        return 'studio-canvas__stage--copy';

      case 'comment':
        return 'studio-canvas__stage--comment';
      case 'link':
        return 'studio-canvas__stage--link';
  
      default:
        return 'studio-canvas__stage--select';
    }
  }

 get studioObjects(): readonly StudioObject[] {
   if (!this.facade.hasDocument()) {
    return [];
   }

   // Register a reactive dependency so OnPush refreshes immediately after
   // any Studio object mutation (create/update/delete/duplicate).
   void this.objectService.changes();

   return visibleStudioSources(this.objectService.listForPage(this.facade.currentPage())).map(o=>({...o,bounds:this.getDisplayBounds(o)}));
 }

  getDisplayBounds(object: StudioObject): StudioObject['bounds'] {
    return studioDisplayBounds(object.bounds, this.previewBounds()[object.id], this.previewSourceBounds()[object.id]);
  }

  getSelectionBounds(id: string, fallback: StudioObject['bounds']): StudioObject['bounds'] {
    const object = this.objectService.get(id);
    const bounds = object ? this.getDisplayBounds(object) : fallback;
    const visual = this.editingVisualBounds();
    if (this.editingObjectId !== id || visual?.id !== id) return bounds;
    const x = Math.min(bounds.x, visual.bounds.x), y = Math.min(bounds.y, visual.bounds.y);
    return { x, y, width: Math.max(bounds.x + bounds.width, visual.bounds.x + visual.bounds.width) - x,
      height: Math.max(bounds.y + bounds.height, visual.bounds.y + visual.bounds.height) - y };
  }

  /**
   * Observe the actual Studio viewport.
   *
   * F6.4.2 — keep exactly one observer alive and schedule a render only when
   * the usable viewport geometry actually changes. This prevents duplicate
   * ResizeObserver callbacks from causing unnecessary render churn in long
   * Studio sessions.
   */
  private observeViewport(): void {

    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    this.observedViewportWidth = -1;
    this.observedViewportHeight = -1;

    if (
      this.destroyed ||
      !this.viewportRef ||
      typeof ResizeObserver ===
        'undefined'
    ) {
      return;
    }

    const viewport =
      this.viewportRef.nativeElement;

    this.resizeObserver =
      new ResizeObserver((entries) => {

        if (
          this.destroyed ||
          !this.viewReady ||
          !this.facade.hasDocument()
        ) {
          return;
        }

        const entry =
          entries.find(
            (candidate) =>
              candidate.target === viewport
          );

        if (!entry) {
          return;
        }

        const width =
          Math.max(
            0,
            Math.round(
              entry.contentRect.width
            )
          );

        const height =
          Math.max(
            0,
            Math.round(
              entry.contentRect.height
            )
          );

        if (
          width === this.observedViewportWidth &&
          height === this.observedViewportHeight
        ) {
          return;
        }

        this.observedViewportWidth = width;
        this.observedViewportHeight = height;

        this.scheduleRender();
      });

    this.resizeObserver.observe(
      viewport
    );
  }

  /**
 * ----------------------------------------------------------
 * RENDER SCHEDULING
 * ----------------------------------------------------------
 */
private scheduleRender(): void {

  /**
   * Every new render request invalidates ownership of any older
   * asynchronous completion immediately.
   */
  this.renderVersion++;

  if (
    this.destroyed ||
    !this.viewReady ||
    !this.facade.hasDocument()
  ) {
    return;
  }

  if (
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return;
  }

  /**
   * Only one scheduled browser-frame render may remain pending.
   */
  this.cancelScheduledRender();

  const scheduledVersion =
    this.renderVersion;

  this.resizeFrame =
    window.requestAnimationFrame(() => {

      this.resizeFrame = null;

      /**
       * A newer render request may have arrived while waiting for
       * the browser animation frame.
       */
      if (
        this.destroyed ||
        !this.viewReady ||
        !this.facade.hasDocument() ||
        scheduledVersion !== this.renderVersion
      ) {
        return;
      }

      this.currentRender = this.render(scheduledVersion);
    });
}

/**
 * ----------------------------------------------------------
 * PDF RENDER
 * ----------------------------------------------------------
 */
private async render(
  version: number = this.renderVersion
): Promise<void> {

  if (
    this.destroyed ||
    !this.viewReady ||
    !this.facade.hasDocument() ||
    !this.canvasRef ||
    !this.viewportRef ||
    version !== this.renderVersion
  ) {
    return;
  }

  /**
   * Capture the exact canvas that belongs to this render.
   *
   * Late asynchronous completions must never update state for a
   * different canvas instance.
   */
  const canvas =
    this.canvasRef.nativeElement;

  const viewport =
    this.viewportRef.nativeElement;

  this.activeRenderVersion =
    version;

  try {

    const viewportWidth =
      viewport.clientWidth;

    const viewportHeight =
      viewport.clientHeight;

    if (
      viewportWidth <= 0 ||
      viewportHeight <= 0
    ) {
      /**
       * A hidden/collapsed viewport must not keep stale pixels alive.
       * Clear only the canvas still owned by this render.
       */
      if (
        version === this.renderVersion &&
        this.canvasRef?.nativeElement === canvas
      ) {
        /**
         * F6.4.6 — Do not only clear pixels locally. Release the canvas from
         * the Facade/renderer ownership chain so an in-flight PDF.js render
         * cannot repaint it after the viewport has been hidden.
         */
        this.facade.releaseMainCanvas(
          canvas
        );
        this.currentPageRenderScale = 1;
      }

      return;
    }

    const rendered =
      await this.facade.renderCurrentPage(
        canvas,
        viewportWidth,
        viewportHeight
      );

    /**
     * --------------------------------------------------------
     * RENDER OWNERSHIP CHECK
     * --------------------------------------------------------
     *
     * This MUST happen before updating any component state.
     *
     * An older render can complete after a newer navigation,
     * zoom, rotation, page-management operation, or resize.
     */
    if (
      this.destroyed ||
      !this.viewReady ||
      version !== this.renderVersion ||
      this.canvasRef?.nativeElement !== canvas
    ) {
      return;
    }

    /**
     * Only the current owner may update render-dependent state.
     */
    if (
      rendered?.scale &&
      Number.isFinite(rendered.scale)
    ) {
      this.currentPageRenderScale =
        Math.max(
          0.0001,
          rendered.scale
        );
    } else {
      this.currentPageRenderScale = 1;
    }

    /**
     * Only the render that still owns the canvas may restore
     * viewport state or reposition floating palettes.
     */
    this.restoreZoomAnchor();
    this.clampPalettePositions();

  } catch (error: unknown) {

    /**
     * Obsolete or destroyed renders are intentionally ignored.
     *
     * The shared renderer may also reject when its underlying PDF
     * render is cancelled because a newer render took ownership.
     */
    if (
      this.destroyed ||
      version !== this.renderVersion
    ) {
      return;
    }

    console.error(
      '[SafePDFHub Studio] PDF render failed:',
      error
    );

  } finally {

    /**
     * Never allow an older render to clear ownership belonging
     * to a newer render.
     */
    if (
      this.activeRenderVersion === version
    ) {
      this.activeRenderVersion = null;
    }
  }
}

  /**
   * ----------------------------------------------------------
   * ZOOM ANCHOR
   * ----------------------------------------------------------
   */
  private captureZoomAnchor(
    event: WheelEvent
  ): void {

    const page =
      this.pageRef?.nativeElement;

    if (!page) {
      this.zoomAnchor = null;
      return;
    }

    const pageRect =
      page.getBoundingClientRect();

    if (
      pageRect.width <= 0 ||
      pageRect.height <= 0
    ) {
      this.zoomAnchor = null;
      return;
    }

    const relativeX =
      Math.min(
        1,
        Math.max(
          0,
          (
            event.clientX -
            pageRect.left
          ) / pageRect.width
        )
      );

    const relativeY =
      Math.min(
        1,
        Math.max(
          0,
          (
            event.clientY -
            pageRect.top
          ) / pageRect.height
        )
      );

    this.zoomAnchor = {
      clientX:
        event.clientX,

      clientY:
        event.clientY,

      relativeX,

      relativeY
    };
  }

  /**
   * Restore the cursor position after the PDF
   * has been rendered at the new zoom.
   */
  private restoreZoomAnchor(): void {

    const anchor =
      this.zoomAnchor;

    const viewport =
      this.viewportRef?.nativeElement;

    const page =
      this.pageRef?.nativeElement;

    if (
      !anchor ||
      !viewport ||
      !page
    ) {
      return;
    }

    const pageRect =
      page.getBoundingClientRect();

    const targetX =
      pageRect.left +
      (
        anchor.relativeX *
        pageRect.width
      );

    const targetY =
      pageRect.top +
      (
        anchor.relativeY *
        pageRect.height
      );

    const deltaX =
      targetX -
      anchor.clientX;

    const deltaY =
      targetY -
      anchor.clientY;

    if (
      Math.abs(deltaX) > 0.5
    ) {
      viewport.scrollLeft +=
        deltaX;
    }

    if (
      Math.abs(deltaY) > 0.5
    ) {
      viewport.scrollTop +=
        deltaY;
    }

    this.zoomAnchor = null;
  }

  /**
   * ----------------------------------------------------------
   * CTRL/CMD + WHEEL ZOOM
   * ----------------------------------------------------------
   */
  onWheel(
    event: WheelEvent
  ): void {

    if (
      !this.facade.hasDocument()
    ) {
      return;
    }

    const zoomGesture =
      event.ctrlKey ||
      event.metaKey;

    /**
     * Normal mouse wheel remains normal scrolling.
     */
    if (!zoomGesture) {
      return;
    }

    event.preventDefault();

    const currentZoom =
      this.facade.zoom();

    const direction =
      event.deltaY > 0
        ? -1
        : 1;

    const nextZoom =
      this.getNextZoomLevel(
        currentZoom,
        direction
      );

    if (
      nextZoom ===
      currentZoom
    ) {
      return;
    }

    this.captureZoomAnchor(
      event
    );

    this.facade.setZoom(
      nextZoom
    );
  }

  /**
   * Calculate the next supported zoom level.
   */
  private getNextZoomLevel(
    currentZoom: number,
    direction: number
  ): number {

    let index =
      this.zoomSteps.indexOf(
        currentZoom
      );

    if (index < 0) {

      index =
        this.zoomSteps.findIndex(
          value =>
            value > currentZoom
        );

      if (index < 0) {
        index =
          this.zoomSteps.length - 1;
      }
    }

    const nextIndex =
      Math.min(
        this.zoomSteps.length - 1,
        Math.max(
          0,
          index + direction
        )
      );

    return this.zoomSteps[
      nextIndex
    ];
  }

  

  get isDrawingToolActive(): boolean {
    const tool = this.facade.activeTool();
    return (
      tool === 'shape' ||
      tool === 'draw' ||
      tool === 'highlight'
    );
  }

  get drawingPreviewPoints(): readonly StudioPoint[] {
    return this.drawingInteraction?.points ?? [];
  }

  private get selectedF3ObjectType(): 'shape' | 'draw' | 'highlight' | null {
    const selection = this.facade.selection();
    if (
      selection?.type === 'shape' ||
      selection?.type === 'draw' ||
      selection?.type === 'highlight'
    ) {
      return selection.type;
    }

    return null;
  }

  /**
   * Palette ownership rule:
   *
   * - An active creation tool always owns the visible F3 palette.
   * - A selected existing F3 object owns a palette only while Select is active.
   *
   * This prevents a stale Shape selection from keeping the Shape toolbar open
   * after the user switches to Draw or Highlight.
   */
  get shapePaletteVisible(): boolean {
    const tool = this.facade.activeTool();

    if (tool === 'shape') {
      return true;
    }

    if (tool === 'draw' || tool === 'highlight') {
      return false;
    }

    return tool === 'select' &&
      this.selectedF3ObjectType === 'shape';
  }

  get drawingPaletteVisible(): boolean {
    const tool = this.facade.activeTool();

    if (tool === 'draw' || tool === 'highlight') {
      return true;
    }

    if (tool === 'shape') {
      return false;
    }

    return tool === 'select' &&
      (
        this.selectedF3ObjectType === 'draw' ||
        this.selectedF3ObjectType === 'highlight'
      );
  }

  get activeDrawingPaletteId(): 'draw' | 'highlight' {
    const tool = this.facade.activeTool();

    if (tool === 'draw' || tool === 'highlight') {
      return tool;
    }

    const selected = this.selectedF3ObjectType;

    return selected === 'highlight'
      ? 'highlight'
      : 'draw';
  }

  get activeDrawingPaletteLabel(): 'Draw' | 'Highlight' {
    return this.activeDrawingPaletteId === 'highlight'
      ? 'Highlight'
      : 'Draw';
  }

  get activeDrawingColor(): string {
    return this.activeDrawingPaletteId === 'highlight'
      ? this.selectedHighlightColor
      : this.selectedDrawingColor;
  }

  get activeDrawingWidthPx(): number {
    return this.activeDrawingPaletteId === 'highlight'
      ? this.selectedHighlightWidthPx
      : this.selectedDrawingWidthPx;
  }

  get canSelectBehind(): boolean {
    return this.selectionCycle.objectIds.length > 1 &&
      !!this.facade.selection();
  }

  isF3PaletteCollapsed(
    palette: 'shape' | 'draw' | 'highlight'
  ): boolean {
    return this.paletteCollapsed[palette];
  }

  toggleF3Palette(
    palette: 'shape' | 'draw' | 'highlight'
  ): void {
    this.paletteCollapsed[palette] =
      !this.paletteCollapsed[palette];
  }

  getPalettePosition(
    palette: F3PaletteId
  ): PalettePosition | null {
    return this.palettePositions[palette];
  }

  isPalettePositioned(
    palette: F3PaletteId
  ): boolean {
    return this.palettePositions[palette] !== null;
  }

  startPaletteDrag(
    event: PointerEvent,
    palette: F3PaletteId
  ): void {
    if (event.button !== 0) {
      return;
    }

    const page = this.pageRef?.nativeElement;
    const handle = event.currentTarget as HTMLElement | null;
    const paletteElement =
      handle?.closest('.studio-shape-palette') as HTMLElement | null;

    if (!page || !paletteElement) {
      return;
    }

    const pageRect = page.getBoundingClientRect();
    const paletteRect = paletteElement.getBoundingClientRect();

    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return;
    }

    const currentLeft =
      this.palettePositions[palette]?.left ??
      paletteRect.left - pageRect.left;
    const currentTop =
      this.palettePositions[palette]?.top ??
      paletteRect.top - pageRect.top;

    this.palettePositions[palette] = {
      left: currentLeft,
      top: currentTop
    };

    this.paletteDrag = {
      palette,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: currentLeft,
      startTop: currentTop
    };

    try {
      handle?.setPointerCapture(event.pointerId);
    } catch {
      /* Window listeners continue the drag if capture is unavailable. */
    }

    event.preventDefault();
    event.stopPropagation();
  }

  private updatePaletteDrag(event: PointerEvent): void {
    const drag = this.paletteDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const page = this.pageRef?.nativeElement;
    const paletteElement = this.getPaletteElement(drag.palette);
    if (!page || !paletteElement) {
      return;
    }

    const pageRect = page.getBoundingClientRect();
    const paletteRect = paletteElement.getBoundingClientRect();

    const maxLeft = Math.max(8, pageRect.width - paletteRect.width - 8);
    const maxTop = Math.max(8, pageRect.height - paletteRect.height - 8);

    const left = this.clamp(
      drag.startLeft + (event.clientX - drag.startClientX),
      8,
      maxLeft
    );
    const top = this.clamp(
      drag.startTop + (event.clientY - drag.startClientY),
      8,
      maxTop
    );

    this.palettePositions[drag.palette] = { left, top };
  }

  private finishPaletteDrag(event: PointerEvent): void {
    if (!this.paletteDrag || this.paletteDrag.pointerId !== event.pointerId) {
      return;
    }

    this.paletteDrag = null;
  }

  private clampPalettePositions(): void {
    const page = this.pageRef?.nativeElement;
    if (!page) {
      return;
    }

    const pageRect = page.getBoundingClientRect();

    for (const palette of ['shape', 'draw', 'highlight'] as const) {
      const position = this.palettePositions[palette];
      if (!position) {
        continue;
      }

      const element = this.getPaletteElement(palette);
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      this.palettePositions[palette] = {
        left: this.clamp(
          position.left,
          8,
          Math.max(8, pageRect.width - rect.width - 8)
        ),
        top: this.clamp(
          position.top,
          8,
          Math.max(8, pageRect.height - rect.height - 8)
        )
      };
    }
  }

  private getPaletteElement(
    palette: F3PaletteId
  ): HTMLElement | null {
    const page = this.pageRef?.nativeElement;
    if (!page) {
      return null;
    }

    const selector =
      palette === 'shape'
        ? '.studio-shape-palette:not(.studio-drawing-palette)'
        : '.studio-drawing-palette';

    return page.querySelector(selector) as HTMLElement | null;
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent): void {
    this.updatePaletteDrag(event);
  }

  @HostListener('window:pointerup', ['$event'])
  onWindowPointerUp(event: PointerEvent): void {
    this.finishPaletteDrag(event);
  }

  @HostListener('window:pointercancel', ['$event'])
  onWindowPointerCancel(event: PointerEvent): void {
    this.finishPaletteDrag(event);
  }

  selectObjectBehind(): void {
    if (!this.canSelectBehind || this.facade.activeTool() === 'hand') {
      return;
    }

    const anchor = this.selectionCycle;
    const page = this.facade.currentPage();
    if (anchor.pageNumber !== page) {
      return;
    }

    this.selectObjectAtPoint(anchor.x, anchor.y);
  }

  selectShapeKind(kind: StudioShapeKind): void {
    this.selectedShapeKind = kind;
  }

  setShapeStrokeColor(color: string): void {
    if (!this.isHexColor(color)) {
      return;
    }

    this.selectedShapeStrokeColor = color.toLowerCase();

    const selection = this.facade.selection();

    if (selection?.type === 'shape') {
      this.facade.updateShapeStyle(
        selection.objectId,
        {
          strokeColor:
            this.selectedShapeStrokeColor
        }
      );
    }
  }

  setShapeFillColor(color: string): void {
    if (!this.isHexColor(color)) {
      return;
    }

    this.selectedShapeFillColor = color.toLowerCase();

    const selection = this.facade.selection();

    if (selection?.type === 'shape') {
      this.facade.updateShapeStyle(
        selection.objectId,
        {
          fillColor:
            this.selectedShapeFillEnabled
              ? this.selectedShapeFillColor
              : null
        }
      );
    }
  }

  toggleShapeFill(): void {
    this.selectedShapeFillEnabled =
      !this.selectedShapeFillEnabled;

    const selection = this.facade.selection();

    if (selection?.type === 'shape') {
      this.facade.updateShapeStyle(
        selection.objectId,
        {
          fillColor:
            this.selectedShapeFillEnabled
              ? this.selectedShapeFillColor
              : null
        }
      );
    }
  }

  deleteSelectedObject(): void {
    this.facade.deleteSelectedObject();
    this.resetSelectionCycle();
  }

  setShapeStrokeWidthPx(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    this.selectedShapeWidthPx =
      Math.max(
        1,
        Math.min(
          12,
          Math.round(value)
        )
      );

    const page = this.pageRef?.nativeElement;
    const pageHeight =
      page?.getBoundingClientRect().height ?? 0;

    const selection = this.facade.selection();

    if (
      pageHeight > 0 &&
      this.currentPageRenderScale > 0 &&
      selection?.type === 'shape'
    ) {
      this.facade.updateShapeStyle(
        selection.objectId,
        {
          strokeWidth:
            this.selectedShapeWidthPx /
            pageHeight
        }
      );
    }
  }

  setDrawingColor(color: string): void {
    if (!this.isHexColor(color)) {
      return;
    }

    const normalized = color.toLowerCase();

    const selection = this.facade.selection();
    const selectedType = this.selectedF3ObjectType;
    const activeTool = this.facade.activeTool();
    const target: 'highlight' | 'draw' =
      activeTool === 'draw' || activeTool === 'highlight'
        ? activeTool
        : selectedType === 'highlight'
          ? 'highlight'
          : 'draw';

    if (target === 'highlight') {
      this.selectedHighlightColor = normalized;
    } else {
      this.selectedDrawingColor = normalized;
    }

    if (
      selection &&
      ((target === 'draw' && selection.type === 'draw') ||
       (target === 'highlight' && selection.type === 'highlight'))
    ) {
      this.facade.updateDrawingStyle(
        selection.objectId,
        {
          strokeColor: normalized
        }
      );
    }
  }

  setDrawingWidthPx(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const widthPx = Math.max(1, Math.min(24, Math.round(value)));
    const selection = this.facade.selection();
    const selectedType = this.selectedF3ObjectType;
    const activeTool = this.facade.activeTool();
    const target: 'highlight' | 'draw' =
      activeTool === 'draw' || activeTool === 'highlight'
        ? activeTool
        : selectedType === 'highlight'
          ? 'highlight'
          : 'draw';

    if (target === 'highlight') {
      this.selectedHighlightWidthPx = widthPx;
    } else {
      this.selectedDrawingWidthPx = widthPx;
    }

    const page = this.pageRef?.nativeElement;
    const pageHeight =
      page?.getBoundingClientRect().height ?? 0;

    if (
      pageHeight > 0 &&
      selection &&
      ((target === 'draw' && selection.type === 'draw') ||
       (target === 'highlight' && selection.type === 'highlight'))
    ) {
      this.facade.updateDrawingStyle(
        selection.objectId,
        {
          strokeWidth:
            widthPx / pageHeight
        }
      );
    }
  }

  private isHexColor(value: string): boolean {
    return (
      typeof value === 'string' &&
      /^#[0-9a-f]{6}$/i.test(value)
    );
  }

  private pagePixelToNormalizedWidth(
    pixels: number
  ): number {
    const page =
      this.pageRef?.nativeElement;

    const height =
      page?.getBoundingClientRect().height ?? 0;

    return height > 0
      ? pixels / height
      : 0.002;
  }

  private handleDrawingToolPointerDown(
    event: PointerEvent
  ): void {

    const page =
      this.pageRef?.nativeElement;

    if (!page) {
      return;
    }

    const pageRect =
      page.getBoundingClientRect();

    if (
      pageRect.width <= 0 ||
      pageRect.height <= 0
    ) {
      return;
    }

    const start =
      this.clientToPagePoint(
        event.clientX,
        event.clientY,
        pageRect
      );

    const tool =
      this.facade.activeTool();

    if (
      tool !== 'shape' &&
      tool !== 'draw' &&
      tool !== 'highlight'
    ) {
      return;
    }

    this.drawingInteraction = {
      tool,
      pointerId: event.pointerId,
      start,
      points: [start],
      shapeKind:
        this.selectedShapeKind,
      shapeStyle:
        this.getShapeStyle(),
      drawingStyle:
        this.getDrawingStyle(
          tool === 'highlight'
            ? 'highlight'
            : 'draw'
        )
    };

    event.preventDefault();
    event.stopPropagation();

    try {
      this.stageRef?.nativeElement.setPointerCapture(
        event.pointerId
      );
    } catch {
      /* Pointer capture is progressive enhancement. */
    }
  }

  private updateDrawingToolPointer(
    event: PointerEvent
  ): void {

    const interaction =
      this.drawingInteraction;

    if (
      !interaction ||
      interaction.pointerId !== event.pointerId
    ) {
      return;
    }

    const page =
      this.pageRef?.nativeElement;

    if (!page) {
      return;
    }

    const rect =
      page.getBoundingClientRect();

    const point =
      this.clientToPagePoint(
        event.clientX,
        event.clientY,
        rect
      );

    if (interaction.tool === 'shape') {
      this.drawingInteraction = {
        ...interaction,
        points: [
          interaction.start,
          point
        ]
      };
      return;
    }

    const previous =
      interaction.points[
        interaction.points.length - 1
      ];

    const distance = Math.hypot(
      (point.x - previous.x) * rect.width,
      (point.y - previous.y) * rect.height
    );

    if (distance < 1.5) {
      return;
    }

    this.drawingInteraction = {
      ...interaction,
      points: [
        ...interaction.points,
        point
      ]
    };
  }

  private finishDrawingTool(
    event: PointerEvent
  ): void {

    const interaction =
      this.drawingInteraction;

    if (
      !interaction ||
      interaction.pointerId !== event.pointerId
    ) {
      return;
    }

    this.drawingInteraction = null;

    try {
      this.stageRef?.nativeElement.releasePointerCapture(
        event.pointerId
      );
    } catch {
      /* Pointer capture may already be released. */
    }

    const page =
      this.pageRef?.nativeElement;

    const rect =
      page?.getBoundingClientRect();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    /**
     * Always sample pointer-up. This makes fast gestures reliable even when
     * the browser delivers no intermediate pointermove event.
     */
    const releasePoint =
      this.clientToPagePoint(
        event.clientX,
        event.clientY,
        rect
      );

    const first = interaction.start;
    const gestureDistancePx = Math.hypot(
      (releasePoint.x - first.x) * rect.width,
      (releasePoint.y - first.y) * rect.height
    );

    /**
     * A short click is selection/editing when it lands on an existing Studio
     * object. A real drag remains a creation gesture, including when it starts
     * over text, an image, or another annotation.
     */
    if (gestureDistancePx < 5) {
      const existing = this.selectObjectAtPoint(
        first.x,
        first.y
      );

      if (existing) {
        if (
          existing.type === 'shape' ||
          existing.type === 'draw' ||
          existing.type === 'highlight'
        ) {
          this.facade.setActiveTool(existing.type);
        } else {
          this.facade.setActiveTool('select');
        }

        return;
      }

      if (
        interaction.tool === 'draw' ||
        interaction.tool === 'highlight'
      ) {
        return;
      }
    }

    const lastRecorded =
      interaction.points[interaction.points.length - 1];

    const points =
      !lastRecorded ||
      Math.abs(lastRecorded.x - releasePoint.x) > 0.0001 ||
      Math.abs(lastRecorded.y - releasePoint.y) > 0.0001
        ? [...interaction.points, releasePoint]
        : [...interaction.points];

    if (points.length < 2) {
      return;
    }

    const last =
      points[points.length - 1];

    const pixelDistance =
      Math.hypot(
        (last.x - first.x) * rect.width,
        (last.y - first.y) * rect.height
      );

    /**
     * A click on an empty page creates the established default-size shape.
     * Draw/Highlight clicks on empty space intentionally do nothing because a
     * freehand annotation needs an actual stroke.
     */
    if (
      pixelDistance < 4 &&
      interaction.tool === 'shape'
    ) {
      const halfWidth =
        interaction.shapeKind === 'line' ||
        interaction.shapeKind === 'arrow'
          ? 0.08
          : 0.07;

      const halfHeight = 0.045;

      const startX =
        Math.max(0, first.x - halfWidth);
      const startY =
        Math.max(0, first.y - halfHeight);
      const endX =
        Math.min(1, first.x + halfWidth);
      const endY =
        Math.min(1, first.y + halfHeight);

      const selection =
        this.facade.createShapeObject(
          startX,
          startY,
          endX,
          endY,
          interaction.shapeKind,
          interaction.shapeStyle
        );

      if (selection) {
        this.facade.selectObject(selection);
      }

      return;
    }

    if (interaction.tool === 'shape') {
      const selection =
        this.facade.createShapeObject(
          first.x,
          first.y,
          last.x,
          last.y,
          interaction.shapeKind,
          interaction.shapeStyle
        );

      if (selection) {
        this.facade.selectObject(selection);
      }

      return;
    }

    const selection =
      this.facade.createDrawingObject(
        points,
        interaction.drawingStyle,
        interaction.tool === 'highlight'
          ? 'highlight'
          : 'draw'
      );

    if (selection) {
      this.facade.selectObject(selection);
    }
  }

  private getShapeStyle(): StudioShapeStyle {
    const page =
      this.pageRef?.nativeElement;

    const height =
      page?.getBoundingClientRect().height ?? 0;

    return {
      strokeColor:
        this.selectedShapeStrokeColor,
      fillColor:
        this.selectedShapeFillEnabled
          ? this.selectedShapeFillColor
          : null,
      strokeWidth:
        height > 0
          ? this.selectedShapeWidthPx / height
          : 0.002,
      opacity: 1
    };
  }

  private getDrawingStyle(
    tool: 'draw' | 'highlight'
  ): StudioDrawingStyle {
    const page =
      this.pageRef?.nativeElement;

    const height =
      page?.getBoundingClientRect().height ?? 0;

    const widthPx =
      tool === 'highlight'
        ? this.selectedHighlightWidthPx
        : this.selectedDrawingWidthPx;

    return {
      strokeColor:
        tool === 'highlight'
          ? this.selectedHighlightColor
          : this.selectedDrawingColor,
      strokeWidth:
        height > 0
          ? widthPx / height
          : 0.003,
      opacity:
        tool === 'highlight'
          ? 0.32
          : 1
    };
  }

  getDrawingPreviewPoints(): string {
    return this.drawingPreviewPoints
      .map(
        point =>
          `${point.x * 100},${point.y * 100}`
      )
      .join(' ');
  }


  get drawingPreviewBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    return this.getDrawingPreviewBounds();
  }

  getDrawingPreviewRelativePoints(): string {
    const bounds =
      this.getDrawingPreviewBounds();

    if (!bounds) {
      return '';
    }

    const points =
      this.drawingPreviewPoints;

    const minX =
      bounds.x / 100;

    const minY =
      bounds.y / 100;

    const width =
      Math.max(
        0.0001,
        bounds.width / 100
      );

    const height =
      Math.max(
        0.0001,
        bounds.height / 100
      );

    return points
      .map(
        point =>
          `${((point.x - minX) / width) * 100},${((point.y - minY) / height) * 100}`
      )
      .join(' ');
  }


  getShapeLineSvgPoints(
    object: StudioObject
  ): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } {
    const points =
      object.shape?.points;

    if (
      !points ||
      points.length < 2
    ) {
      return {
        x1: 4,
        y1: 50,
        x2: 96,
        y2: 50
      };
    }

    const [first, second] = points;

    const width =
      Math.max(
        0.0001,
        object.bounds.width
      );

    const height =
      Math.max(
        0.0001,
        object.bounds.height
      );

    return {
      x1:
        (
          (first.x - object.bounds.x) /
          width
        ) * 100,
      y1:
        (
          (first.y - object.bounds.y) /
          height
        ) * 100,
      x2:
        (
          (second.x - object.bounds.x) /
          width
        ) * 100,
      y2:
        (
          (second.y - object.bounds.y) /
          height
        ) * 100
    };
  }


  getArrowHeadSvgPoints(object: StudioObject): string {
    return this.arrowHeadInBox(this.getShapeLineSvgPoints(object), object.bounds,
      this.shapeStrokeWidthSvg(object));
  }

  getDrawingPreviewLineSvgPoints(): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } {
    const points =
      this.drawingPreviewPoints;

    if (points.length < 2) {
      return {
        x1: 4,
        y1: 50,
        x2: 96,
        y2: 50
      };
    }

    const bounds =
      this.getDrawingPreviewBounds();

    if (!bounds) {
      return {
        x1: 4,
        y1: 50,
        x2: 96,
        y2: 50
      };
    }

    const [first, last] = [
      points[0],
      points[points.length - 1]
    ];

    const minX =
      bounds.x / 100;
    const minY =
      bounds.y / 100;
    const width =
      Math.max(
        0.0001,
        bounds.width / 100
      );
    const height =
      Math.max(
        0.0001,
        bounds.height / 100
      );

    return {
      x1:
        (
          (first.x - minX) /
          width
        ) * 100,
      y1:
        (
          (first.y - minY) /
          height
        ) * 100,
      x2:
        (
          (last.x - minX) /
          width
        ) * 100,
      y2:
        (
          (last.y - minY) /
          height
        ) * 100
    };
  }

  getDrawingPreviewArrowHeadSvgPoints(): string {
    const b = this.drawingPreviewBounds;
    return b ? this.arrowHeadInBox(this.getDrawingPreviewLineSvgPoints(),
      {width:b.width/100,height:b.height/100}, this.shapePreviewStrokeWidthSvg()) : '';
  }

  private arrowHeadInBox(line: {x1:number;y1:number;x2:number;y2:number},
    bounds: {width:number;height:number}, stroke: number): string {
    const page = this.pageRef?.nativeElement.getBoundingClientRect();
    const w = Math.max(.001, bounds.width * (page?.width ?? 0));
    const h = Math.max(.001, bounds.height * (page?.height ?? 0));
    const dx = (line.x2-line.x1)*w/100, dy = (line.y2-line.y1)*h/100;
    const length = Math.min(stroke*2.8, Math.hypot(dx,dy)*.28);
    const angle = Math.atan2(dy,dx), spread = Math.PI/7;
    const tip = `${line.x2},${line.y2}`;
    const side = (a:number) => `${line.x2-length*Math.cos(a)*100/w},${line.y2-length*Math.sin(a)*100/h}`;
    return `${side(angle-spread)} ${tip} ${side(angle+spread)}`;
  }

  getObjectDrawingSvgPoints(
    object: StudioObject
  ): string {

    if (!object.drawing) {
      return '';
    }

    return object.drawing.points
      .map(point => {
        const localX =
          object.bounds.width > 0
            ? (
                (point.x - object.bounds.x) /
                object.bounds.width
              ) * 100
            : 50;

        const localY =
          object.bounds.height > 0
            ? (
                (point.y - object.bounds.y) /
                object.bounds.height
              ) * 100
            : 50;

        return `${localX},${localY}`;
      })
      .join(' ');
  }

  // SVG paths use a non-scaling stroke: widths are CSS pixels, independent
  // of the object's aspect ratio, but scale with the displayed PDF page.
  shapePreviewStrokeWidthSvg(): number {
    return (this.drawingInteraction?.shapeStyle.strokeWidth ?? 0) * this.renderedPageHeight();
  }

  drawingPreviewStrokeWidthSvg(): number {
    return (this.drawingInteraction?.drawingStyle.strokeWidth ?? 0) * this.renderedPageHeight();
  }

  shapeStrokeWidthSvg(object: StudioObject): number {
    return (object.shape?.style.strokeWidth ?? 0) * this.renderedPageHeight();
  }

  drawingStrokeWidthSvg(object: StudioObject): number {
    return (object.drawing?.style.strokeWidth ?? 0) * this.renderedPageHeight();
  }

  private renderedPageHeight(): number {
    return this.pageRef?.nativeElement.getBoundingClientRect().height ?? 0;
  }

  getPdfImagePreviewStyle(object: StudioObject): Record<string, string> {
    const angle = object.pdfImage?.displayRotation ?? 0;
    const swapped = Math.abs(Math.round(angle / 90)) % 2 === 1;
    const page = this.pageRef?.nativeElement.getBoundingClientRect();
    const width = object.bounds.width * (page?.width ?? 0);
    const height = object.bounds.height * (page?.height ?? 0);
    return { position:'absolute', left:'50%', top:'50%',
      width: swapped ? `${height}px` : '100%', height: swapped ? `${width}px` : '100%',
      'max-width':'none', 'max-height':'none',
      transform:`translate(-50%, -50%) rotate(${angle}deg)` };
  }

  getDrawingPreviewBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const points =
      this.drawingPreviewPoints;

    if (!points.length) {
      return null;
    }

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      x: minX * 100,
      y: minY * 100,
      width: Math.max(
        0.01,
        (maxX - minX) * 100
      ),
      height: Math.max(
        0.01,
        (maxY - minY) * 100
      )
    };
  }

  /**
   * ----------------------------------------------------------
   * POINTER PAN
   * ----------------------------------------------------------
   *
   * Supported gestures:
   *
   * - Middle mouse + drag
   * - Space + left mouse + drag
   */

  onPointerDown(event: PointerEvent): void {

  const viewport = this.viewportRef?.nativeElement;
  const stage = this.stageRef?.nativeElement;

  if (!viewport || !stage) {
    return;
  }

  const activeTool = this.facade.activeTool();

  /**
   * A click that finishes an active text edit belongs to the edit
   * session. Do not also interpret the same pointerdown as a new
   * text-placement gesture. This prevents accidental duplicate
   * text objects when clicking elsewhere to finish editing.
   */
  if (
    this.editingObjectId &&
    (activeTool === 'text' || activeTool === 'edit-pdf-text') &&
    event.button === 0 &&
    !this.spacePressed
  ) {
    const editorElement =
      (event.target as HTMLElement | null)?.closest(
        '.studio-editor-object'
      );

    const editingElementId =
      editorElement?.getAttribute('data-object-id');

    /*
     * Clicking inside the currently edited object (including its textarea)
     * belongs to the active edit session. Do not treat that click as an
     * outside-click commit.
     */
    if (
      editingElementId === this.editingObjectId
    ) {
      return;
    }

    /*
     * Clicking outside the edited line finishes the edit AND removes its
     * selection chrome. For edit-pdf-text we then continue through the normal
     * pointer routing so the same click can start editing another PDF line.
     */
    this.commitTextEdit();
    this.facade.clearSelection();
  }

  /** SIGNING TOOL */
  if (activeTool === 'sign' && event.button === 0 && !this.spacePressed) {
    const page = this.pageRef?.nativeElement;
    const rect = page?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    // Do not clamp clicks in the gray workspace into a PDF corner.
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const point = this.clientToPagePoint(event.clientX, event.clientY, rect);

    // Existing signing objects should behave like normal editable objects.
    // Clicking one while the Sign tool is active selects it instead of
    // accidentally creating a second signature on top of it.
    const existing = this.selectObjectAtPoint(point.x, point.y);
    if (existing?.type === 'signature') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const kind = this.signingState.activeKind();
    const asset = this.signingState.activeAsset();
    if ((kind === 'signature' || kind === 'initials') && asset?.kind === kind) {
      event.preventDefault();
      event.stopPropagation();
      this.facade.createSignatureObject(point.x, point.y, asset);
      this.cancelSigningPlacement();
      return;
    }
    if (kind === 'text' || kind === 'date' || kind === 'checkbox') {
      event.preventDefault();
      event.stopPropagation();
      this.facade.createSigningFieldObject(point.x, point.y, kind);
      this.cancelSigningPlacement();
      return;
    }
  }

  /** EDIT EXISTING PDF IMAGE TOOL */
  if (activeTool === 'edit-pdf-image' && event.button === 0 && !this.spacePressed) {
    this.handlePdfImageEditPointerDown(event);
    return;
  }

  /** EDIT EXISTING PDF TEXT TOOL */
  if (activeTool === 'edit-pdf-text' && event.button === 0 && !this.spacePressed) {
    event.preventDefault();
    event.stopPropagation();
    void this.handlePdfTextEditPointerDown(event);
    return;
  }

  /**
   * TEXT TOOL
   */
  if (
    activeTool === 'text' &&
    event.button === 0 &&
    !this.spacePressed
  ) {
    this.handleTextToolPointerDown(event);
    return;
  }

  /** LINK TOOL */
  if (activeTool === 'link' && event.button === 0 && !this.spacePressed) {
    this.handleLinkToolPointerDown(event);
    return;
  }

  /**
   * F7.2 — COMMENT TOOL
   */
  if (activeTool === 'comment' && event.button === 0 && !this.spacePressed) {
    this.handleCommentToolPointerDown(event);
    return;
  }

  /**
   * SHAPE / DRAW / HIGHLIGHT TOOLS
   */
  if (
    (
      activeTool === 'shape' ||
      activeTool === 'draw' ||
      activeTool === 'highlight'
    ) &&
    event.button === 0 &&
    !this.spacePressed
  ) {
    this.handleDrawingToolPointerDown(event);
    return;
  }

  /**
   * IMAGE TOOL
   */
  if (
    activeTool === 'image' &&
    event.button === 0 &&
    !this.spacePressed
  ) {
    this.handleImageToolPointerDown(event);
    return;
  }

  /**
   * SELECT TOOL
   */
  if (
    activeTool === 'select' &&
    event.button === 0 &&
    !this.spacePressed
  ) {
    this.handleSelectionPointerDown(event);
    return;
  }

  /**
   * Existing B8/B9 pan behavior.
   */
  const shouldPan =
    event.button === 1 ||
    (
      event.button === 0 &&
      (
        this.spacePressed ||
        activeTool === 'hand'
      )
    );

  if (!shouldPan) {
    return;
  }

  event.preventDefault();

  this.isPanning = true;

  this.panPointerId =
    event.pointerId;

  this.panStartX =
    event.clientX;

  this.panStartY =
    event.clientY;

  this.panScrollLeft =
    viewport.scrollLeft;

  this.panScrollTop =
    viewport.scrollTop;

  stage.classList.add(
    'studio-canvas__stage--panning'
  );

  stage.setPointerCapture(
    event.pointerId
  );
}

onEditorObjectPointerDown(
  event: PointerEvent,
  objectId: string
): void {

  if (
    event.button !== 0
  ) {
    return;
  }

  const object =
    this.objectService.get(
      objectId
    );

  if (!object) {
    return;
  }

  const activeTool = this.facade.activeTool();

  if (
    activeTool === 'hand' ||
    this.spacePressed
  ) {
    return;
  }

  /**
   * Drawing tools must own the pointer gesture even when the pointer
   * starts over an existing Studio object. Otherwise the child object's
   * pointer handler captures the event and the selected drawing tool
   * appears to stop working.
   */
  if (
    activeTool === 'shape' ||
    activeTool === 'draw' ||
    activeTool === 'highlight'
  ) {
    return;
  }

  if (
    object.type === 'comment' &&
    (activeTool === 'comment' || activeTool === 'select')
  ) {
    const page = this.pageRef?.nativeElement;
    const rect = page?.getBoundingClientRect();

    if (rect && rect.width > 0 && rect.height > 0) {
      const point = this.clientToPagePoint(
        event.clientX,
        event.clientY,
        rect
      );
      const selected = this.selectObjectAtPoint(
        point.x,
        point.y,
        objectId
      );

      if (selected?.type === 'comment') {
        this.openCommentEditor(selected.id);
        event.preventDefault();
        event.stopPropagation();
      }
    }

    return;
  }

  if (activeTool === 'edit-pdf-text') {
    if (object.type === 'text' && object.pdfText) {
      void this.beginTextEditing(object.id);
      event.preventDefault();
      event.stopPropagation();
    } else if (object.type === 'image' && object.pdfImage) {
      this.facade.selectObject(this.selectionEngine.toSelection(object));
      this.requestImageReplacement(object.id);
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  /** Dedicated existing-PDF image editing must also work when the pointer starts
   * on the transparent source overlay or an already-replaced image object. */
  if (activeTool === 'edit-pdf-image') {
    if (object.type === 'image' && object.pdfImage) {
      this.facade.selectObject(this.selectionEngine.toSelection(object));
      this.requestImageReplacement(object.id);
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (activeTool !== 'select') {
    return;
  }

  const page = this.pageRef?.nativeElement;
  const rect = page?.getBoundingClientRect();

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const point = this.clientToPagePoint(
    event.clientX,
    event.clientY,
    rect
  );

  const selected = this.selectObjectAtPoint(
    point.x,
    point.y,
    objectId
  );

  if (!selected) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

private handleLinkToolPointerDown(event: PointerEvent): void {
  const page = this.pageRef?.nativeElement;
  if (!page) return;
  const rect = page.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const point = this.clientToPagePoint(event.clientX, event.clientY, rect);
  const selection = this.facade.createLinkObject(point.x, point.y);
  if (selection) this.facade.setActiveTool('select');
  event.preventDefault();
  event.stopPropagation();
}

private handleCommentToolPointerDown(event: PointerEvent): void {
  const page = this.pageRef?.nativeElement;

  if (!page) {
    return;
  }

  const rect = page.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const point = this.clientToPagePoint(
    event.clientX,
    event.clientY,
    rect
  );

  const existing = this.selectCommentAtPoint(
    point.x,
    point.y
  );

  if (this.editingCommentId) {
    /**
     * F7.2 Phase D — While editing, a blank page click must never create a
     * second draft. Existing markers remain reachable so overlapping comments
     * can still be cycled; switching to one finalizes the current session.
     */
    if (existing) {
      this.openCommentEditor(existing.id);
    }

    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (existing) {
    this.openCommentEditor(existing.id);
  } else {
    const selection = this.facade.createCommentObject(
      point.x,
      point.y
    );

    if (selection) {
      this.openCommentEditor(selection.objectId);
    }
  }

  event.preventDefault();
  event.stopPropagation();
}

openCommentEditor(objectId: string): void {
  /**
   * F7.2 Phase E — Re-opening the same marker must never replace unsaved
   * textarea content with the stored object content. Keep the active editor
   * session intact and simply return keyboard focus to it.
   */
  if (this.editingCommentId === objectId) {
    this.focusCommentEditor();
    return;
  }

  /**
   * F7.2 Phase D — Switching directly from one comment marker/sidebar item
   * to another must not orphan the first editor session. Finish the current
   * session first, preserving meaningful typed content, then open the next
   * comment. This keeps one editor <-> one selected comment at all times.
   */
  if (this.editingCommentId) {
    this.closeCommentEditor(true);
  }

  const object = this.objectService.get(objectId);
  if (!object || object.type !== 'comment' || !object.comment) { return; }

  const activeElement =
    typeof document !== 'undefined'
      ? document.activeElement
      : null;

  this.commentEditorReturnFocus =
    activeElement instanceof HTMLElement ? activeElement : null;

  this.editingCommentId = objectId;
  this.editingCommentText = object.comment.content;
  this.editingCommentOriginalText = object.comment.content;
  this.editingCommentOriginalResolved = object.comment.resolved;
  this.editingCommentOriginalUpdatedAt = object.comment.updatedAt;
  this.facade.selectObject({ objectId: object.id, pageNumber: object.pageNumber, bounds: object.bounds, type: object.type });
  this.focusCommentEditor();
}

closeCommentEditor(save: boolean): void {
  const objectId = this.editingCommentId;

  if (!objectId) {
    return;
  }

  const text = this.editingCommentText.trim();
  const original = this.editingCommentOriginalText;
  const isUnsavedDraft = !original;

  if (save && text && text !== original) {
    this.facade.updateComment(objectId, text);
  } else if (
    (save && !text && isUnsavedDraft) ||
    (!save && isUnsavedDraft)
  ) {
    this.facade.deleteObject(objectId);
  }

  /**
   * Always clear the logical selection when an editor session ends.
   *
   * Leaving a saved comment selected after Cancel can cause a later reactive
   * tool/selection change to reopen a popup the user explicitly closed.
   */
  this.resetCommentEditorState(true);
}

private resetCommentEditorState(
  clearSelection: boolean
): void {
  const returnFocus = this.commentEditorReturnFocus;

  this.editingCommentId = null;
  this.editingCommentText = '';
  this.editingCommentOriginalText = '';
  this.editingCommentOriginalResolved = false;
  this.editingCommentOriginalUpdatedAt = 0;
  this.commentEditorReturnFocus = null;

  if (clearSelection) {
    this.facade.clearSelection();
  }

  this.restoreCommentEditorFocus(returnFocus);
}

/** F7.2 Phase E — move keyboard focus into the active editor. */
private focusCommentEditor(): void {
  setTimeout(() => {
    const editor = this.commentEditorRef?.nativeElement;
    if (editor && this.editingCommentId) {
      editor.focus();
    }
  });
}

/** Restore focus when the dialog-like editor closes, if its trigger survives. */
private restoreCommentEditorFocus(
  element: HTMLElement | null
): void {
  if (!element || !element.isConnected) {
    return;
  }

  setTimeout(() => element.focus());
}

get editingCommentCharacterCount(): number {
  return this.editingCommentText.length;
}

getCommentMarkerAriaLabel(
  comment: { content: string; resolved: boolean }
): string {
  const state = comment.resolved ? 'Resolved comment' : 'Open comment';
  const preview = comment.content.trim();

  if (!preview) {
    return `${state}, empty draft`;
  }

  const compact = preview.replace(/\s+/g, ' ');
  const summary = compact.length > 80
    ? `${compact.slice(0, 77)}…`
    : compact;

  return `${state}: ${summary}`;
}

saveCommentEditor(event?: MouseEvent): void {
  event?.preventDefault();
  event?.stopPropagation();

  this.closeCommentEditor(true);
}

cancelCommentEditor(): void {
  this.closeCommentEditor(false);
}

private closeCommentEditorForPageChange(
  currentPage: number
): void {
  const objectId = this.editingCommentId;

  if (!objectId) {
    return;
  }

  const object =
    this.objectService.get(objectId);

  if (
    !object ||
    object.pageNumber !== currentPage
  ) {
    /**
     * Page navigation is an intentional cross-feature transition. Preserve
     * meaningful typed content rather than silently discarding it. Empty
     * drafts still disappear because closeCommentEditor(true) removes them.
     */
    this.closeCommentEditor(true);
  }
}

onCommentEditorInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement | null;
  this.editingCommentText = target?.value ?? '';
}

onCommentEditorKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); this.closeCommentEditor(false); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.closeCommentEditor(true); }
}

toggleEditingCommentResolved(): void {
  const objectId = this.editingCommentId;
  if (!objectId) { return; }
  const object = this.objectService.get(objectId);
  if (!object?.comment) { return; }
  const resolved =
    !object.comment.resolved;

  this.facade.setCommentResolved(
    objectId,
    resolved
  );

  /**
   * Resolve/Reopen is an immediate committed action. Refresh the local editor
   * baseline so the lifecycle effect does not mistake this intentional mutation
   * for an external Undo/Redo restore.
   */
  const updated =
    this.objectService.get(objectId);

  if (
    updated?.type === 'comment' &&
    updated.comment
  ) {
    this.editingCommentOriginalResolved =
      updated.comment.resolved;

    this.editingCommentOriginalUpdatedAt =
      updated.comment.updatedAt;
  }
}

private handleTextToolPointerDown(
  event: PointerEvent
): void {

  const page =
    this.pageRef?.nativeElement;

  if (!page) {
    return;
  }

  const pageRect =
    page.getBoundingClientRect();

  if (
    pageRect.width <= 0 ||
    pageRect.height <= 0
  ) {
    return;
  }

  const point =
    this.clientToPagePoint(
      event.clientX,
      event.clientY,
      pageRect
    );

  const selection =
    this.facade.createTextObject(
      point.x,
      point.y
    );

  if (!selection) {
    return;
  }

  this.beginTextEditing(
    selection.objectId
  );

  event.preventDefault();
  event.stopPropagation();
}

private handleImageToolPointerDown(
  event: PointerEvent
): void {

  const page =
    this.pageRef?.nativeElement;

  if (!page) {
    return;
  }

  const pageRect =
    page.getBoundingClientRect();

  if (
    pageRect.width <= 0 ||
    pageRect.height <= 0
  ) {
    return;
  }

  this.pendingImagePlacement =
    this.clientToPagePoint(
      event.clientX,
      event.clientY,
      pageRect
    );

  this.pendingImageReplacementId = null;

  const input =
    this.imageInputRef?.nativeElement;

  if (!input) {
    return;
  }

  input.value = '';
  input.click();

  event.preventDefault();
  event.stopPropagation();
}

async onImageSelected(
  event: Event
): Promise<void> {

  const input =
    event.target as HTMLInputElement | null;

  const file =
    input?.files?.[0] ?? null;

  if (input) {
    input.value = '';
  }

  const placement =
    this.pendingImagePlacement;

  const replacementId =
    this.pendingImageReplacementId;

  this.pendingImagePlacement = null;
  this.pendingImageReplacementId = null;

  if (!file) {
    return;
  }

  const documentId = this.facade.document()?.id;
  const pageNumber = this.facade.currentPage();
  this.previewError.set('');
  const image = await this.readImageFile(file);
  if (!image && !this.previewError()) this.previewError.set('Unable to read this image. Choose a valid PNG or JPEG file.');

  if (!image || this.destroyed || documentId !== this.facade.document()?.id || pageNumber !== this.facade.currentPage()) {
    return;
  }

  if (replacementId) {

    const selection =
      this.facade.replaceImageData(
        replacementId,
        image
      );

    if (selection) {
      this.facade.selectObject(
        selection
      );
    }

    return;
  }

  if (!placement) {
    return;
  }

  const selection =
    this.facade.createImageObject(
      placement.x,
      placement.y,
      image
    );

  if (!selection) {
    return;
  }

  this.facade.selectObject(
    selection
  );
}

private async readImageFile(file: File): Promise<StudioImageData | null> {
  try { return await readStudioImage(file); }
  catch (error) {
    this.previewError.set(error instanceof Error ? error.message : 'Unable to decode this image.');
    return null;
  }
}

private requestImageReplacement(
  objectId: string
): void {

  const object =
    this.objectService.get(
      objectId
    );

  if (
    !object ||
    object.type !== 'image'
  ) {
    return;
  }

  const input =
    this.imageInputRef?.nativeElement;

  if (!input) {
    return;
  }

  this.pendingImageReplacementId =
    objectId;

  this.pendingImagePlacement = null;

  input.value = '';
  input.click();
}

/**
 * Begin editing a text Studio object.
 */
private async beginTextEditing(
  objectId: string
): Promise<void> {
  const request = ++this.editRequest;
  const documentId = this.facade.document()?.id;
  const pageNumber = this.facade.currentPage();
  if (this.destroyed || this.facade.document()?.id !== documentId || this.facade.currentPage() !== pageNumber) return;
  const object =
    this.objectService.get(
      objectId
    );

  if (
    !object ||
    object.type !== 'text'
  ) {
    return;
  }

  if (this.activeRenderVersion === null) this.capturePdfTextAppearance(object);
  this.editingOriginalObject = this.objectService.get(objectId);
  this.editingVisualBounds.set(null);
  this.editingObjectId = objectId;
  this.editingSession.set(objectId);
  this.textDraft.set({ id: objectId, text: object.text ?? '' });

  this.editingText =
    object.text ?? '';

  this.editingOriginalText =
    this.editingText;

  this.editingOriginalStyle =
    object.textStyle
      ? { ...object.textStyle }
      : null;

  this.editingFontSizeInput =
    String(Number((pdfFontSize(object.pdfText) ?? this.getObjectFontSizePx(object)).toFixed(3)));

  this.facade.selectObject(
    this.selectionEngine.toSelection(
      object
    )
  );

  if (
    typeof window !== 'undefined'
  ) {
    window.requestAnimationFrame(() => {

      const editor =
        this.textEditorRef?.nativeElement;

      if (!editor || request !== this.editRequest || this.editingObjectId !== objectId) {
        return;
      }

      editor.focus();
      editor.select();
      this.syncTextEditorLayout();
    });
  }
}

/**
 * Current text-editor value.
 */
onTextEditorInput(
  event: Event
): void {

  const target =
    event.target as
      HTMLTextAreaElement | null;

  if (!target || target.dataset['editingObjectId'] !== this.editingObjectId) {
    return;
  }

  this.editingText = target.value;
  if(this.editingObjectId)this.textDraft.set({id:this.editingObjectId,text:this.editingText});
  this.syncTextEditorLayout();
}

/**
 * Resize the native textarea to its actual wrapped content height. This keeps
 * the caret and every replacement glyph visible while editing a source run.
 */
private scheduleTextEditorLayout(): void {
  if (!this.isBrowser || this.destroyed || !this.editingObjectId || this.editorLayoutFrame) return;
  this.editorLayoutFrame = requestAnimationFrame(() => {
    this.editorLayoutFrame = 0;
    if (!this.destroyed) this.syncTextEditorLayout();
  });
}

private syncTextEditorLayout(): void {
  const editor = this.textEditorRef?.nativeElement;
  const object = this.editingTextObject;
  if (!editor || !object) return;

  if (editor.dataset['editingObjectId'] !== object.id) return;
  const sizeInput = document.querySelector('.studio-text-toolbar input[aria-label="Text size"]');
  if (document.activeElement !== sizeInput) {
    this.editingFontSizeInput = String(Number((pdfFontSize(object.pdfText) ?? this.getObjectFontSizePx(object)).toFixed(3)));
  }
  const draft = { ...object, text: editor.value };
  const size = object.pdfText?.fitMode === 'auto' ? this.getPdfOverlayFontSizePx(draft) : this.getObjectFontSizePx(object);
  editor.style.fontSize = `${size}px`;
  editor.style.height = '0px';
  const minimum = this.getPdfTextEditorHeightPx(object);
  editor.style.height = `${Math.max(minimum, editor.scrollHeight)}px`;
  const page = this.pageRef?.nativeElement.getBoundingClientRect();
  const rect = editor.getBoundingClientRect();
  if (page && page.width > 0 && page.height > 0) {
    this.editingVisualBounds.set({ id: object.id, bounds: {
      x: (rect.left - page.left) / page.width, y: (rect.top - page.top) / page.height,
      width: rect.width / page.width, height: rect.height / page.height } });
  }
  const font = `${textFontStyle(object)} ${textFontWeight(object)} ${size}px ${this.getObjectFontFamilyCss(object)}`;
  if (!this.requestedEditorFonts.has(font)) {
    this.requestedEditorFonts.add(font);
    if (this.requestedEditorFonts.size > 64) this.requestedEditorFonts.delete(this.requestedEditorFonts.values().next().value!);
    void document.fonts.load(font).then(() => {
      if (this.editingObjectId === object.id) { this.overlaySizes.clear(); this.scheduleTextEditorLayout(); }
    }).catch(() => {});
  }
}

/**
 * Keyboard behavior inside the text editor.
 */
onTextEditorKeyDown(
  event: KeyboardEvent
): void {

  if (
    event.key === 'Escape'
  ) {
    event.preventDefault();
    event.stopPropagation();
    this.cancelTextEdit();
    return;
  }

  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const cell = this.editingTextObject?.pdfText?.tableId;
    if (cell) {
      const cells = this.objectService.listForPage(this.facade.currentPage())
        .filter(object => object.pdfText?.tableId === cell)
        .sort((a, b) => (a.pdfText!.tableOrder ?? 0) - (b.pdfText!.tableOrder ?? 0));
      const index = cells.findIndex(object => object.id === this.editingObjectId);
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      this.commitTextEdit();
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        void this.beginTextEditing(next.id);
      }
      return;
    }
  }

  const modifier =
    event.ctrlKey ||
    event.metaKey;

  if (
    modifier &&
    event.key === 'Enter'
  ) {
    event.preventDefault();
    event.stopPropagation();
    this.commitTextEdit();
    return;
  }

  if (
    modifier &&
    event.key.toLowerCase() === 'b'
  ) {
    event.preventDefault();
    event.stopPropagation();
    this.toggleTextBold();
    return;
  }

  if (
    modifier &&
    event.key.toLowerCase() === 'i'
  ) {
    event.preventDefault();
    event.stopPropagation();
    this.toggleTextItalic();
  }
}

/**
 * Synchronize the local editing buffer from the live textarea.
 *
 * This is intentionally read directly before commit because DOM
 * input can be ahead of the last Angular change-detection pass.
 */
private syncTextEditorValue(): void {

  const editor =
    this.textEditorRef?.nativeElement;

  if (
    editor &&
    this.editingObjectId && editor.dataset['editingObjectId'] === this.editingObjectId
  ) {
    this.editingText = editor.value;
  }
}

/**
 * Finish the current text edit. Empty text is discarded silently.
 */
commitTextEdit(): void {
  ++this.editRequest;
  this.editingSession.set(null);
  this.textDraft.set(null);

  const objectId =
    this.editingObjectId;

  if (!objectId) {
    return;
  }

  this.syncTextEditorValue();

  const text =
    this.editingText;

  if (
    text.trim().length === 0
  ) {
    /**
     * F5 — Route the removal through the Facade so deleting an empty text
     * object participates in the same Undo/Redo history as every other
     * document mutation.
     */
    this.facade.discardTextObject(
      objectId
    );

    // update/discard operations may refresh the shared selection state.
    // A completed edit must never leave the old source-text selection chrome
    // visible after the editor session has ended.
    this.facade.clearSelection();

    this.editingObjectId = null;
    this.editingText = '';
    this.editingOriginalText = '';
    this.editingOriginalStyle = null;
    this.editingFontSizeInput = '14';
    return;
  }



  this.facade.updateTextObject(
    objectId,
    text
  );

  /*
   * updateTextObject() intentionally re-selects the edited object so the
   * normal Select tool can show the updated bounds. That is correct for a
   * generic object mutation, but it is wrong when a text-edit session ends:
   * the editor must not leave the old line selected after Done or an
   * outside-click commit. Clear the shared selection AFTER the mutation so
   * the mutation cannot immediately recreate the selection chrome.
   */
  this.facade.clearSelection();

  this.editingObjectId = null;
  this.editingSession.set(null);
  this.editingText = '';
  this.editingOriginalText = '';
  this.editingOriginalStyle = null;
}

/**
 * Cancel the edit and restore the original value.
 */
cancelTextEdit(): void {
  ++this.editRequest;
  this.editingSession.set(null);
  this.textDraft.set(null);

  const objectId =
    this.editingObjectId;

  if (!objectId) {
    return;
  }

  const originalText =
    this.editingOriginalText;

  if (this.editingOriginalObject && JSON.stringify(this.objectService.get(objectId)) !== JSON.stringify(this.editingOriginalObject)) {
    this.facade.restoreTextEdit(this.editingOriginalObject);
  }
  this.editingOriginalObject = null;
  this.editingVisualBounds.set(null);

  this.editingObjectId = null;
  this.editingSession.set(null);
  this.editingText = '';
  this.editingOriginalText = '';
  this.editingOriginalStyle = null;

  // Cancel also ends the edit session, so do not leave the cancelled source
  // line selected. The object itself remains intact and can be selected again
  // explicitly with the Select tool.
  this.facade.clearSelection();
}

get isTextEditing(): boolean {
  return this.editingObjectId !== null;
}

get editingTextObject(): StudioObject | null {

  if (!this.editingObjectId) {
    return null;
  }

  const object = this.objectService.get(this.editingObjectId);
  return object ? {...object, bounds: this.getDisplayBounds(object)} : null;
}

/**
 * Convert the normalized font-size ratio into
 * current CSS pixels so the control remains usable.
 */
getObjectFontSizePx(
  object: StudioObject
): number {

  const page =
    this.pageRef?.nativeElement;

  const pageHeight =
    page?.getBoundingClientRect().height ?? 0;

  /* Existing PDF text must keep the exact PDF-derived size. */
  const sourceSize = pdfFontSize(object.pdfText);
  const sourcePageHeight = object.pdfText?.pageHeightPdf;
  const sourceRatio =
    typeof sourceSize === 'number' && Number.isFinite(sourceSize) && sourceSize > 0 &&
    typeof sourcePageHeight === 'number' && Number.isFinite(sourcePageHeight) && sourcePageHeight > 0
      ? sourceSize / sourcePageHeight
      : object.pdfText?.detectedFontSize ??
        object.textStyle?.fontSize ??
        0.018;

  if (pageHeight <= 0) {
    return typeof sourceSize === 'number' && Number.isFinite(sourceSize) && sourceSize > 0
      ? Math.max(0.1, sourceSize * (96 / 72))
      : Math.max(0.1, sourceRatio * 1000);
  }

  return Math.max(0.1, pageHeight * sourceRatio);
}

/**
 * Resolve the authoritative weight for an existing PDF text run.
 *
 * The generic Studio text style only supports the user-created 400/700
 * controls. Existing PDF text is different: PDF.js distinguishes regular,
 * bold and black faces, and collapsing black into 700 visibly changes glyph
 * shape. Keep the source weight separate from the generic Studio style.
 */
getObjectFontWeightCss(
  object: StudioObject
): 400 | 700 | 900 {
  return textFontWeight(object);
}

/**
 * Prefer the PDF.js-discovered source family for the live browser editor.
 * The normalized Studio family remains the export fallback.
 */
getObjectFontFamilyCss(
  object: StudioObject
): string {

  if (pdfFontFaceChanged(object)) {
    if (/calibri|carlito/i.test(object.pdfText?.sourceFontFamily ?? '')) return '"StudioCarlito"';
    if (object.textStyle?.fontFamily === 'Times Roman') return '"Times New Roman", Times, serif';
    if (object.textStyle?.fontFamily === 'Courier') return '"Courier New", Courier, monospace';
    return 'Arial, Helvetica, "StudioFallback", sans-serif';
  }
  const sourceCssFamily =
    object.pdfText?.sourceFontCssFamily?.trim();

  if (sourceCssFamily) {
    /*
     * This is PDF.js's actual loaded font face. Keep it quoted so internal
     * names such as g_d0_f12 can never be interpreted as a fallback list.
     */
    const escapedFamily =
      sourceCssFamily
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\\"');

    return /calibri|carlito/i.test(object.pdfText?.sourceFontFamily??'') ? `"${escapedFamily}", "StudioCarlito"` : `"${escapedFamily}", "StudioFallback"`;
  }

  const sourceFamily =
    object.pdfText?.sourceFontFamily?.trim();

  if (sourceFamily) {
    return sourceFamily;
  }

  switch (object.textStyle?.fontFamily) {
    case 'Times Roman':
      return '"Times New Roman", Times, serif';

    case 'Courier':
      return '"Courier New", Courier, monospace';

    case 'Helvetica':
    default:
      return 'Arial, Helvetica, sans-serif';
  }
}

get editingFontSizePx(): number {

  const parsed = Number(this.editingFontSizeInput);

  if (Number.isFinite(parsed)) {
    return Math.max(0.1, parsed);
  }

  const object = this.editingTextObject;

  return object
    ? this.getObjectFontSizePx(object)
    : 14;
}

private updateEditingTextStyle(
  style: Partial<
    import(
      '../../models/studio-selection.model'
    ).StudioTextStyle
  >
): void {

  const objectId =
    this.editingObjectId;

  if (!objectId) {
    return;
  }

  this.facade.updateTextStyle(
    objectId,
    style
  );
}

/**
 * Keep the font-size field independent from the computed visual size
 * while the user is typing.
 */
onFontSizeInput(
  event: Event
): void {

  const target =
    event.target as HTMLInputElement | null;

  if (!target) {
    return;
  }

  this.editingFontSizeInput = target.value;

  const value = Number(target.value);

  if (!target.value.trim() || !Number.isFinite(value) || value < 1 || value > 512) {
    return;
  }

  this.applyFontSizePx(value);
}

/** Normalize the font-size field after editing is finished. */
onFontSizeChange(
  event: Event
): void {

  const target =
    event.target as HTMLInputElement | null;

  if (!target) {
    return;
  }

  this.commitFontSizeValue(target.value);
}

private commitFontSizeValue(valueText: string): void {

  const parsed = valueText.trim() ? Number(valueText) : NaN;
  const object = this.editingTextObject;
  const fallback = object ? (pdfFontSize(object.pdfText) ?? this.getObjectFontSizePx(object)) : 14;
  const px = Number.isFinite(parsed)
    ? Math.max(1, Math.min(512, parsed))
    : fallback;

  this.editingFontSizeInput = String(Number(px.toFixed(3)));
  this.applyFontSizePx(px);
}

private applyFontSizePx(px: number): void {

  const page =
    this.pageRef?.nativeElement;

  const pageHeight =
    page?.getBoundingClientRect().height ?? 0;

  if (pageHeight <= 0) {
    return;
  }

  const clampedPx =
    Math.max(1, Math.min(512, px));

  this.updateEditingTextStyle({
    fontSize: clampedPx / (this.editingTextObject?.pdfText?.pageHeightPdf ?? pageHeight)
  });
}

toggleTextBold(): void {

  const object =
    this.editingTextObject;

  if (!object) {
    return;
  }

  this.updateEditingTextStyle({
    fontWeight:
      textFontWeight(object) >=
        700
        ? 400
        : 700
  });
}

toggleTextItalic(): void {

  const object =
    this.editingTextObject;

  if (!object) {
    return;
  }

  this.updateEditingTextStyle({
    fontStyle:
      textFontStyle(object) ===
        'italic'
        ? 'normal'
        : 'italic'
  });
}

setTextAlign(
  align:
    import(
      '../../models/studio-selection.model'
    ).StudioTextAlign
): void {

  this.updateEditingTextStyle({
    textAlign: align
  });
}

  /**
   * Move the scroll position while panning.
   */
  onPointerMove(
    event: PointerEvent
  ): void {
    this.updateSigningPointer(event);

    if (
      this.objectInteraction &&
      this.objectInteraction.pointerId ===
        event.pointerId
    ) {
      event.preventDefault();

      this.updateObjectInteraction(
        event
      );

      return;
    }

    if (
      this.drawingInteraction &&
      this.drawingInteraction.pointerId ===
        event.pointerId
    ) {
      event.preventDefault();

      this.updateDrawingToolPointer(event);

      return;
    }

    if (
      !this.isPanning ||
      this.panPointerId !==
        event.pointerId
    ) {
      return;
    }

    const viewport =
      this.viewportRef?.nativeElement;

    if (!viewport) {
      return;
    }

    event.preventDefault();

    const deltaX =
      event.clientX -
      this.panStartX;

    const deltaY =
      event.clientY -
      this.panStartY;

    viewport.scrollLeft =
      this.panScrollLeft -
      deltaX;

    viewport.scrollTop =
      this.panScrollTop -
      deltaY;
  }

  /**
   * Start moving the currently selected object.
   *
   * The selection box sits above the editor object, so
   * dragging inside the selected bounds naturally moves
   * the object instead of selecting it again.
   */
  onSelectionPointerDown(
    event: PointerEvent
  ): void {

    if (
      event.button !== 0 ||
      this.spacePressed ||
      !this.canTransformCurrentSelection()
    ) {
      return;
    }

    if (event.altKey) {
      const page = this.pageRef?.nativeElement;
      const rect = page?.getBoundingClientRect();

      if (rect && rect.width > 0 && rect.height > 0) {
        const point = this.clientToPagePoint(
          event.clientX,
          event.clientY,
          rect
        );
        this.selectObjectAtPoint(point.x, point.y);
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const selection =
      this.facade.selection();

    if (!selection) {
      return;
    }

    const object =
      this.objectService.get(
        selection.objectId
      );

    if (!object) {
      this.facade.clearSelection();
      return;
    }

    this.startObjectInteraction(
      event,
      'move',
      object
    );
  }

  /**
   * Start resizing the current selection.
   */
  onResizeHandlePointerDown(
    event: PointerEvent,
    handle: SelectionResizeHandle
  ): void {

    if (
      event.button !== 0 ||
      this.spacePressed ||
      !this.canTransformCurrentSelection()
    ) {
      return;
    }

    let selection =
      this.facade.selection();

    if (!selection) {
      return;
    }

    const selectedObjectId =
      selection.objectId;

    const object =
      this.objectService.get(
        selectedObjectId
      );

    if (!object) {
      this.facade.clearSelection();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.startObjectInteraction(
      event,
      'resize',
      object,
      handle
    );
  }

  private canTransformCurrentSelection(): boolean {
    const activeTool = this.facade.activeTool();

    if (activeTool === 'select' || activeTool === 'edit-pdf-text') {
      return true;
    }

    if (activeTool === 'sign') {
      return this.facade.selection()?.type === 'signature';
    }

    if (activeTool !== 'comment') {
      return false;
    }

    return this.facade.selection()?.type === 'comment';
  }

  private startObjectInteraction(
    event: PointerEvent,
    mode: 'move' | 'resize',
    object: StudioObject,
    handle?: SelectionResizeHandle
  ): void {

    const page =
      this.pageRef?.nativeElement;

    if (!page) {
      return;
    }

    const pageRect =
      page.getBoundingClientRect();

    if (
      pageRect.width <= 0 ||
      pageRect.height <= 0
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (
      !this.facade.beginObjectTransform(
        object.id
      )
    ) {
      return;
    }

    if (object.pdfText) this.textTransformActive.set(true);
    this.objectInteraction = {
      mode,
      objectId: object.id,
      objectType: object.type,
      pointerId: event.pointerId,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds: {
        x: object.bounds.x,
        y: object.bounds.y,
        width: object.bounds.width,
        height: object.bounds.height
      },
      pageWidth: pageRect.width,
      pageHeight: pageRect.height,
      // Freeform corner resizing is the default. Hold Shift to preserve
      // the aspect ratio for images/signatures. This keeps width and height
      // independently resizable and avoids the old height-only feeling when
      // the pointer moves mostly vertically.
      preserveAspectRatio:
        (object.type === 'image' || object.type === 'signature') &&
        event.shiftKey
    };

    const captureTarget =
      event.currentTarget as
        | Element
        | null;

    try {
      captureTarget?.setPointerCapture(
        event.pointerId
      );
    } catch {
      /**
       * Pointer capture is a progressive enhancement.
       * Window-level pointer events are not required here
       * because the gesture is initiated inside the stage.
       */
    }

    this.stageRef?.nativeElement.classList.add(
      'studio-canvas__stage--object-interacting'
    );
  }

  private updateObjectInteraction(
    event: PointerEvent
  ): void {

    const interaction =
      this.objectInteraction;

    if (!interaction) {
      return;
    }

    const deltaX =
      event.clientX -
      interaction.startClientX;

    const deltaY =
      event.clientY -
      interaction.startClientY;

    const bounds =
      interaction.mode === 'move'
        ? this.calculateMoveBounds(
            interaction,
            deltaX,
            deltaY
          )
        : this.calculateResizeBounds(
            interaction,
            deltaX,
            deltaY
          );

    const updated =
      this.facade.previewObjectBounds(
        interaction.objectId,
        bounds
      );

    if (!updated) {
      return;
    }

    /**
     * Refresh the reactive selection state so both the
     * selection outline and the editor object update on
     * every drag frame.
     */
    this.facade.selectObject(
  updated
);

const updatedObject =
  this.objectService.get(
    updated.objectId
  );

if (updatedObject) {
  this.syncSelectionStyleControls(
    updatedObject
  );
}
  }

  private calculateMoveBounds(
    interaction: ObjectInteraction,
    deltaX: number,
    deltaY: number
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const start =
      interaction.startBounds;

    /**
     * Object bounds are normalized (0..1), while PointerEvent
     * deltas are CSS pixels. Convert the drag distance before
     * applying it to the normalized object coordinates.
     */
    const normalizedDeltaX =
      interaction.pageWidth > 0
        ? deltaX / interaction.pageWidth
        : 0;

    const normalizedDeltaY =
      interaction.pageHeight > 0
        ? deltaY / interaction.pageHeight
        : 0;

    const maxX =
      Math.max(
        0,
        1 - start.width
      );

    const maxY =
      Math.max(
        0,
        1 - start.height
      );

    return {
      x: this.clamp(
        start.x + normalizedDeltaX,
        0,
        maxX
      ),
      y: this.clamp(
        start.y + normalizedDeltaY,
        0,
        maxY
      ),
      width: start.width,
      height: start.height
    };
  }

  private calculateResizeBounds(
    interaction: ObjectInteraction,
    deltaX: number,
    deltaY: number
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const start =
      interaction.startBounds;

    /**
     * Selection bounds are normalized to the page. PointerEvent
     * movement is measured in CSS pixels, so every resize delta
     * must be converted to the same normalized coordinate space.
     */
    const normalizedDeltaX =
      interaction.pageWidth > 0
        ? deltaX / interaction.pageWidth
        : 0;

    const normalizedDeltaY =
      interaction.pageHeight > 0
        ? deltaY / interaction.pageHeight
        : 0;

    /**
     * Minimum dimensions are defined in pixels for predictable
     * UI behavior, then normalized for the current page size.
     */
    const isComment =
      interaction.objectType === 'comment';

    const minWidthPx =
      isComment
        ? this.MIN_COMMENT_SIZE
        : this.MIN_OBJECT_WIDTH;

    const minHeightPx =
      isComment
        ? this.MIN_COMMENT_SIZE
        : this.MIN_OBJECT_HEIGHT;

    const minWidth =
      interaction.pageWidth > 0
        ? minWidthPx / interaction.pageWidth
        : 0.0001;

    const minHeight =
      interaction.pageHeight > 0
        ? minHeightPx / interaction.pageHeight
        : 0.0001;

    const right =
      start.x + start.width;

    const bottom =
      start.y + start.height;

    let x = start.x;
    let y = start.y;
    let width = start.width;
    let height = start.height;

    switch (interaction.handle) {

      case 'nw': {
        const nextX =
          this.clamp(
            start.x + normalizedDeltaX,
            0,
            right -
              minWidth
          );

        const nextY =
          this.clamp(
            start.y + normalizedDeltaY,
            0,
            bottom -
              minHeight
          );

        x = nextX;
        y = nextY;
        width = right - nextX;
        height = bottom - nextY;
        break;
      }

      case 'ne': {
        const nextRight =
          this.clamp(
            right + normalizedDeltaX,
            start.x +
              minWidth,
            1
          );

        const nextY =
          this.clamp(
            start.y + normalizedDeltaY,
            0,
            bottom -
              minHeight
          );

        y = nextY;
        width =
          nextRight -
          start.x;
        height =
          bottom -
          nextY;
        break;
      }

      case 'sw': {
        const nextX =
          this.clamp(
            start.x + normalizedDeltaX,
            0,
            right -
              minWidth
          );

        const nextBottom =
          this.clamp(
            bottom + normalizedDeltaY,
            start.y +
              minHeight,
            1
          );

        x = nextX;
        width =
          right -
          nextX;
        height =
          nextBottom -
          start.y;
        break;
      }

      case 'se': {
        const nextRight =
          this.clamp(
            right + normalizedDeltaX,
            start.x +
              minWidth,
            1
          );

        const nextBottom =
          this.clamp(
            bottom + normalizedDeltaY,
            start.y +
              minHeight,
            1
          );

        width =
          nextRight -
          start.x;
        height =
          nextBottom -
          start.y;
        break;
      }

      default:
        break;
    }

    if (
      interaction.preserveAspectRatio &&
      interaction.handle
    ) {
      return this.applyAspectRatioResize(
        interaction,
        x,
        y,
        width,
        height
      );
    }

    return {
      x,
      y,
      width,
      height
    };
  }

  private applyAspectRatioResize(
    interaction: ObjectInteraction,
    x: number,
    y: number,
    width: number,
    height: number
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {

    const start =
      interaction.startBounds;

    const aspectRatio =
      start.width > 0 &&
      start.height > 0
        ? (
            start.width *
            interaction.pageWidth
          ) /
          (
            start.height *
            interaction.pageHeight
          )
        : 1;

    if (
      !Number.isFinite(aspectRatio) ||
      aspectRatio <= 0
    ) {
      return {
        x,
        y,
        width,
        height
      };
    }

    const minWidth =
      interaction.pageWidth > 0
        ? this.MIN_OBJECT_WIDTH /
          interaction.pageWidth
        : 0.0001;

    const minHeight =
      interaction.pageHeight > 0
        ? this.MIN_OBJECT_HEIGHT /
          interaction.pageHeight
        : 0.0001;

    const right =
      start.x + start.width;

    const bottom =
      start.y + start.height;

    let nextWidth =
      Math.max(
        minWidth,
        width
      );

    let nextHeight =
      Math.max(
        minHeight,
        nextWidth / aspectRatio
      );

    nextWidth =
      Math.max(
        minWidth,
        nextHeight * aspectRatio
      );

    let nextX = x;
    let nextY = y;

    switch (interaction.handle) {

      case 'se':
        nextX = start.x;
        nextY = start.y;
        break;

      case 'sw':
        nextX = right - nextWidth;
        nextY = start.y;
        break;

      case 'ne':
        nextX = start.x;
        nextY = bottom - nextHeight;
        break;

      case 'nw':
        nextX = right - nextWidth;
        nextY = bottom - nextHeight;
        break;
    }

    if (nextX < 0) {
      nextX = 0;
      nextWidth =
        Math.min(
          1,
          right
        );
      nextHeight =
        nextWidth / aspectRatio;
    }

    if (nextY < 0) {
      nextY = 0;
      nextHeight =
        Math.min(
          1,
          bottom
        );
      nextWidth =
        nextHeight * aspectRatio;
    }

    if (nextX + nextWidth > 1) {
      nextWidth =
        1 - nextX;
      nextHeight =
        nextWidth / aspectRatio;
    }

    if (nextY + nextHeight > 1) {
      nextHeight =
        1 - nextY;
      nextWidth =
        nextHeight * aspectRatio;
    }

    return {
      x: this.clamp(
        nextX,
        0,
        Math.max(
          0,
          1 - nextWidth
        )
      ),
      y: this.clamp(
        nextY,
        0,
        Math.max(
          0,
          1 - nextHeight
        )
      ),
      width:
        Math.max(0.0001, nextWidth),
      height:
        Math.max(0.0001, nextHeight)
    };
  }

  private clamp(
    value: number,
    min: number,
    max: number
  ): number {
    return Math.min(
      Math.max(value, min),
      max
    );
  }

  private refocusTextEditor(): void {

    if (
      typeof window === 'undefined' ||
      !this.editingObjectId
    ) {
      return;
    }

    const start = this.textEditorRef?.nativeElement.selectionStart;
    const end = this.textEditorRef?.nativeElement.selectionEnd;
    window.requestAnimationFrame(() => {

      if (!this.editingObjectId) {
        return;
      }

      const editor =
        this.textEditorRef?.nativeElement;

      editor?.focus();

      if (editor) {
        const length = editor.value.length;
        editor.setSelectionRange(Math.min(start ?? length, length), Math.min(end ?? length, length));
      }
    });
  }

  private cancelObjectInteraction(
    event?: PointerEvent
  ): void {

    const interaction =
      this.objectInteraction;

    if (!interaction) {
      return;
    }

    this.objectInteraction = null;
    this.textTransformActive.set(false);

    this.stageRef?.nativeElement.classList.remove(
      'studio-canvas__stage--object-interacting'
    );

    if (event) {
      try {
        (event.currentTarget as Element | null)?.releasePointerCapture(
          event.pointerId
        );
      } catch {
        /* Pointer capture may already be released. */
      }
    }

    // Restore the original bounds after an interrupted drag/resize without
    // creating a new history entry.
    this.facade.previewObjectBounds(
      interaction.objectId,
      interaction.startBounds
    );

    this.facade.cancelObjectTransform(
      interaction.objectId
    );
  }

  private finishObjectInteraction(
    event?: PointerEvent
  ): void {

    const interaction =
      this.objectInteraction;

    if (!interaction) {
      return;
    }

    this.objectInteraction =
      null;
    this.textTransformActive.set(false);

    this.stageRef?.nativeElement.classList.remove(
      'studio-canvas__stage--object-interacting'
    );

    if (event) {
      const captureTarget =
        event.currentTarget as
          | Element
          | null;

      try {
        captureTarget?.releasePointerCapture(
          event.pointerId
        );
      } catch {
        /**
         * Pointer capture may already have been released.
         */
      }
    }

    this.facade.commitObjectTransform(
      interaction.objectId
    );

    /**
     * A resize can legitimately move focus away from the textarea.
     * Keep the same edit session alive and return focus after the
     * gesture so the user can continue typing without reopening edit.
     */
    if (
      interaction.mode === 'resize' &&
      this.editingObjectId === interaction.objectId
    ) {
      this.syncTextEditorLayout();
      this.refocusTextEditor();
    }
  }

  private handleSelectionPointerDown(event: PointerEvent): void {

  const page = this.pageRef?.nativeElement;

  if (!page) {
    return;
  }

  const pageRect = page.getBoundingClientRect();

  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return;
  }

  const point =
    this.clientToPagePoint(
      event.clientX,
      event.clientY,
      pageRect
    );

  if (event.altKey) {
    this.selectObjectAtPoint(
      point.x,
      point.y
    );
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const object = this.selectObjectAtPoint(
    point.x,
    point.y
  );

  if (!object) {
    this.facade.clearSelection();
    this.resetSelectionCycle();
    event.preventDefault();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}


  /**
   * Find only an existing comment marker. The Comment tool must not select a
   * text/image/shape underneath the pointer and accidentally treat that click
   * as a new comment-placement gesture.
   */
  private selectCommentAtPoint(
    x: number,
    y: number
  ): StudioObject | null {
    const pageNumber = this.facade.currentPage();
    const comments = this.objectService
      .listForPage(pageNumber)
      .filter(object => object.type === 'comment');

    const hits = this.selectionEngine.hitTestAll(
      comments,
      pageNumber,
      x,
      y
    );

    if (!hits.length) {
      this.resetSelectionCycle();
      return null;
    }

    /**
     * F7.2 Phase D — Multiple comments may occupy the same page-space point.
     * Repeated clicks cycle through comment markers only, matching the normal
     * overlapping-object selection behavior without ever selecting a
     * non-comment while the Comment tool is active.
     */
    const now = Date.now();
    const key = `comment:${x.toFixed(4)}:${y.toFixed(4)}`;
    const objectIds = hits.map(hit => hit.id);
    const sameStack =
      this.selectionCycle.key === key &&
      this.selectionCycle.pageNumber === pageNumber &&
      this.selectionCycle.objectIds.length === objectIds.length &&
      this.selectionCycle.objectIds.every(
        (id, index) => id === objectIds[index]
      ) &&
      now - this.selectionCycle.timestamp <=
        this.selectionCycleWindowMs;

    const index = sameStack
      ? (this.selectionCycle.index - 1 + hits.length) % hits.length
      : hits.length - 1;

    const comment = hits[index];

    this.selectionCycle = {
      key,
      objectIds,
      index,
      timestamp: now,
      x,
      y,
      pageNumber
    };

    this.facade.selectObject(
      this.selectionEngine.toSelection(comment)
    );
    this.syncSelectionStyleControls(comment);
    return comment;
  }

  /**
   * Select an object at a point, cycling through every overlapping object.
   * This solves the case where an older annotation is completely covered by
   * a newer shape/draw/highlight. Repeated clicks at the same point move from
   * front-most to back-most without requiring objects to be moved first.
   */
  private selectObjectAtPoint(
    x: number,
    y: number,
    preferredObjectId?: string
  ): StudioObject | null {
    const pageNumber = this.facade.currentPage();
    const tool = this.facade.activeTool();
    const objects = this.studioObjects.filter(object =>
      tool === 'edit-pdf-text' ? !!(object.pdfText || object.pdfImage) : tool === 'edit-pdf-image' ? !!object.pdfImage : true);
    const hits = this.selectionEngine.hitTestAll(
      objects,
      pageNumber,
      x,
      y
    );

    if (!hits.length) {
      this.resetSelectionCycle();
      return null;
    }

    const now = Date.now();
    const key = `${x.toFixed(4)}:${y.toFixed(4)}`;
    const objectIds = hits.map(hit => hit.id);
    const sameStack =
      this.selectionCycle.key === key &&
      this.selectionCycle.objectIds.length === objectIds.length &&
      this.selectionCycle.objectIds.every(
        (id, index) => id === objectIds[index]
      ) &&
      now - this.selectionCycle.timestamp <=
        this.selectionCycleWindowMs;

    let index = hits.length - 1;

    if (sameStack) {
      index =
        (this.selectionCycle.index - 1 + hits.length) %
        hits.length;
    } else if (preferredObjectId) {
      const preferredIndex =
        objectIds.indexOf(preferredObjectId);

      if (preferredIndex >= 0) {
        index = preferredIndex;
      }
    }

    const object = hits[index];

    this.selectionCycle = {
      key,
      objectIds,
      index,
      timestamp: now,
      x,
      y,
      pageNumber
    };

    this.facade.selectObject(
      this.selectionEngine.toSelection(object)
    );
    this.syncSelectionStyleControls(object);

    return object;
  }

  private resetSelectionCycle(): void {
    this.selectionCycle = {
      key: '',
      objectIds: [],
      index: -1,
      timestamp: 0,
      x: 0,
      y: 0,
      pageNumber: 0
    };
  }

  private syncSelectionStyleControls(
    object: StudioObject
  ): void {

    if (
      object.type === 'shape' &&
      object.shape
    ) {
      this.selectedShapeStrokeColor =
        object.shape.style.strokeColor;

      this.selectedShapeFillEnabled =
        Boolean(
          object.shape.style.fillColor
        );

      this.selectedShapeFillColor =
        object.shape.style.fillColor ??
        this.selectedShapeFillColor;

      const page =
        this.pageRef?.nativeElement;

      const pageHeight =
        page?.getBoundingClientRect().height ?? 0;

      if (pageHeight > 0) {
        this.selectedShapeWidthPx =
          Math.max(
            1,
            Math.round(
              object.shape.style.strokeWidth *
                pageHeight
            )
          );
      }

      this.selectedShapeKind =
        object.shape.kind;

      return;
    }

    if (
      (
        object.type === 'draw' ||
        object.type === 'highlight'
      ) &&
      object.drawing
    ) {
      if (object.type === 'highlight') {
        this.selectedHighlightColor =
          object.drawing.style.strokeColor;
      } else {
        this.selectedDrawingColor =
          object.drawing.style.strokeColor;
      }

      const page =
        this.pageRef?.nativeElement;

      const pageHeight =
        page?.getBoundingClientRect().height ?? 0;

      if (pageHeight > 0) {
        const widthPx = Math.max(
          1,
          Math.round(
            object.drawing.style.strokeWidth * pageHeight
          )
        );

        if (object.type === 'highlight') {
          this.selectedHighlightWidthPx = widthPx;
        } else {
          this.selectedDrawingWidthPx = widthPx;
        }
      }
    }
  }

private clientToPagePoint(clientX: number,clientY: number,pageRect: DOMRect): {
  x: number;
  y: number;
} {

  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return {
      x: 0,
      y: 0
    };
  }

  return {
    x: Math.min(1,Math.max(0,(clientX - pageRect.left) / pageRect.width)),
    y: Math.min(1,Math.max(0,(clientY - pageRect.top) / pageRect.height))
  };
}

  /**
   * Cancel an unfinished shape/drawing gesture without creating an object.
   * Used for pointercancel and intentional tool switches.
   */
  private cancelDrawingInteraction(): void {
    const interaction = this.drawingInteraction;

    if (!interaction) {
      return;
    }

    this.drawingInteraction = null;

    try {
      this.stageRef?.nativeElement.releasePointerCapture(
        interaction.pointerId
      );
    } catch {
      /* Pointer capture may already be released. */
    }
  }

  /**
   * Cancel all active pointer interaction state without committing it.
   */
  onPointerCancel(event: PointerEvent): void {
    if (this.paletteDrag && this.paletteDrag.pointerId === event.pointerId) {
      this.paletteDrag = null;
      return;
    }

    if (
      this.drawingInteraction &&
      this.drawingInteraction.pointerId === event.pointerId
    ) {
      event.preventDefault();
      this.cancelDrawingInteraction();
      return;
    }

    if (
      this.objectInteraction &&
      this.objectInteraction.pointerId === event.pointerId
    ) {
      event.preventDefault();
      this.cancelObjectInteraction(event);
      return;
    }

    if (
      this.isPanning &&
      this.panPointerId === event.pointerId
    ) {
      this.cancelPanning(event);
    }
  }

  /**
   * Clear an active pan gesture without changing the viewport position.
   */
  private cancelPanning(event?: PointerEvent): void {
    const stage = this.stageRef?.nativeElement;

    this.isPanning = false;
    this.panPointerId = null;

    stage?.classList.remove(
      'studio-canvas__stage--panning'
    );

    if (!event) {
      return;
    }

    try {
      stage?.releasePointerCapture(
        event.pointerId
      );
    } catch {
      /* Pointer capture may already be released. */
    }
  }

  private clearCanvas(): void {
  if (!this.isBrowser) return;
  const canvas = this.canvasRef?.nativeElement;

  if (!canvas) {
    return;
  }

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  // Release the backing store so the canvas does not retain unnecessary memory.
  canvas.width = 0;
  canvas.height = 0;
}

  /**
   * Stop panning.
   */
  onPointerUp(
    event: PointerEvent
  ): void {

    if (
      this.drawingInteraction &&
      this.drawingInteraction.pointerId ===
        event.pointerId
    ) {
      event.preventDefault();
      this.finishDrawingTool(event);
      return;
    }

    if (
      this.objectInteraction &&
      this.objectInteraction.pointerId ===
        event.pointerId
    ) {
      event.preventDefault();

      this.finishObjectInteraction(
        event
      );

      return;
    }

    if (
      !this.isPanning ||
      this.panPointerId !==
        event.pointerId
    ) {
      return;
    }

    const stage =
      this.stageRef?.nativeElement;

    this.isPanning = false;

    this.panPointerId = null;

    stage?.classList.remove(
      'studio-canvas__stage--panning'
    );

    try {
      stage?.releasePointerCapture(
        event.pointerId
      );

    } catch {
      /**
       * Pointer capture may already have been
       * released by the browser.
       */
    }
  }

  /**
   * ----------------------------------------------------------
   * KEYBOARD SHORTCUTS
   * ----------------------------------------------------------
   *
   * Global instead of viewport-only so the user
   * doesn't have to click the PDF first.
   */
@HostListener(
  'window:keydown',
  ['$event']
)
onWindowKeyDown(
  event: KeyboardEvent
): void {
  if (this.facade.exportBusy() || this.facade.exportResult()) return;

  /**
   * F7.2 Phase D — Escape must close an active comment editor even when
   * focus is on one of the dialog buttons instead of the textarea. The
   * textarea handles Escape locally, so this branch covers the remaining
   * dialog focus states before generic keyboard routing runs.
   */
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key === 'Escape' &&
    this.editingCommentId &&
    !this.isEditableTarget(event.target)
  ) {
    event.preventDefault();
    this.closeCommentEditor(false);
    this.facade.setActiveTool('select');
    return;
  }

  /**
   * IMPORTANT:
   *
   * Never hijack keyboard input from:
   * - input fields
   * - textareas
   * - contenteditable elements
   *
   * This must happen BEFORE tool shortcuts.
   */
  if (
    this.isEditableTarget(
      event.target
    )
  ) {
    return;
  }

  /**
   * Delete / Backspace removes the current Studio object.
   *
   * Editable fields are handled above, so this cannot
   * interfere with normal text entry.
   */
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (
      event.key === 'Delete' ||
      event.key === 'Backspace'
    )
  ) {

    if (this.facade.selectedObjectId()) {
      event.preventDefault();
      this.facade.deleteSelectedObject();
    }

    return;
  }

  /**
   * Escape always returns to Select.
   */
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'escape'
  ) {

    if (
      this.facade.hasDocument()
    ) {
      event.preventDefault();

      if (this.drawingInteraction) {
        this.cancelDrawingInteraction();
      }

      if (this.objectInteraction) {
        this.cancelObjectInteraction();
      }

      if (this.isPanning) {
        this.cancelPanning();
      }

      this.facade.clearSelection();
      this.facade.setActiveTool(
        'select'
      );
    }

    return;
  }

  /**
   * Duplicate selected Studio object.
   *
   * Ctrl/Cmd + Shift + D is used deliberately so Ctrl/Cmd + D
   * remains available for normal browser behavior.
   */
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === 'd'
  ) {

    if (
      this.facade.hasDocument() &&
      this.facade.selectedObjectId()
    ) {

      event.preventDefault();

      const selection =
        this.facade.duplicateSelectedObject();

      if (selection) {
        this.facade.selectObject(
          selection
        );
      }
    }

    return;
  }

  /**
   * Tool shortcuts.
   *
   * Only plain V/H/T/D are handled.
   * Ctrl/Cmd combinations remain available.
   */
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {

    switch (
      event.key.toLowerCase()
    ) {

      case 'v':

        if (
          this.facade.hasDocument()
        ) {
          event.preventDefault();

          this.facade.setActiveTool(
            'select'
          );
        }

        return;

      case 'h':

        if (
          this.facade.hasDocument()
        ) {
          event.preventDefault();

          this.facade.setActiveTool(
            'hand'
          );
        }

        return;

      case 't':

        if (
          this.facade.hasDocument()
        ) {
          event.preventDefault();

          this.facade.setActiveTool(
            'text'
          );
        }

        return;

      case 'd':

        if (
          this.facade.hasDocument()
        ) {
          event.preventDefault();

          this.facade.setActiveTool(
            'draw'
          );
        }

        return;
    }
  }

  /**
   * Space temporarily activates pan behavior.
   */
  if (
    event.code === 'Space'
  ) {

    if (
      !this.facade.hasDocument()
    ) {
      return;
    }

    this.spacePressed = true;

    event.preventDefault();

    return;
  }

  /**
   * No document = no remaining Studio shortcuts.
   */
  if (
    !this.facade.hasDocument()
  ) {
    return;
  }

  /**
   * Ctrl/Cmd zoom shortcuts.
   */
  if (
    !(
      event.ctrlKey ||
      event.metaKey
    ) ||
    event.altKey
  ) {
    return;
  }

  /**
   * Zoom in.
   */
  if (
    event.key === '+' ||
    event.key === '='
  ) {

    event.preventDefault();

    this.facade.setZoom(
      this.getNextZoomLevel(
        this.facade.zoom(),
        1
      )
    );

    return;
  }

  /**
   * Zoom out.
   */
  if (
    event.key === '-' ||
    event.key === '_'
  ) {

    event.preventDefault();

    this.facade.setZoom(
      this.getNextZoomLevel(
        this.facade.zoom(),
        -1
      )
    );

    return;
  }

  /**
   * Reset view to 100%.
   */
  if (
    event.key === '0'
  ) {

    event.preventDefault();

    this.facade.resetView();

    return;
  }
}

  /** 5C.2: Select a detected source image and open the replacement picker. */
  private async handlePdfImageEditPointerDown(event: PointerEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const documentId = this.facade.document()?.id;
    const pageNumber = this.facade.currentPage();
    await this.facade.ensureCurrentPageContent();
    if (documentId !== this.facade.document()?.id || pageNumber !== this.facade.currentPage() || this.facade.activeTool() !== 'edit-pdf-image') return;
    const page = this.pageRef?.nativeElement;
    if (!page) return;

    const rect = page.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const point = this.clientToPagePoint(
      event.clientX,
      event.clientY,
      rect
    );

    const object = this.selectObjectAtPoint(point.x, point.y);

    if (object?.type === 'image' && object.pdfImage) {
      this.requestImageReplacement(object.id);
    }

    event.preventDefault();
    event.stopPropagation();
  }

  /** 5B.2: Edit only detected source text with the dedicated tool. */
  private async handlePdfTextEditPointerDown(event: PointerEvent): Promise<void> {
    const page = this.pageRef?.nativeElement;
    if (!page) return;

    const rect = page.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    /*
     * Page navigation and PDF.js source analysis are asynchronous. The edit
     * tool must never depend on the user toggling the tool off/on to give
     * analysis time to finish. Ensure the currently visible page has its
     * source text objects before hit-testing this click.
     */
    event.preventDefault();
    event.stopPropagation();
    const documentId = this.facade.document()?.id;
    const pageNumber = this.facade.currentPage();
    await this.facade.ensureCurrentPageContent();
    if (documentId !== this.facade.document()?.id || pageNumber !== this.facade.currentPage() || this.facade.activeTool() !== 'edit-pdf-text') return;

    /*
     * The user may have navigated while the analysis promise was pending.
     * Re-read the live page element and coordinates after the await rather
     * than using stale geometry.
     */
    const currentPage = this.pageRef?.nativeElement;
    if (!currentPage) return;

    const currentRect = currentPage.getBoundingClientRect();
    if (currentRect.width <= 0 || currentRect.height <= 0) return;

    const point = this.clientToPagePoint(
      event.clientX,
      event.clientY,
      currentRect
    );

    const object = this.selectObjectAtPoint(point.x, point.y);

    if (object?.type === 'text' && object.pdfText) {
      void this.beginTextEditing(object.id);
    } else if (object?.type === 'image' && object.pdfImage) {
      this.requestImageReplacement(object.id);
    }

    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Give the native textarea enough vertical room for the source line box.
   * PDF glyph height and CSS line-height are not the same thing; a textarea
   * locked to the glyph bounding box clips Calibri descenders and makes the
   * edited line look visibly cut off. The height is allowed to extend outside
   * the source glyph rectangle because the source cover remains anchored to the
   * original PDF run bounds.
   */
  /**
   * Public template-facing editor height calculator.
   *
   * Keep this as an initialized class field so Angular template type-checking
   * sees the member directly on the component instance during incremental
   * compilation. This avoids the false `Property ... does not exist on type
   * StudioCanvas` diagnostic that can occur after adding a late method to this
   * large component.
   */
  readonly getPdfTextEditorHeightPx = (object: StudioObject): number => {
    const page = this.pageRef?.nativeElement;
    const pageHeight = page?.getBoundingClientRect().height ?? 0;
    const source = object.pdfText;

    if (!source || pageHeight <= 0) {
      return Math.max(18, pageHeight * Math.max(object.bounds.height, 0.01));
    }

    const fontSizePx = this.getObjectFontSizePx(object);
    const lineHeightRatio = this.getPdfTextLineHeight(object);
    const sourceLineHeightPx = Math.max(
      fontSizePx,
      fontSizePx * lineHeightRatio,
    );
    const sourceBoxHeightPx = Math.max(
      1,
      object.bounds.height * pageHeight,
    );

    /*
     * The PDF source rectangle is intentionally tight. Give the native
     * textarea a small amount of vertical breathing room so the browser's
     * font ascent/descent and caret never get clipped at the bottom edge.
     * This does not change the persisted PDF/source bounds.
     */
    return Math.max(
      sourceBoxHeightPx + 4,
      sourceLineHeightPx + 4,
    );
  }

  /** Match source line spacing in the live editor and committed preview. */
  getPdfTextLineHeight(object: StudioObject): number {
    const source = object.pdfText;
    if (!source) return object.textStyle?.lineHeight ?? 1.2;

    if (
      typeof source.lineHeightPdf === 'number' && Number.isFinite(source.lineHeightPdf) && source.lineHeightPdf > 0 &&
      typeof source.fontSizePdf === 'number' && Number.isFinite(source.fontSizePdf) && source.fontSizePdf > 0
    ) {
      return Math.max(0.9, Math.min(2.4, source.lineHeightPdf / source.fontSizePdf));
    }

    if (typeof source.lineHeight === 'number' && source.lineHeight > 0) {
      const size = Math.max(0.0001, source.detectedFontSize ?? object.textStyle?.fontSize ?? 0.018);
      return Math.max(0.9, Math.min(2.4, source.lineHeight / size));
    }

    return object.textStyle?.lineHeight ?? 1.2;
  }

  /** Preview reconstruction layer used to cover the old PDF image before the new image is painted. */
  getPdfImagePreviewBackground(object: StudioObject): string | null {
    if (object.type !== 'image' || !object.pdfImage?.replaced) return null;
    if (object.pdfImage.backgroundMode === 'layered') return object.pdfImage.layeredReconstructionDataUrl ?? null;
    if (object.pdfImage.backgroundMode === 'pixel') return object.pdfImage.pixelReconstructionDataUrl ?? null;
    return null;
  }

  getPdfImagePreviewBackgroundColor(object: StudioObject): string {
    if (object.type !== 'image' || !object.pdfImage?.replaced) return 'transparent';
    return object.pdfImage.backgroundMode === 'white'
      ? '#ffffff'
      : (object.pdfImage.backgroundColor ?? '#ffffff');
  }

  getPdfImagePreviewFit(object: StudioObject): 'contain' | 'cover' | 'fill' {
    const mode = object.pdfImage?.fitMode ?? 'stretch';
    return mode === 'fit' ? 'contain' : mode === 'fill' ? 'cover' : 'fill';
  }

  getPdfTextTransform(object: StudioObject): string | null {
    if (!object.pdfText) return null;
    const rotation = object.pdfText.displayRotation ?? -(object.pdfText.rotation ?? 0);
    return Math.abs(rotation) > 0.1 ? `rotate(${rotation}deg)` : null;
  }

  private readonly overlaySizes = new Map<string, number>();
  private overlayMeasureCanvas?: HTMLCanvasElement;

  getPdfOverlayFontSizePx(object: StudioObject): number {
    const maximum = this.getObjectFontSizePx(object);
    if (!this.isBrowser || (this.committedPreview() && this.editingObjectId !== object.id) || object.pdfText?.fitMode !== 'auto') return maximum;
    const rect = this.pageRef?.nativeElement.getBoundingClientRect();
    if (!rect) return maximum;
    const width = rect.width * object.bounds.width;
    const height = rect.height * object.bounds.height;
    const family = this.getObjectFontFamilyCss(object);
    const weight = this.getObjectFontWeightCss(object);
    const style = textFontStyle(object);
    const lineHeight = this.getPdfTextLineHeight(object);
    const key = JSON.stringify([object.text, width, height, maximum, family, weight, style, lineHeight]);
    const cached = this.overlaySizes.get(key);
    if (cached !== undefined) return cached;
    this.overlayMeasureCanvas ??= document.createElement('canvas');
    const context = this.overlayMeasureCanvas.getContext('2d');
    if (!context) return maximum;
    const size = fitPreviewFontSize(object.text ?? '', width, height, maximum, lineHeight, (text, size) => {
      context.font = `${style} ${weight} ${size}px ${family}`;
      return context.measureText(text).width;
    });
    this.overlaySizes.set(key, size);
    if (this.overlaySizes.size > 128) this.overlaySizes.delete(this.overlaySizes.keys().next().value!);
    return size;
  }

  /**
   * Render only the changed portion of an existing PDF text line. Untouched
   * glyphs stay on the original PDF canvas, so source word spacing and glyph
   * placement are not reconstructed by browser HTML.
   */
  getPdfEditedSourceOverlaySegments(object: StudioObject): readonly {
    id: string;
    text: string;
    leftPercent: number;
    topPercent: number;
    widthPercent: number;
    heightPercent: number;
  }[] {
    const source = object.pdfText;
    if (!source?.edited) return [];

    return [{ id: `${object.id}-full`, text: object.text ?? '', leftPercent: 0,
      topPercent: 0, widthPercent: 100, heightPercent: 100 }];
  }

  private resolveSingleTextChangeForPreview(originalText: string, editedText: string): {
    originalStart: number;
    originalEnd: number;
    replacementText: string;
  } | null {
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

  private measurePdfSourceTextWidth(object: StudioObject, text: string): number {
    if (!text) return 0;
    const source = object.pdfText;
    const page = this.pageRef?.nativeElement;
    if (!source || !page) return 0;
    const fontSizePx = this.getObjectFontSizePx(object);
    if (!(fontSizePx > 0)) return 0;
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return 0;
      const weight = source.sourceFontWeight ?? 400;
      const style = source.sourceFontStyle ?? 'normal';
      context.font = `${style} ${weight} ${fontSizePx}px ${this.getObjectFontFamilyCss(object)}`;
      const measured = context.measureText(text).width;
      const scaleX = source.metricScaleX ?? 1;
      const pageHeight = page.getBoundingClientRect().height;
      const pdfScale = pageHeight > 0 && source.pageHeightPdf ? source.pageHeightPdf / pageHeight : 1;
      return Math.max(0, measured * pdfScale * scaleX);
    } catch {
      return 0;
    }
  }

  /** Apply only the stable source-font metric calibration to the glyph layer. */
  getPdfTextMetricTransform(object: StudioObject): string | null {
    if (!object.pdfText) return null;
    const scaleX = object.pdfText.metricScaleX ?? 1;
    if (!Number.isFinite(scaleX) || Math.abs(scaleX - 1) < 0.002) return null;
    return `scaleX(${scaleX})`;
  }

  /** Estimate the cover background and calibrate fallback glyph width against the source PDF. Source text colour comes from PDF graphics-state analysis. */
  private capturePdfTextAppearance(object: StudioObject): void {
    if (!object.pdfText || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const page = this.pageRef?.nativeElement;
    if (!canvas.width || !canvas.height || !page) return;
    const rect = page.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const element = Array.from(page.querySelectorAll<HTMLElement>('[data-object-id]'))
      .find(el => el.dataset['objectId'] === object.id);
    const visual = element?.getBoundingClientRect();
    const x = Math.max(0, Math.floor((visual ? visual.left - rect.left : object.bounds.x * rect.width) * sx));
    const y = Math.max(0, Math.floor((visual ? visual.top - rect.top : object.bounds.y * rect.height) * sy));
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil((visual?.width ?? object.bounds.width * rect.width) * sx)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil((visual?.height ?? object.bounds.height * rect.height) * sy)));
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const data = ctx.getImageData(x, y, w, h).data;
      const edge: number[][] = [];
      const edgeInset = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 8)));
      const stride = Math.max(1, Math.floor(Math.min(w, h) / 24));
      for (let yy = 0; yy < h; yy += stride) {
        for (let xx = 0; xx < w; xx += stride) {
          const i = (yy * w + xx) * 4;
          if (data[i + 3] <= 20) continue;
          const c = [data[i], data[i + 1], data[i + 2]];
          const brightness = (c[0] + c[1] + c[2]) / 3;
          const onBorder = xx < edgeInset || yy < edgeInset || xx >= w - edgeInset || yy >= h - edgeInset;
          if (onBorder && brightness > 32) edge.push(c);
        }
      }
      const robust = (list: number[][], fallback: string) => {
        if (!list.length) return fallback;
        const rgb = [0, 1, 2].map(channel => {
          const values = list.map(c => c[channel]).sort((a, b) => a - b);
          return values[Math.floor(values.length / 2)];
        });
        return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
      };
      const metricScaleX = this.calibratePdfTextMetricScaleX(object, rect.width);
      this.objectService.updatePdfTextAppearance(object.id, {
        // Sampling only the source box perimeter prevents old glyph pixels from
        // contaminating the cover colour used to hide the original PDF text.
        backgroundColor: robust(edge, object.pdfText.backgroundColor ?? '#ffffff'),
        metricScaleX
      });
    } catch {
      // Sampling is best-effort; export falls back to persisted defaults.
    }
  }

  /**
   * Calibrate the browser font against the original PDF glyph width once, using
   * the unedited source string. This corrects PDF.js fallback-family metric
   * differences without shrinking each edited replacement independently.
   */
  private calibratePdfTextMetricScaleX(
    object: StudioObject,
    pageWidth: number
  ): number {
    if (!object.pdfText || !object.text) return 1;
    const sourceWidth = object.pdfText.textWidthPdf;
    const targetWidth =
      typeof sourceWidth === 'number' && Number.isFinite(sourceWidth) && sourceWidth > 0
        ? sourceWidth * (pageWidth / Math.max(1, object.pdfText.pageWidthPdf ?? pageWidth))
        : object.bounds.width * pageWidth;
    const fontSize = this.getObjectFontSizePx(object);
    if (!(targetWidth > 0) || !(fontSize > 0)) return 1;
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return 1;
      const weight = object.pdfText.sourceFontWeight ?? object.textStyle?.fontWeight ?? 400;
      const style = object.pdfText.sourceFontStyle ?? object.textStyle?.fontStyle ?? 'normal';
      context.font = `${style} ${weight} ${fontSize}px ${this.getObjectFontFamilyCss(object)}`;
      const measured = context.measureText(object.pdfText.originalText).width;
      if (!(measured > 0)) return 1;
      const scale = targetWidth / measured;
      // Guard against corrupt extraction geometry while allowing meaningful PDF
      // metric correction for embedded/substituted fonts.
      return Math.max(0.5, Math.min(2, scale));
    } catch {
      return 1;
    }
  }

  /** Grow multi-line existing text to avoid clipping the replacement on export. */
  private autoGrowExistingTextBox(objectId: string): void {
    const object = this.objectService.get(objectId);
    const editor = this.textEditorRef?.nativeElement;
    const page = this.pageRef?.nativeElement;
    if (!object?.pdfText || !editor || !page) return;
    // Source-locked replacement keeps original geometry. Only explicit auto-fit
    // may expand the source box for a multi-line replacement.
    if (object.pdfText.fitMode !== 'auto') return;
    const pageHeight = page.getBoundingClientRect().height;
    if (pageHeight <= 0) return;
    const required = Math.max(object.bounds.height, (editor.scrollHeight + 4) / pageHeight);
    if (required <= object.bounds.height + 0.001) return;
    this.facade.updateObjectBounds(object.id, {
      ...object.bounds,
      height: Math.min(required, 1 - object.bounds.y)
    });
  }

  /**
   * ----------------------------------------------------------
   * DOUBLE-CLICK ZOOM
   * ----------------------------------------------------------
   */
  onDoubleClick(
    event: MouseEvent
  ): void {

    if (
      !this.facade.hasDocument()
    ) {
      return;
    }

    const target =
      event.target as HTMLElement | null;

    const editorElement =
      target?.closest(
        '.studio-editor-object'
      );

    if (
      editorElement
    ) {

      const objectId =
        editorElement.getAttribute(
          'data-object-id'
        );

      if (
        objectId
      ) {

        const object =
          this.objectService.get(
            objectId
          );

        if (
          object?.type === 'text'
        ) {

          event.preventDefault();

          if (
            this.editingObjectId !==
            objectId
          ) {
            this.beginTextEditing(
              objectId
            );
          }

          return;
        }

        if (
          object?.type === 'image'
        ) {

          event.preventDefault();

          this.requestImageReplacement(
            objectId
          );

          return;
        }
      }

      event.preventDefault();
      return;
    }

    if (
      target?.closest(
        '.studio-selection-box'
      )
    ) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    const currentZoom =
      this.facade.zoom();

    const nextZoom =
      currentZoom < 150
        ? 150
        : 100;

    this.captureZoomAnchorFromMouse(
      event
    );

    this.facade.setZoom(
      nextZoom
    );
  }

  /**
   * Mouse-event equivalent of the wheel
   * zoom-anchor calculation.
   */
  private captureZoomAnchorFromMouse(
    event: MouseEvent
  ): void {

    const page =
      this.pageRef?.nativeElement;

    if (!page) {
      this.zoomAnchor = null;
      return;
    }

    const pageRect =
      page.getBoundingClientRect();

    if (
      pageRect.width <= 0 ||
      pageRect.height <= 0
    ) {
      this.zoomAnchor = null;
      return;
    }

    this.zoomAnchor = {

      clientX:
        event.clientX,

      clientY:
        event.clientY,

      relativeX:
        Math.min(
          1,
          Math.max(
            0,
            (
              event.clientX -
              pageRect.left
            ) /
            pageRect.width
          )
        ),

      relativeY:
        Math.min(
          1,
          Math.max(
            0,
            (
              event.clientY -
              pageRect.top
            ) /
            pageRect.height
          )
        )
    };
  }

  /**
   * ----------------------------------------------------------
   * SPACE KEY RELEASE
   * ----------------------------------------------------------
   */
  @HostListener(
    'window:keyup',
    ['$event']
  )
  onGlobalKeyUp(
    event: KeyboardEvent
  ): void {

    if (
      event.code === 'Space'
    ) {
      this.spacePressed = false;
    }
  }

  /**
   * Clear modifier/pan state if the browser
   * window loses focus.
   */
  @HostListener(
    'window:blur'
  )
  onWindowBlur(): void {

    this.syncTextEditorValue();
    this.commitTextEdit();

    this.spacePressed = false;

    this.finishObjectInteraction();

    if (!this.isPanning) {
      return;
    }

    this.isPanning = false;

    this.panPointerId = null;

    this.stageRef?.nativeElement.classList.remove(
      'studio-canvas__stage--panning'
    );
  }

  /**
   * Don't hijack shortcuts while the user is typing.
   */
  private isEditableTarget(
    target: EventTarget | null
  ): boolean {

    const element =
      target as HTMLElement | null;

    if (!element) {
      return false;
    }

    return (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable
    );
  }

  /**
   * ----------------------------------------------------------
   * RENDER FRAME CLEANUP
   * ----------------------------------------------------------
   */
  private cancelScheduledRender(): void {

    if (
      this.resizeFrame === null ||
      typeof window ===
        'undefined' ||
      typeof window.cancelAnimationFrame !==
        'function'
    ) {
      this.resizeFrame = null;
      return;
    }

    window.cancelAnimationFrame(
      this.resizeFrame
    );

    this.resizeFrame = null;
  }

  watermarkRequest() {
    return this.watermark.isOpen()
      ? this.watermark.draft()
      : this.watermark.committed();
  }

  isWatermarkVisibleOnCurrentPage(): boolean {
    const request = this.watermarkRequest();
    if (!request || !this.facade.hasDocument()) return false;
    try {
      return resolveWatermarkPageSelection(request.pageSelection, this.facade.pageCount()).includes(this.facade.currentPage());
    } catch {
      return false;
    }
  }

  watermarkPageWidth(): number {
    return this.pageRef?.nativeElement.clientWidth ?? 0;
  }

  watermarkPageHeight(): number {
    return this.pageRef?.nativeElement.clientHeight ?? 0;
  }

  watermarkFontFamily(): string {
    const request = this.watermarkRequest();
    switch (request?.font) {
      case 'Times-Roman': return 'Times New Roman, Times, serif';
      case 'Courier': return 'Courier New, Courier, monospace';
      default: return 'Helvetica, Arial, sans-serif';
    }
  }

  watermarkFontSizePx(): number {
    const request = this.watermarkRequest();
    const base = Math.max(1, (request?.fontSize ?? 42) * this.facade.renderScale());
    if (!request?.tiled || request.kind !== 'text') return base;
    const metrics = this.watermarkTextMetrics();
    if (!metrics) return base;
    return base * watermarkTiledScale(
      this.watermarkPageWidth(),
      this.watermarkPageHeight(),
      metrics.width * this.facade.renderScale(),
      metrics.height * this.facade.renderScale(),
      request.rotation,
    );
  }

  watermarkTextWidthPx(): number {
    const request = this.watermarkRequest();
    const metrics = this.watermarkTextMetrics();
    if (!request?.text) return 0;
    if (metrics && metrics.text === request.text && metrics.font === request.font && metrics.fontSize === request.fontSize) {
      return metrics.width * this.facade.renderScale();
    }
    return this.watermarkFontSizePx() * request.text.length * 0.55;
  }

  watermarkTextHeightPx(): number {
    const request = this.watermarkRequest();
    const metrics = this.watermarkTextMetrics();
    if (request && metrics && metrics.text === (request.text || 'WATERMARK') && metrics.font === request.font && metrics.fontSize === request.fontSize) {
      return metrics.height * this.facade.renderScale();
    }
    return this.watermarkFontSizePx() * 1.16;
  }

  watermarkTextBaselineOffsetPx(): number {
    const request = this.watermarkRequest();
    const metrics = this.watermarkTextMetrics();
    if (!request || !metrics) return 0;
    const repeatScale = request.tiled
      ? watermarkTiledScale(this.watermarkPageWidth(), this.watermarkPageHeight(), metrics.width * this.facade.renderScale(), metrics.height * this.facade.renderScale(), request.rotation)
      : 1;
    return ((metrics.ascenderHeight - metrics.descenderHeight) / 2) * this.facade.renderScale() * repeatScale;
  }

  watermarkCenters(): readonly { x: number; y: number }[] {
    const request = this.watermarkRequest();
    const width = this.watermarkPageWidth();
    const height = this.watermarkPageHeight();
    if (!request || width <= 0 || height <= 0) return [];

    // Studio's SVG preview is top-origin. Resolve single-position anchors
    // directly in display coordinates. Do not route them through PDF-space and
    // invert Y again at the SVG boundary. Repeat geometry remains shared PDF
    // geometry and is converted exactly once below.
    if (request.kind === 'text') {
      const watermarkWidth = this.watermarkTextWidthPx();
      const watermarkHeight = this.watermarkTextHeightPx();
      if (!request.tiled) {
        return [watermarkDisplayPositionCenter(
          request.position, width, height, watermarkWidth, watermarkHeight, request.rotation,
        )];
      }

      const repeatScale = watermarkTiledScale(width, height, watermarkWidth, watermarkHeight, request.rotation);
      return watermarkTiledCenters(
        width, height, watermarkWidth * repeatScale, watermarkHeight * repeatScale, 'text', 1, request.rotation,
      ).map(point => ({ x: point.x, y: height - point.y }));
    }

    const aspect = Math.max(0.01, this.watermarkImageAspectRatio());
    const imageWidth = Math.min(width * (request.imageScalePercent / 100), width * 0.8);
    const imageHeight = Math.max(1, imageWidth / aspect);
    if (!request.tiled) {
      return [watermarkDisplayPositionCenter(
        request.position,
        width,
        height,
        imageWidth,
        imageHeight,
        request.rotation,
      )];
    }

    const repeatScale = watermarkTiledScale(width, height, imageWidth, imageHeight, request.rotation);
    return watermarkTiledCenters(
      width, height, imageWidth * repeatScale, imageHeight * repeatScale, 'image', 1, request.rotation,
    ).map(point => ({ x: point.x, y: height - point.y }));
  }

  watermarkImageWidthPx(): number {
    const request = this.watermarkRequest();
    const baseWidth = Math.min(this.watermarkPageWidth() * ((request?.imageScalePercent ?? 28) / 100), this.watermarkPageWidth() * 0.8);
    if (!request?.tiled) return baseWidth;
    const baseHeight = Math.max(1, baseWidth / Math.max(0.01, this.watermarkImageAspectRatio()));
    return baseWidth * watermarkTiledScale(this.watermarkPageWidth(), this.watermarkPageHeight(), baseWidth, baseHeight, request.rotation);
  }

  watermarkImageHeightPx(): number {
    return Math.max(1, this.watermarkImageWidthPx() / Math.max(0.01, this.watermarkImageAspectRatio()));
  }

  watermarkTransform(center: { x: number; y: number }): string {
    const request = this.watermarkRequest();
    return `rotate(${request?.rotation ?? 0} ${center.x} ${center.y})`;
  }

  watermarkSvgViewBox(): string {
    return `0 0 ${this.watermarkPageWidth()} ${this.watermarkPageHeight()}`;
  }

  watermarkOpacity(): number {
    return this.watermarkRequest()?.opacity ?? 0;
  }

  watermarkColor(): string {
    return this.watermarkRequest()?.color ?? '#17324d';
  }

  private revokeWatermarkImagePreview(): void {
    const url = this.watermarkImageUrl();
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    this.watermarkImageUrl.set('');
    this.watermarkImageAspectRatio.set(1);
    this.watermarkImageFile = null;
  }

/**
 * ----------------------------------------------------------
 * DESTROY
 * ----------------------------------------------------------
 */
ngOnDestroy(): void {
  this.facade.flushTextDraft = null;
  ++this.previewGeneration;
  clearTimeout(this.previewTimer);
  this.committedPreview.set(null);
  this.previewPages.clear();
  this.previewSources.clear();
  this.overlaySizes.clear();
  this.overlayMeasureCanvas = undefined;
  this.revokeWatermarkImagePreview();

  /**
   * Mark destruction first so any asynchronous render completion
   * immediately becomes non-authoritative.
   */
  this.destroyed = true;
  if (this.editorLayoutFrame) cancelAnimationFrame(this.editorLayoutFrame);

  /**
   * Invalidate every pending and active component-level render.
   */
  this.renderVersion++;

  this.activeRenderVersion = null;

  this.viewReady = false;

  /**
   * Cancel a pending requestAnimationFrame render.
   */
  this.cancelScheduledRender();

  /**
   * Stop future resize notifications.
   */
  this.resizeObserver?.disconnect();
  this.resizeObserver = undefined;

  this.observedViewportWidth = -1;
  this.observedViewportHeight = -1;

  /**
   * Clear interaction state.
   */
  this.isPanning = false;
  this.panPointerId = null;

  this.spacePressed = false;

  this.objectInteraction = null;
  this.drawingInteraction = null;
  this.paletteDrag = null;

  this.pendingImagePlacement = null;
  this.pendingImageReplacementId = null;

  this.editingObjectId = null;
  this.editingSession.set(null);
  this.editingText = '';
  this.editingOriginalText = '';
  this.editingOriginalStyle = null;
  this.editingFontSizeInput = '14';

  this.zoomAnchor = null;

  this.stageRef?.nativeElement.classList.remove(
    'studio-canvas__stage--panning'
  );

  /**
   * F6.4.6 — Release the canvas through the same ownership boundary used for
   * document replacement and close. Local pixel clearing alone is insufficient
   * because the shared renderer may still own an asynchronous PDF.js task.
   */
  try {

    const canvas =
      this.canvasRef?.nativeElement;

    if (canvas && this.isBrowser) {
      this.facade.releaseMainCanvas(
        canvas
      );
    }

  } catch (error: unknown) {

    console.warn(
      '[SafePDFHub Studio] Canvas release skipped:',
      error
    );
  }
}

}
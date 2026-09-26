import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';

import { StudioCanvas } from '../../canvas/studio-canvas/studio-canvas';
import { StudioFacade } from '../../facade/studio.facade';
import { StudioPageThumbnail } from '../../left-sidebar/studio-page-thumbnail/studio-page-thumbnail';
import { StudioRightSidebar } from '../../right-sidebar/studio-right-sidebar/studio-right-sidebar';
import { StudioWatermarkStateService } from '../../state/studio-watermark-state.service';
import type { StudioSidebarPageView } from '../../models/studio-sidebar.model';

@Component({
  selector: 'app-studio-workspace',
  standalone: true,
  imports: [
    StudioCanvas,
    StudioPageThumbnail,
    StudioRightSidebar
  ],
  templateUrl:
    './studio-workspace.html',
  styleUrl:
    './studio-workspace.scss',
  changeDetection:
    ChangeDetectionStrategy.OnPush
})
export class StudioWorkspace
  implements AfterViewInit {

  readonly facade = inject(StudioFacade);
  readonly watermark = inject(StudioWatermarkStateService);

  @ViewChild('pagesList')
private readonly pagesList!:
  ElementRef<HTMLElement>;

  /**
   * Wrapper element around every page thumbnail.
   *
   * Angular assigns these elements after the view
   * has been created.
   */
  @ViewChildren('pageItem', {
    read: ElementRef
  })
  private readonly pageItems!:
    QueryList<ElementRef<HTMLElement>>;

  /**
   * True after Angular has created the view.
   */
  private viewReady = false;

  /**
   * Pending browser-frame used to synchronize
   * the active page thumbnail with currentPage.
   */
  private scrollFrame:
    number | null = null;

  /**
   * The PDF document's page count is authoritative.
   *
   * Facade pageCount is retained as a defensive
   * fallback.
   */
  readonly pageCount = this.facade.pageCount;

  readonly pages = this.facade.pages;

  /**
   * Single source of truth for the active page.
   */
  readonly currentPage =
    this.facade.currentPage;

  /** F7.2 — Sidebar can switch between page navigation and review comments. */
  readonly sidebarTab = signal<'pages' | 'comments'>('pages');
  readonly comments = this.facade.comments;

  /** Responsive Studio navigation state. These signals are presentation-only. */
  readonly mobilePagesOpen = signal(false);
  readonly mobileInspectorOpen = signal(false);

  /**
   * F7.3 — User-selected visual density for the Pages sidebar.
   *
   * This state is intentionally local to the workspace because it changes
   * presentation only and must not enter the document/history lifecycle.
   */
  readonly sidebarPageView =
    signal<StudioSidebarPageView>('comfortable');

  /** F7.3 — Page selection is UI state keyed by stable logical page IDs. */
  private readonly selectedPageIds = signal<ReadonlySet<string>>(new Set());
  private readonly selectionAnchorPageId = signal<string | null>(null);

  /**
   * Explicit selection mode makes multi-page selection discoverable without
   * requiring Ctrl/Cmd or Shift knowledge. Keyboard shortcuts remain supported
   * outside this mode for power users.
   */
  readonly pageSelectionMode = signal(false);

  /** Lightweight discoverability hint can be dismissed without affecting selection. */
  readonly selectionHintDismissed = signal(false);

  /** Contextual actions are expanded by default and may be collapsed by the user. */
  readonly pageActionsCollapsed = signal(false);

  dismissSelectionHint(): void {
    this.selectionHintDismissed.set(true);
  }

  togglePageActionsCollapsed(): void {
    this.pageActionsCollapsed.update(collapsed => !collapsed);
  }

  /**
   * F7.3 — Organize Focus Mode temporarily promotes the Pages experience
   * from a narrow navigation sidebar into a full-workspace organizer.
   * It is presentation state only and must never enter document history.
   */
  readonly organizeFocusMode = signal(false);

  toggleOrganizeFocusMode(): void {
    this.organizeFocusMode.update(active => !active);
  }

  exitOrganizeFocusMode(): void {
    this.organizeFocusMode.set(false);
  }


  /** Open the Pages drawer on tablet/mobile without changing document state. */
  openMobilePages(): void {
    if (this.watermark.isOpen()) {
      this.watermark.close();
    }
    this.mobileInspectorOpen.set(false);
    this.mobilePagesOpen.set(true);
  }

  closeMobilePages(): void {
    this.mobilePagesOpen.set(false);
  }

  /** Open the contextual inspector on tablet/mobile. */
  openMobileInspector(): void {
    if (this.watermark.isOpen()) {
      return;
    }
    this.mobilePagesOpen.set(false);
    this.mobileInspectorOpen.set(true);
  }

  closeMobileInspector(): void {
    this.mobileInspectorOpen.set(false);
  }

  closeResponsivePanels(): void {
    this.mobilePagesOpen.set(false);
    this.mobileInspectorOpen.set(false);
  }


  readonly selectedPageNumbers = computed(() => {
    const selected = this.selectedPageIds();

    return this.pages()
      .map((page, index) => selected.has(page.id) ? index + 1 : null)
      .filter((page): page is number => page !== null);
  });

  readonly selectedPageCount = computed(
    () => this.selectedPageNumbers().length
  );

  readonly hasMultiPageSelection = computed(
    () => this.selectedPageCount() > 1
  );

  readonly hasPageSelection = computed(
    () => this.selectedPageCount() > 0
  );

  constructor() {

    /** Keep transient selection valid when logical pages are mutated or restored. */
    effect(() => {
      const pages = this.pages();
      const existingIds = new Set(pages.map(page => page.id));
      const selected = this.selectedPageIds();
      const anchor = this.selectionAnchorPageId();

      const next = new Set(
        Array.from(selected).filter(id => existingIds.has(id))
      );

      if (next.size !== selected.size) {
        this.selectedPageIds.set(next);
      }

      if (anchor && !existingIds.has(anchor)) {
        this.selectionAnchorPageId.set(null);
      }
    });

    /**
     * Synchronize the Pages sidebar whenever
     * currentPage changes from ANY navigation source:
     *
     * - thumbnail click
     * - Status Bar page jump
     * - Previous
     * - Next
     * - keyboard
     * - future navigation controls
     */
    effect(() => {
      if (this.watermark.isOpen()) {
        this.mobileInspectorOpen.set(false);
        this.mobilePagesOpen.set(false);
      }
    });

    effect(() => {

      const page =
        this.currentPage();

      /**
       * Page-management operations can mutate the logical page
       * collection while the numeric currentPage remains unchanged
       * (for example rotate or deleting the current position).
       * Track the collection as a render/synchronization dependency.
       */
      const logicalPages =
        this.pages();

      if (!this.viewReady) {
        return;
      }

      void page;
      void logicalPages;

      this.scheduleActivePageScroll();
    });
  }

  // ==========================================================
  // VIEW INIT
  // ==========================================================

  ngAfterViewInit(): void {

    this.viewReady = true;

    /**
     * Initial synchronization.
     */
    this.pageItems.changes.subscribe(() => {
      this.scheduleActivePageScroll();
    });

    this.scheduleActivePageScroll();
  }

  // ==========================================================
  // PAGE SELECTION
  // ==========================================================

  /**
   * Select a page from the Pages sidebar.
   *
   * All page navigation goes through the Facade so
   * the canvas, status bar and sidebar share one state.
   */
  setSidebarTab(tab: 'pages' | 'comments'): void {
    this.sidebarTab.set(tab);
  }

  selectComment(objectId: string): void {
    const comment = this.facade.comments().find(item => item.id === objectId);
    if (!comment) { return; }
    this.facade.goToPage(comment.pageNumber);
    this.facade.selectObject({
      objectId: comment.id,
      pageNumber: comment.pageNumber,
      bounds: comment.bounds,
      type: comment.type
    });
    this.facade.setActiveTool('comment');
  }

  /**
   * Change the visual density of the Pages sidebar.
   *
   * No page data, selection or history state is mutated. After Angular lays
   * out the new view, re-run active-page synchronization so the current page
   * remains visible in Comfortable, Compact and Grid modes.
   */
  setSidebarPageView(
    view: StudioSidebarPageView
  ): void {

    if (
      this.sidebarPageView() === view
    ) {
      return;
    }

    this.sidebarPageView.set(view);

    this.scheduleActivePageScroll();
  }


  selectPage(
    pageNumber: number
  ): void {

    const total = this.pageCount();

    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
      return;
    }

    this.facade.goToPage(pageNumber);
  }

  /**
   * File-manager style selection semantics:
   * - normal click: navigate
   * - Ctrl/Cmd click: toggle page
   * - Shift click: contiguous range from the selection anchor
   * - Selection Mode: normal click toggles pages without requiring modifiers
   */
  onPageThumbnailSelected(
    event: { pageNumber: number; originalEvent: MouseEvent }
  ): void {
    const { pageNumber, originalEvent } = event;
    const page = this.pages()[pageNumber - 1];

    if (!page) {
      return;
    }

    const additive = originalEvent.ctrlKey || originalEvent.metaKey;
    const range = originalEvent.shiftKey;
    const selectionMode = this.pageSelectionMode();

    if (range) {
      this.selectPageRange(pageNumber, additive);
      return;
    }

    if (selectionMode || additive) {
      this.togglePageSelection(page.id);
      return;
    }

    /* Plain navigation establishes a range anchor and clears bulk selection. */
    this.clearPageSelection();
    this.selectionAnchorPageId.set(page.id);
    this.selectPage(pageNumber);
  }

  togglePageSelectionMode(): void {
    const next = !this.pageSelectionMode();
    this.pageSelectionMode.set(next);

    if (next && !this.selectionAnchorPageId()) {
      const current = this.pages()[this.currentPage() - 1];
      this.selectionAnchorPageId.set(current?.id ?? null);
    }
  }


  private togglePageSelection(pageId: string): void {
    const next = new Set(this.selectedPageIds());

    if (next.has(pageId)) {
      next.delete(pageId);
    } else {
      next.add(pageId);
      this.selectionAnchorPageId.set(pageId);
    }

    this.selectedPageIds.set(next);
  }

  private selectPageRange(
    pageNumber: number,
    additive: boolean
  ): void {
    const page = this.pages()[pageNumber - 1];
    if (!page) {
      return;
    }

    const anchorId = this.selectionAnchorPageId();
    const anchorIndex = anchorId
      ? this.pages().findIndex(item => item.id === anchorId)
      : -1;
    const start = anchorIndex >= 0 ? anchorIndex : pageNumber - 1;
    const end = pageNumber - 1;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const next = additive
      ? new Set(this.selectedPageIds())
      : new Set<string>();

    for (let index = from; index <= to; index++) {
      next.add(this.pages()[index].id);
    }

    this.selectedPageIds.set(next);

    if (!anchorId) {
      this.selectionAnchorPageId.set(page.id);
    }
  }

  isPageMultiSelected(pageId: string): boolean {
    return this.selectedPageIds().has(pageId);
  }

  clearPageSelection(): void {
    this.selectedPageIds.set(new Set());
    this.selectionAnchorPageId.set(null);
  }

  selectAllPages(): void {
    const pages = this.pages();
    this.selectedPageIds.set(new Set(pages.map(page => page.id)));
    this.selectionAnchorPageId.set(pages[0]?.id ?? null);
  }

  toggleSelectAllPages(): void {
    if (this.selectedPageCount() === this.pageCount()) {
      this.clearPageSelection();
      return;
    }
    this.selectAllPages();
  }

  duplicateSelectedPages(): void {
    const selected = this.selectedPageNumbers();
    if (!selected.length) return;
    this.facade.duplicatePages(selected);
    this.clearPageSelection();
  }

  rotateSelectedPages(direction: 'left' | 'right'): void {
    const selected = this.selectedPageNumbers();
    if (!selected.length) return;
    this.facade.rotatePages(selected, direction);
  }

  deleteSelectedPages(): void {
    const selected = this.selectedPageNumbers();
    if (!selected.length) return;
    this.facade.deletePages(selected);
    this.clearPageSelection();
  }

  /**
   * Move the selected pages one logical step while preserving their relative
   * order. Contiguous and non-contiguous selections both move as a group.
   */
  moveSelectedPages(
    direction: 'up' | 'down'
  ): void {
    const selected = this.selectedPageNumbers();
    if (!selected.length) return;

    const pages = this.pages();
    const selectedIds = new Set(
      selected
        .map(pageNumber => pages[pageNumber - 1]?.id)
        .filter((id): id is string => !!id)
    );

    this.facade.movePagesOneStep(selected, direction);
    this.selectedPageIds.set(new Set(selectedIds));
  }

  canMoveSelectedPages(direction: 'up' | 'down'): boolean {
    const selectedIds = this.selectedPageIds();
    const pages = this.pages();
    if (!selectedIds.size) return false;

    if (direction === 'up') {
      return pages.some((page, index) =>
        index > 0 && selectedIds.has(page.id) && !selectedIds.has(pages[index - 1].id)
      );
    }

    return pages.some((page, index) =>
      index < pages.length - 1 && selectedIds.has(page.id) && !selectedIds.has(pages[index + 1].id)
    );
  }

  /**
   * Drag state is captured at drag start so the exact logical group remains
   * stable for the complete native drag lifecycle.
   */
  draggedPage: number | null = null;

  draggedPageIds: readonly string[] = [];

  onPageDragStart(pageNumber: number, event: DragEvent): void {
    const pages = this.pages();
    const sourcePage = pages[pageNumber - 1];

    if (!sourcePage) {
      this.onPageDragEnd();
      return;
    }

    this.draggedPage = pageNumber;

    /**
     * If the drag begins on a selected page, snapshot the complete selection.
     * This makes selected-group dragging deterministic even if selection state
     * changes while the native drag operation is in progress.
     */
    this.draggedPageIds =
      this.isPageMultiSelected(sourcePage.id)
        ? pages
            .filter(page =>
              this.selectedPageIds().has(page.id)
            )
            .map(page => page.id)
        : [sourcePage.id];

    const payload = JSON.stringify({
      sourcePageId: sourcePage.id,
      movingPageIds: this.draggedPageIds
    });

    event.dataTransfer?.setData(
      'application/x-safepdfhub-pages',
      payload
    );

    event.dataTransfer?.setData(
      'text/plain',
      String(pageNumber)
    );

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onPageDrop(targetPage: number, event: DragEvent): void {
    event.preventDefault();

    let movingIds =
      this.draggedPageIds;

    if (movingIds.length === 0) {
      const payload =
        event.dataTransfer?.getData(
          'application/x-safepdfhub-pages'
        );

      if (payload) {
        try {
          const parsed =
            JSON.parse(payload) as {
              movingPageIds?: unknown;
            };

          if (
            Array.isArray(
              parsed.movingPageIds
            ) &&
            parsed.movingPageIds.every(
              value =>
                typeof value === 'string'
            )
          ) {
            movingIds =
              parsed.movingPageIds;
          }
        } catch {
          // Fall back to the legacy plain-text source position below.
        }
      }
    }

    if (movingIds.length === 0) {
      const source =
        this.draggedPage ??
        Number(
          event.dataTransfer?.getData(
            'text/plain'
          )
        );

      if (
        Number.isInteger(source) &&
        source >= 1
      ) {
        const sourcePage =
          this.pages()[source - 1];

        if (sourcePage) {
          movingIds =
            [sourcePage.id];
        }
      }
    }

    this.onPageDragEnd();

    if (movingIds.length === 0) {
      return;
    }

    /**
     * Resolve the captured stable IDs against the current page order at drop
     * time. This preserves selected-group ordering and avoids relying on stale
     * numeric positions.
     */
    const moving =
      this.pages()
        .map(
          (page, index) =>
            movingIds.includes(page.id)
              ? index + 1
              : 0
        )
        .filter(
          pageNumber =>
            pageNumber > 0
        );

    if (moving.length === 0) {
      return;
    }

    this.facade.movePages(
      moving,
      targetPage
    );
  }

  onPageDragEnd(): void {
    this.draggedPage = null;
    this.draggedPageIds = [];
  }

  duplicatePage(): void { this.facade.duplicateCurrentPage(); }
  deletePage(): void { this.facade.deleteCurrentPage(); }
  insertBlankBefore(): void { this.facade.insertBlankPage(false); }
  insertBlankAfter(): void { this.facade.insertBlankPage(true); }
  rotatePageLeft(): void { this.facade.rotateCurrentPage('left'); }
  rotatePageRight(): void { this.facade.rotateCurrentPage('right'); }

  // ==========================================================
  // ACTIVE PAGE SYNCHRONIZATION
  // ==========================================================

  /**
   * Schedule the sidebar scroll for the next browser frame.
   *
   * The browser-frame delay gives Angular time to update
   * the active thumbnail class before scrolling occurs.
   */
  private scheduleActivePageScroll(): void {

    /**
     * This component may also participate in SSR.
     * Do not access browser-only animation APIs there.
     */
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      return;
    }

    this.cancelActivePageScroll();

    this.scrollFrame =
      window.requestAnimationFrame(() => {

        this.scrollFrame = null;

        if (!this.viewReady) {
          return;
        }

        this.scrollActivePageIntoView();
      });
  }

  /**
   * Cancel a pending sidebar scroll.
   */
  private cancelActivePageScroll(): void {

    if (
      this.scrollFrame === null
    ) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(
        this.scrollFrame
      );
    }

    this.scrollFrame = null;
  }

  /**
   * Scroll the active page thumbnail into view.
   */
  private scrollActivePageIntoView(): void {

  if (!this.viewReady) {
    return;
  }

  const page =
    this.currentPage();

  const items =
    this.pageItems;

  const list =
    this.pagesList?.nativeElement;

  if (
    !list ||
    !items ||
    items.length === 0
  ) {
    return;
  }

  const index =
    page - 1;

  if (
    index < 0 ||
    index >= items.length
  ) {
    return;
  }

  const item =
    items
      .get(index)
      ?.nativeElement;

  if (!item) {
    return;
  }

  const listRect =
    list.getBoundingClientRect();

  const itemRect =
    item.getBoundingClientRect();

  /**
   * Convert the item's viewport position into
   * the Pages list's scroll coordinate system.
   *
   * This is the critical fix.
   */
  const targetTop =
    list.scrollTop +
    (itemRect.top - listRect.top);

  const targetBottom =
    targetTop +
    itemRect.height;

  const visibleTop =
    list.scrollTop;

  const visibleBottom =
    visibleTop +
    list.clientHeight;

  const safetyMargin = 12;

  /**
   * Already visible.
   */
  if (
    targetTop >=
      visibleTop + safetyMargin &&
    targetBottom <=
      visibleBottom - safetyMargin
  ) {
    return;
  }

  /**
   * Prefer placing the active thumbnail near
   * the vertical center of the sidebar.
   */
  const centeredTop =
    targetTop -
    Math.max(
      0,
      (
        list.clientHeight -
        itemRect.height
      ) / 2
    );

  const maxScrollTop =
    Math.max(
      0,
      list.scrollHeight -
      list.clientHeight
    );

  const nextScrollTop =
    Math.min(
      Math.max(
        0,
        centeredTop
      ),
      maxScrollTop
    );

  list.scrollTo({
    top: nextScrollTop,
    behavior: 'auto'
  });
}

}
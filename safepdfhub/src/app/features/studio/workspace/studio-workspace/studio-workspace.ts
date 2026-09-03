import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  QueryList,
  ViewChild,
  ViewChildren,
  effect,
  inject
} from '@angular/core';

import { StudioCanvas } from '../../canvas/studio-canvas/studio-canvas';
import { StudioFacade } from '../../facade/studio.facade';
import { StudioPageThumbnail } from '../../left-sidebar/studio-page-thumbnail/studio-page-thumbnail';

@Component({
  selector: 'app-studio-workspace',
  standalone: true,
  imports: [
    StudioCanvas,
    StudioPageThumbnail
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

  constructor() {

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
  selectPage(
    pageNumber: number
  ): void {

    const total =
      this.pageCount();

    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > total
    ) {
      return;
    }

    this.facade.goToPage(
      pageNumber
    );
  }

  draggedPage: number | null = null;

  onPageDragStart(pageNumber: number, event: DragEvent): void {
    this.draggedPage = pageNumber;
    event.dataTransfer?.setData('text/plain', String(pageNumber));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onPageDrop(targetPage: number, event: DragEvent): void {
    event.preventDefault();
    const source = this.draggedPage ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedPage = null;
    if (Number.isInteger(source) && source > 0) this.facade.movePage(source, targetPage);
  }

  onPageDragEnd(): void { this.draggedPage = null; }

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
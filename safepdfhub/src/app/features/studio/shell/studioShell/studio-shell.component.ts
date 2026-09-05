import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';

import { StudioHeader } from '../../header/studio-header/studio-header';
import { StudioToolbar } from '../../toolbar/studio-toolbar/studio-toolbar';
import { StudioStatusBar, StudioViewMode } from '../../status-bar/studio-status-bar/studio-status-bar';
import { StudioWorkspace } from '../../workspace/studio-workspace/studio-workspace';

import { StudioFacade } from '../../facade/studio.facade';
import type {
  StudioToolId
} from '../../models/studio-tool.model';

@Component({
  selector: 'app-studio-shell',
  standalone: true,
  imports: [
    StudioHeader,
    StudioToolbar,
    StudioStatusBar,
    StudioWorkspace
  ],
  templateUrl: './studio-shell.component.html',
  styleUrls: ['./studio-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioShellComponent {

  private readonly facade =
    inject(StudioFacade);

  @ViewChild('pdfInput')
  private pdfInput?: ElementRef<HTMLInputElement>;

  /**
   * State exposed to the Studio shell.
   */
  readonly projectName = this.facade.fileName;

  readonly pdfLoaded = this.facade.hasDocument;

  readonly browserProcessing = this.facade.isReady;

  readonly zoom = this.facade.zoom;

  readonly viewMode = this.facade.viewMode;

  readonly isLoading = this.facade.isLoading;

  readonly currentPage = this.facade.currentPage;

  readonly totalPages = this.facade.pageCount;

  readonly canPreviousPage = this.facade.canPreviousPage;

  readonly canNextPage = this.facade.canNextPage;

  readonly activeTool = this.facade.activeTool;

  /** F5 — Reactive history availability for the Studio header. */
  readonly canUndo = this.facade.canUndo;

  readonly canRedo = this.facade.canRedo;

  /**
   * Independent Studio chrome state.
   *
   * The header and toolbar are deliberately
   * controlled separately so collapsing one never
   * collapses the other.
   */
  readonly toolbarVisible =
    signal(true);

  readonly studioHeaderVisible =
    signal(true);

  /**
   * F7.1.2 — Extract Pages dialog state.
   *
   * The toolbar action opens this workflow instead of downloading immediately.
   * Selection parsing happens locally so the UI can show live validation and a
   * selected-page count before the export pipeline starts.
   */
  readonly extractDialogOpen =
    signal(false);

  readonly extractMode =
    signal<'current' | 'custom'>('current');

  readonly extractExpression =
    signal('');

  readonly extractValidationError =
    signal<string | null>(null);

  readonly extractPageNumbers =
    signal<readonly number[]>([]);

  readonly isExtractingPages =
    signal(false);

  /**
   * Extract dialog preview presentation.
   * This changes only how the selected pages are displayed in the dialog.
   */
  readonly extractPreviewMode =
    signal<'list' | 'thumbnails'>('list');

  /**
   * Large selections stay compact by default. The user can expand the
   * preview on demand without changing the extraction selection.
   */
  readonly extractPreviewExpanded =
    signal(false);

  readonly selectedExtractionPageCount =
    computed(() => {
      if (this.extractMode() === 'current') {
        return this.facade.hasDocument()
          ? 1
          : 0;
      }

      return this.extractPageNumbers().length;
    });

  readonly extractionPreview =
    computed(() => {
      if (this.extractMode() === 'current') {
        return this.facade.hasDocument()
          ? `Current page ${this.currentPage()}`
          : 'No document loaded';
      }

      const pages =
        this.extractPageNumbers();

      if (pages.length === 0) {
        return 'No pages selected';
      }

      return this.formatExtractionPages(pages);
    });


  // ==========================================================
  // F7.1.2 — MULTI-PAGE / RANGE EXTRACTION DIALOG
  // ==========================================================

  openExtractPagesDialog(): void {
    if (!this.facade.hasDocument()) {
      return;
    }

    this.extractMode.set('current');
    this.extractExpression.set('');
    this.extractValidationError.set(null);
    this.extractPageNumbers.set([]);
    this.extractPreviewMode.set('list');
    this.extractPreviewExpanded.set(false);
    this.extractDialogOpen.set(true);
  }

  closeExtractPagesDialog(): void {
    if (this.isExtractingPages()) {
      return;
    }

    this.extractDialogOpen.set(false);
  }

  selectExtractMode(
    mode: 'current' | 'custom'
  ): void {
    this.extractMode.set(mode);
    this.extractPreviewExpanded.set(false);

    if (mode === 'current') {
      this.extractValidationError.set(null);
      return;
    }

    this.validateExtractionExpression(
      this.extractExpression()
    );
  }

  onExtractionExpressionInput(
    event: Event
  ): void {
    const input =
      event.target as HTMLInputElement;

    const value =
      input.value;

    this.extractExpression.set(value);
    this.extractPreviewExpanded.set(false);

    this.validateExtractionExpression(
      value
    );
  }

  private validateExtractionExpression(
    value: string
  ): void {
    const result =
      this.parseExtractionExpression(
        value
      );

    if (!result.ok) {
      this.extractPageNumbers.set([]);
      this.extractValidationError.set(
        result.message
      );
      return;
    }

    this.extractPageNumbers.set(
      result.pageNumbers
    );
    this.extractValidationError.set(null);
  }

  private parseExtractionExpression(
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
          'Enter pages such as 1, 3, 5 or 1-3, 7-10, 15.'
      };
    }

    const totalPages =
      this.totalPages();

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
            'The page selection contains an empty entry.'
        };
      }

      const singleMatch =
        /^(\d+)$/.exec(token);

      if (singleMatch) {
        const page =
          Number(singleMatch[1]);

        if (
          !Number.isSafeInteger(page) ||
          page < 1 ||
          page > totalPages
        ) {
          return {
            ok: false,
            message:
              `Page numbers must be between 1 and ${totalPages}.`
          };
        }

        selected.add(page);
        continue;
      }

      const rangeMatch =
        /^(\d+)\s*-\s*(\d+)$/.exec(token);

      if (!rangeMatch) {
        return {
          ok: false,
          message:
            `Invalid entry "${token}". Use 1, 3, 5 or 1-3, 7-10, 15.`
        };
      }

      const start =
        Number(rangeMatch[1]);

      const end =
        Number(rangeMatch[2]);

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
        let page = start;
        page <= end;
        page++
      ) {
        selected.add(page);
      }
    }

    const pageNumbers =
      Array.from(selected).sort(
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

  setExtractPreviewMode(
    mode: 'list' | 'thumbnails'
  ): void {
    this.extractPreviewMode.set(mode);
    this.extractPreviewExpanded.set(false);
  }

  toggleExtractionPreview(): void {
    if (this.remainingExtractionPageCount() === 0 && !this.extractPreviewExpanded()) {
      return;
    }

    this.extractPreviewExpanded.update(expanded => !expanded);
  }

  readonly extractionPageList =
    computed(() => {
      if (this.extractMode() === 'current') {
        return this.facade.hasDocument()
          ? [this.currentPage()]
          : [];
      }

      return this.extractPageNumbers();
    });

  /**
   * Keep the dialog compact even when a very large range is selected.
   * The export still receives every selected page; only the preview is capped.
   */
  readonly extractionPreviewPages =
    computed(() =>
      this.extractPreviewExpanded()
        ? this.extractionPageList()
        : this.extractionPageList().slice(0, 12)
    );

  readonly remainingExtractionPageCount =
    computed(() => Math.max(
      0,
      this.extractionPageList().length -
        (this.extractPreviewExpanded()
          ? this.extractionPageList().length
          : 12)
    ));

  private formatExtractionPages(
    pages: readonly number[]
  ): string {
    const groups: string[] = [];

    let start =
      pages[0];

    let previous =
      pages[0];

    for (
      let index = 1;
      index < pages.length;
      index++
    ) {
      const current =
        pages[index];

      if (current === previous + 1) {
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

    return groups.join(', ');
  }

  async confirmExtractPages(): Promise<void> {
    if (
      !this.facade.hasDocument() ||
      this.isExtractingPages()
    ) {
      return;
    }

    const pageNumbers =
      this.extractMode() === 'current'
        ? [ this.currentPage() ]
        : this.extractPageNumbers();

    if (pageNumbers.length === 0) {
      this.extractValidationError.set(
        'Select at least one valid page before extracting.'
      );
      return;
    }

    this.isExtractingPages.set(true);

    try {
      await this.facade.extractPages(
        pageNumbers
      );

      this.extractDialogOpen.set(false);
    } finally {
      this.isExtractingPages.set(false);
    }
  }

  /**
   * Toggle only the Studio Header.
   */
  toggleStudioHeader(): void {
    this.studioHeaderVisible.update(
      visible => !visible
    );
  }

  /**
   * Toggle only the editing toolbar.
   */
  toggleToolbar(): void {
    this.toolbarVisible.update(
      visible => !visible
    );
  }

  /**
   * Open the native PDF picker.
   */
  openPdfPicker(): void {
    if (this.isLoading()) {
      return;
    }

    this.pdfInput?.nativeElement.click();
  }

  /**
   * Receive the selected PDF.
   */
  onPdfSelected(event: Event): void {
    const input =
      event.target as HTMLInputElement;

    const file =
      input.files?.[0];

    /*
     * Reset the input so selecting the same
     * file again still triggers change.
     */
    input.value = '';

    if (!file) {
      return;
    }

    void this.facade.loadPdf(file);
  }

  /**
   * Forward zoom changes to the facade.
   */
  onZoomChanged(zoom: number): void {
    this.facade.setZoom(zoom);
  }

@HostListener('window:keydown', ['$event'])
onKeyDown(event: KeyboardEvent): void {
  if (!this.facade.hasDocument()) {
    return;
  }

  if (this.extractDialogOpen()) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeExtractPagesDialog();
    }

    return;
  }

  const target = event.target as HTMLElement | null;

  if (
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable
  ) {
    return;
  }

  /**
   * F5 — Standard history shortcuts.
   *
   * Ctrl/Cmd+Z          Undo
   * Ctrl/Cmd+Shift+Z    Redo
   * Ctrl/Cmd+Y          Redo
   */
  const isHistoryModifier =
    event.ctrlKey ||
    event.metaKey;

  if (
    isHistoryModifier &&
    event.key.toLowerCase() === 'z'
  ) {
    event.preventDefault();

    if (event.shiftKey) {
      this.facade.redo();
    } else {
      this.facade.undo();
    }

    return;
  }

  if (
    isHistoryModifier &&
    event.key.toLowerCase() === 'y'
  ) {
    event.preventDefault();
    this.facade.redo();
    return;
  }

  switch (event.key) {
    case 'ArrowRight':
    case 'PageDown':
      event.preventDefault();
      this.facade.goToNextPage();
      break;

    case 'ArrowLeft':
    case 'PageUp':
      event.preventDefault();
      this.facade.goToPreviousPage();
      break;

    case 'Home':
      event.preventDefault();
      this.facade.goToFirstPage();
      break;

    case 'End':
      event.preventDefault();
      this.facade.goToLastPage();
      break;
  }
}

onUndo(): void {
  this.facade.undo();
}

onRedo(): void {
  this.facade.redo();
}

onPreviousPage(): void {
  this.facade.goToPreviousPage();
}

onNextPage(): void {
  this.facade.goToNextPage();
}

onPageRequested(page: number): void {
  this.facade.goToPage(page);
}

onViewModeChanged(mode: StudioViewMode): void {
  this.facade.setViewMode(mode);
}

onToolSelected(
  tool: StudioToolId
): void {

  switch (tool) {

    /**
     * Persistent interaction tools.
     */
    case 'select':
    case 'hand':
    case 'text':
    case 'image':
    case 'draw':
    case 'highlight':
    case 'shape':
    case 'comment':

      this.facade.setActiveTool(
        tool
      );

      return;

    /**
     * One-shot action tools.
     *
     * Their actual editing operations are
     * intentionally implemented in later tasks.
     */
    case 'extract':
      this.openExtractPagesDialog();
      return;

    case 'rotate':
    case 'delete':
    case 'link':
    case 'more':
      this.facade.runToolAction(
        tool
      );
      return;
  }
}

}

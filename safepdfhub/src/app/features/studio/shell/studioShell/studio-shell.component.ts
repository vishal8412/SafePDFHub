import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
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
    case 'rotate':
    case 'delete':
    case 'extract':
    case 'comment':
    case 'link':
    case 'more':

      this.facade.runToolAction(
        tool
      );

      return;
  }
}

}

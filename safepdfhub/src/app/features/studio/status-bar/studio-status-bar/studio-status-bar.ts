import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';

export type StudioProcessingState =
  | 'ready'
  | 'processing'
  | 'saving'
  | 'error';

export type StudioViewMode =
  | 'fit-width'
  | 'fit-page'
  | 'zoom';

@Component({
  selector: 'app-studio-status-bar',
  standalone: true,
  templateUrl: './studio-status-bar.html',
  styleUrl: './studio-status-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioStatusBar implements OnChanges {

  // ============================================================
  // Document
  // ============================================================

  @Input()
  currentPage = 1;

  @Input()
  totalPages = 1;

  // ============================================================
  // Zoom
  // ============================================================

  @Input()
  zoom = 100;

  @Input()
  minZoom = 50;

  @Input()
  maxZoom = 200;

  // ============================================================
  // State
  // ============================================================

  @Input()
  processingState: StudioProcessingState = 'ready';

  @Input()
  processingMessage = 'Browser Processing';

  @Input()
  viewMode: StudioViewMode = 'fit-page';

  // ============================================================
  // Capability
  // ============================================================

  @Input()
  canPreviousPage = true;

  @Input()
  canNextPage = true;

  // ============================================================
  // Events
  // ============================================================

  @Output()
  readonly previousPage =
    new EventEmitter<void>();

  @Output()
  readonly pageRequested =
    new EventEmitter<number>();

  @Output()
  readonly nextPage =
    new EventEmitter<void>();

  @Output()
  readonly zoomChanged =
    new EventEmitter<number>();

  @Output()
  readonly viewModeChanged =
    new EventEmitter<StudioViewMode>();

  @Output()
  readonly processingInfoRequested =
    new EventEmitter<void>();

  // ============================================================
  // Page input state
  // ============================================================

  pageInputValue = '1';

  pageJumpError = '';

  get pageDescription(): string {
    return `Page ${this.currentPage} of ${this.totalPages}`;
  }

get statusLabel(): string {
  switch (this.processingState) {
    case 'processing':
      return this.processingMessage || 'Processing';

    case 'saving':
      return this.processingMessage || 'Saving';

    case 'error':
      return this.processingMessage || 'Error';

    case 'ready':
    default:
      return 'Ready';
  }
}

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['currentPage'] ||
      changes['totalPages']
    ) {
      this.syncPageInput();
    }
  }

  private syncPageInput(): void {
    this.pageInputValue =
      String(this.currentPage);

    this.pageJumpError = '';
  }

  onPageInput(event: Event): void {
    const target =
      event.target as HTMLInputElement;

    this.pageInputValue =
      target.value;

    this.pageJumpError = '';
  }

  commitPageInput(event: Event): void {
    const target =
      event.target as HTMLInputElement;

    const rawValue =
      target.value.trim();

    if (!rawValue) {
      this.syncPageInput();
      return;
    }

    const page =
      Number(rawValue);

    if (!Number.isInteger(page)) {

      this.pageJumpError =
        'Enter a whole page number.';

      if (event.type === 'blur') {
        this.syncPageInput();
      } else {
        target.select();
      }

      return;
    }

    if (
      page < 1 ||
      page > this.totalPages
    ) {

      this.pageJumpError =
        `Enter a page from 1 to ${this.totalPages}.`;

      if (event.type === 'blur') {
        this.syncPageInput();
      } else {
        target.select();
      }

      return;
    }

    this.pageJumpError = '';
    this.pageInputValue =
      String(page);

    if (
      page !== this.currentPage
    ) {
      this.pageRequested.emit(page);
    }

    target.value =
      String(page);
  }

  cancelPageInput(event: Event): void {

  const target = event.target as HTMLInputElement;

  this.syncPageInput();

  target.value = this.pageInputValue;

  target.blur();
}

  // ============================================================
  // Page navigation
  // ============================================================

  goToPreviousPage(): void {
    if (!this.canPreviousPage) {
      return;
    }

    this.previousPage.emit();
  }

  goToNextPage(): void {
    if (!this.canNextPage) {
      return;
    }

    this.nextPage.emit();
  }

  // ============================================================
  // Zoom
  // ============================================================

  private readonly zoomSteps = [50, 75, 100, 125, 150, 175, 200];

zoomOut(): void {

  const currentIndex =
    this.zoomSteps.indexOf(
      this.zoom
    );

  const nextIndex =
    currentIndex > 0
      ? currentIndex - 1
      : 0;

  this.setZoom(
    this.zoomSteps[nextIndex]
  );
}

zoomIn(): void {

  const currentIndex =
    this.zoomSteps.indexOf(
      this.zoom
    );

  const nextIndex =
    currentIndex === -1
      ? 0
      : Math.min(
          currentIndex + 1,
          this.zoomSteps.length - 1
        );

  this.setZoom(
    this.zoomSteps[nextIndex]
  );
}

  onZoomSelect(event: Event): void {
    const target =
      event.target as HTMLSelectElement;

    const value =
      Number(target.value);

    if (!Number.isFinite(value)) {
      return;
    }

    this.setZoom(value);
  }

  private setZoom(
    value: number
  ): void {

    const clampedZoom =
      Math.min(
        this.maxZoom,
        Math.max(
          this.minZoom,
          value
        )
      );

    this.zoomChanged.emit(
      clampedZoom
    );
  }

  // ============================================================
  // View mode
  // ============================================================

  toggleViewMode(): void {

    const nextMode:
      StudioViewMode =
        this.viewMode === 'fit-page'
          ? 'fit-width'
          : 'fit-page';

    this.viewModeChanged.emit(
      nextMode
    );
  }

  // ============================================================
  // Processing info
  // ============================================================

  requestProcessingInfo(): void {
    this.processingInfoRequested.emit();
  }
}
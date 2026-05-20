import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  ViewChildren,
  QueryList,
  AfterViewInit
} from '@angular/core';

import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-merge-workspace',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './merge-workspace.component.html',
  styleUrls: ['./merge-workspace.component.scss']
})
export class MergeWorkspaceComponent implements AfterViewInit{

@ViewChild('scrollContainer') scrollContainer!: ElementRef;
@ViewChildren('previewCard') previewCards!: QueryList<ElementRef>;
  
private longPressTimer: any;
private dragStarted = false;
dragTranslateX = 0;
touchStartX = 0;
touchCurrentX = 0;
  
  // =====================
  // INPUTS
  // =====================

  @Input() files: File[] = [];

  @Input() previews: string[] = [];

  @Input() pageCounts: number[] = [];

  @Input() previewLoading: boolean[] = [];

  @Input() previewProgress: number[] = [];

  @Input() previewError: boolean[] = [];

  @Input() totalSize = '';

  @Input() activeIndex = -1;

  @Input() dragIndex: number | null = null;

  @Input() hoverIndex: number | null = null;

  @Input() isDragging = false;

  @Input() fileIds: string[] = [];

  // =====================
  // OUTPUTS
  // =====================

  @Output() merge = new EventEmitter<void>();

  @Output() clearAll = new EventEmitter<void>();

  @Output() removeFile = new EventEmitter<number>();

  @Output() preview = new EventEmitter<number>();

  @Output() retryPreview = new EventEmitter<number>();

  @Output() openActions = new EventEmitter<number>();

  @Output() dragStart = new EventEmitter<number>();

  @Output() dragOver = new EventEmitter<number>();

  @Output() dropReorder = new EventEmitter<{from: number; to: number;}>();

  @Output() dragReset = new EventEmitter<void>();

  @Output() visiblePreview = new EventEmitter<number>();

  private previousLength = 0;
  private observer?: IntersectionObserver;

  ngAfterViewInit() {
    this.setupLazyPreviewObserver();
    this.previewCards.changes.subscribe(() => {
      this.setupLazyPreviewObserver();
    });
 }

 setupLazyPreviewObserver() {
  this.observer?.disconnect();
  this.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index =
            Number(
              (entry.target as HTMLElement)
              .dataset['index']
            );

          this.visiblePreview.emit(index);
          this.observer?.unobserve(
            entry.target
          );
        }
      });
    },
    {
      root: this.scrollContainer?.nativeElement,
      threshold: 0.2
    }
  );

  this.previewCards.forEach(
    (card, index) => {
      const el = card.nativeElement;
      el.dataset['index'] = String(index);
      this.observer?.observe(el);
    }
  );
}

ngOnChanges() {

  const hasNewFiles =
    this.files.length >
    this.previousLength;

  if (
    hasNewFiles &&
    this.activeIndex >= 0
  ) {

    requestAnimationFrame(() => {

      this.scrollToIndex(
        this.activeIndex
      );

    });

  }

  this.previousLength =
    this.files.length;
}

  // =====================
  // UI ACTIONS
  // =====================

  onPreview(index: number) {
    this.preview.emit(index);
  }

  onRemove(index: number) {
    this.removeFile.emit(index);
  }

  onRetry(index: number) {
    this.retryPreview.emit(index);
  }

  onOpenActions(index: number) {
    this.openActions.emit(index);
  }

  onDragStart(index: number) {
    this.dragStart.emit(index);
  }

  onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    this.dragOver.emit(index);
  }

 onDrop(index: number) {

  if (this.dragIndex === null) return;

  this.dropReorder.emit({
    from: this.dragIndex,
    to: index
  });
}

  onResetDrag() {
    this.dragReset.emit();
  }

  startMerge() {
    this.merge.emit();
  }

  clearWorkspace() {
    this.clearAll.emit();
  }

  trackByFile(index: number) {
   return this.fileIds?.[index] ?? index;
  }

  scrollToIndex(index: number) {

  requestAnimationFrame(() => {

    if (!this.scrollContainer) return;

    const container =
      this.scrollContainer.nativeElement;

    const card =
      container.children[index] as HTMLElement;

    if (!card) return;

    const offset =
      card.offsetLeft
      - container.offsetWidth / 2
      + card.offsetWidth / 2;

    container.scrollTo({
      left: offset,
      behavior: 'smooth'
    });

  });

}
  
// =====================
// MOBILE DRAG
// =====================
onTouchStart(event: TouchEvent, index: number) {

  this.touchStartX = event.touches[0].clientX;

  this.longPressTimer = setTimeout(() => {

    this.dragIndex = index;
    this.isDragging = true;
    this.dragStarted = true;

    navigator.vibrate?.(10);

  }, 180);

}

onTouchMove(event: TouchEvent) {

  if (!this.dragStarted || this.dragIndex === null) return;

  event.preventDefault();
  event.stopPropagation();

  const touchX = event.touches[0].clientX;
  let diff = touchX - this.touchStartX;

const limit = 110;

if (Math.abs(diff) > limit) {

  const extra =
    Math.abs(diff) - limit;

  diff =
    Math.sign(diff) *
    (limit + extra * 0.25);
}

  this.dragTranslateX = diff;

  const container =
    this.scrollContainer.nativeElement;

  const cards =
    container.querySelectorAll('.file-card');

  const draggedCard =
    cards[this.dragIndex] as HTMLElement;

  if (draggedCard) {
    draggedCard.style.transform =
      `translate3d(${diff * 0.92}px,0,0) scale(1.04)`;
  }

  // detect hovered index
  cards.forEach((card: HTMLElement, i: number) => {

    if (i === this.dragIndex) return;

    const rect = card.getBoundingClientRect();

    if (
      touchX > rect.left &&
      touchX < rect.right
    ) {
      this.hoverIndex = i;
    }

  });

  // auto scroll
  const bounds = container.getBoundingClientRect();

  if (touchX > bounds.right - 60) {
    container.scrollLeft += 8;
  }

  if (touchX < bounds.left + 60) {
    container.scrollLeft -= 8;
  }
}

onTouchEnd() {

  clearTimeout(this.longPressTimer);

  if (
    this.dragStarted &&
    this.dragIndex !== null &&
    this.hoverIndex !== null &&
    this.dragIndex !== this.hoverIndex
  ) {

    this.dropReorder.emit({
      from: this.dragIndex,
      to: this.hoverIndex
    });
  }

  requestAnimationFrame(() => {

    const cards =
      document.querySelectorAll('.file-card');

    cards.forEach((c: any) => {
      c.style.transform = '';
    });

  });

  this.dragTranslateX = 0;
  this.dragStarted = false;

  this.resetDrag();
}

resetDrag() {
  this.dragIndex = null;
  this.isDragging = false;
  this.hoverIndex = null;
}

}
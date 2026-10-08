import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  OnDestroy,
  Output,
  inject,
} from '@angular/core';

@Directive({ selector: '[appDialogFocus], [studioDialogFocus]', standalone: true })
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  @Output() readonly dialogEscape = new EventEmitter<void>();
  private previous: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  ngAfterViewInit(): void {
    this.previous = document.activeElement as HTMLElement | null;
    this.timer = setTimeout(() => this.controls()[0]?.focus(), 0);
  }
  ngOnDestroy(): void {
    clearTimeout(this.timer);
    if (this.previous?.isConnected) this.previous.focus({ preventScroll: true });
  }
  private controls(): HTMLElement[] {
    return Array.from(
      this.element.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    ).filter((el) => el.getClientRects().length > 0);
  }
  @HostListener('keydown', ['$event']) onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dialogEscape.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = this.controls(),
      first = controls[0],
      last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

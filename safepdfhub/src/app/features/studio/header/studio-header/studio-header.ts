import { TOOLS } from '../../../../config/tools.config';
import { RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  HostListener,
  ElementRef,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-studio-header',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './studio-header.html',
  styleUrl: './studio-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioHeader {
  @Input() documentBarVisible = true;
  @Input() toolbarVisible = true;
  @Output() readonly documentBarToggle = new EventEmitter<void>();
  @Output() readonly toolbarToggle = new EventEmitter<void>();
  readonly toolsCatalog = [...TOOLS].sort((a, b) => a.displayOrder - b.displayOrder);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  closeMenus(): void {
    this.element.nativeElement
      .querySelectorAll('details[open]')
      .forEach((el) => el.removeAttribute('open'));
  }
  @HostListener('document:click', ['$event']) outside(event: MouseEvent): void {
    if (!this.element.nativeElement.contains(event.target as Node)) this.closeMenus();
  }
  @HostListener('keydown.escape', ['$event']) escape(event: Event): void {
    const open = this.element.nativeElement.querySelector<HTMLDetailsElement>('details[open]');
    this.closeMenus();
    open?.querySelector<HTMLElement>('summary')?.focus();
    event.stopPropagation();
  }

  // =========================================================
  // Document state
  // =========================================================

  @Input()
  projectName = '';

  @Input()
  browserProcessing = false;

  @Input()
  zoom = 100;

  @Input()
  canUndo = false;

  @Input()
  canRedo = false;

  @Input()
  pdfLoaded = false;

  // =========================================================
  // Events
  // =========================================================

  @Output()
  openPdf = new EventEmitter<void>();

  @Output()
  exportPdf = new EventEmitter<void>();

  @Output()
  security = new EventEmitter<void>();

  @Output()
  undo = new EventEmitter<void>();

  @Output()
  redo = new EventEmitter<void>();

  @Output()
  search = new EventEmitter<void>();

  @Output()
  tools = new EventEmitter<void>();

  @Output()
  zoomChanged = new EventEmitter<number>();

  // =========================================================
  // UI helpers
  // =========================================================

  get openButtonLabel(): string {
    return this.pdfLoaded ? 'Replace PDF' : 'Open PDF';
  }

  get documentName(): string {
    if (!this.pdfLoaded) {
      return 'No document open';
    }

    return this.projectName?.trim() || 'PDF document';
  }

  get documentStatus(): string {
    if (!this.pdfLoaded) {
      return 'Open a PDF to begin';
    }

    return this.browserProcessing ? 'Private • Ready' : 'Private • Browser processing';
  }

  get statusReady(): boolean {
    return this.pdfLoaded && this.browserProcessing;
  }

  onZoomSelect(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);

    if (!Number.isFinite(value)) {
      return;
    }

    this.zoomChanged.emit(value);
  }
}

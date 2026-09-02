import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';

@Component({
  selector: 'app-studio-header',
  standalone: true,
  templateUrl: './studio-header.html',
  styleUrl: './studio-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioHeader {

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
    return this.pdfLoaded
      ? 'Replace PDF'
      : 'Open PDF';
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

    return this.browserProcessing
      ? 'Private • Ready'
      : 'Private • Browser processing';
  }

  get statusReady(): boolean {
    return this.pdfLoaded && this.browserProcessing;
  }

  onZoomSelect(event: Event): void {
    const value = Number(
      (event.target as HTMLSelectElement).value
    );

    if (!Number.isFinite(value)) {
      return;
    }

    this.zoomChanged.emit(value);
  }
}

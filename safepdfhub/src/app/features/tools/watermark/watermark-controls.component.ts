import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { resolveWatermarkPageSelection } from '../../../core/watermark/pdf-watermark.service';
import type {
  PdfWatermarkFont,
  PdfWatermarkPosition,
  PdfWatermarkRequest,
} from '../../../core/watermark/pdf-watermark.types';

@Component({
  selector: 'app-watermark-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './watermark-controls.component.html',
  styleUrl: './watermark-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatermarkControlsComponent {
  @Input() pageCount = 0;
  @Input() currentPage = 1;
  @Input() busy = false;
  @Input() errorMessage: string | null = null;
  @Input() compact = false;
  @Input() request: PdfWatermarkRequest | null = null;
  @Input() showApplyButton = true;
  @Input() applyLabel = 'Apply Watermark';
  @Input() showRemoveButton = false;
  @Input() removeLabel = 'Remove watermark';

  @Output() readonly applyWatermark = new EventEmitter<PdfWatermarkRequest>();
  @Output() readonly removeWatermark = new EventEmitter<void>();
  @Output() readonly requestChange = new EventEmitter<PdfWatermarkRequest>();

  kind: 'text' | 'image' = 'text';
  text = 'CONFIDENTIAL';
  font: PdfWatermarkFont = 'Helvetica';
  fontSize = 42;
  color = '#17324d';
  opacity = 0.28;
  rotation = -35;
  position: PdfWatermarkPosition = 'center';
  tiled = false;
  pageMode: 'all' | 'current' | 'ranges' = 'all';
  currentPageSnapshot = 1;
  pageRanges = '';
  pageRangeError = '';
  imageFile: File | null = null;
  imagePreviewUrl = '';
  imageScalePercent = 28;
  imageErrorMessage = '';

  readonly positions: readonly { id: PdfWatermarkPosition; label: string; name: string }[] = [
    { id: 'top-left', label: '↖', name: 'Top left' },
    { id: 'top-center', label: '↑', name: 'Top center' },
    { id: 'top-right', label: '↗', name: 'Top right' },
    { id: 'middle-left', label: '←', name: 'Middle left' },
    { id: 'center', label: '•', name: 'Center' },
    { id: 'middle-right', label: '→', name: 'Middle right' },
    { id: 'bottom-left', label: '↙', name: 'Bottom left' },
    { id: 'bottom-center', label: '↓', name: 'Bottom center' },
    { id: 'bottom-right', label: '↘', name: 'Bottom right' },
  ];


  readonly rotationPresets = [
    { value: 0, label: 'Horizontal' },
    { value: -45, label: 'Diagonal' },
    { value: 45, label: 'Diagonal ↗' },
    { value: 90, label: 'Vertical' },
  ] as const;

  get selectedPositionLabel(): string {
    return this.positions.find(item => item.id === this.position)?.name ?? 'Center';
  }

  get canApply(): boolean {
    if (this.busy || !this.pageCount) return false;
    if (this.kind === 'text' && !this.text.trim()) return false;
    if (this.kind === 'image' && !this.imageFile) return false;
    if (this.pageMode === 'ranges' && !this.pageRanges.trim()) return false;
    if (this.pageMode === 'ranges' && !!this.pageRangeError) return false;
    if (this.pageMode === 'current' && (!Number.isInteger(this.currentPageSnapshot) || this.currentPageSnapshot < 1 || this.currentPageSnapshot > this.pageCount)) return false;
    return true;
  }

  get selectedPageSummary(): string {
    if (this.pageMode === 'all') return `All ${this.pageCount} pages`;
    if (this.pageMode === 'current') return `Current page ${this.currentPageSnapshot}`;
    return this.pageRanges.trim() ? `Pages ${this.pageRanges.trim()}` : 'Choose page ranges';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['request'] || !this.request) return;

    const request = this.request;
    this.kind = request.kind;
    this.text = request.text ?? '';
    this.font = request.font;
    this.fontSize = request.fontSize;
    this.color = request.color;
    this.opacity = request.opacity;
    this.rotation = request.rotation;
    this.position = request.position;
    this.tiled = request.tiled;
    this.pageRanges = request.pageSelection.mode === 'ranges' ? request.pageSelection.ranges : this.pageRanges;
    this.pageRangeError = '';
    this.currentPageSnapshot = request.pageSelection.mode === 'current'
      ? request.pageSelection.page
      : this.currentPage;
    this.pageMode = request.pageSelection.mode === 'all'
      ? 'all'
      : request.pageSelection.mode === 'current'
        ? 'current'
        : 'ranges';
    this.validatePageRanges();
    const nextImage = request.imageFile ?? null;
    if (nextImage !== this.imageFile) {
      this.revokeImagePreview();
      this.imageFile = nextImage;
      if (nextImage) this.imagePreviewUrl = URL.createObjectURL(nextImage);
    }
    this.imageScalePercent = request.imageScalePercent;
  }

  selectKind(kind: 'text' | 'image'): void {
    if (this.busy) return;
    this.kind = kind;
    this.emitChange();
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      this.imageErrorMessage = 'Choose a PNG, JPEG, or WebP image.';
      this.emitChange();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.imageErrorMessage = 'Watermark images must be 5 MB or smaller.';
      this.emitChange();
      return;
    }

    this.imageErrorMessage = '';
    this.revokeImagePreview();
    this.imageFile = file;
    this.imagePreviewUrl = URL.createObjectURL(file);
    this.emitChange();
  }

  resetOptions(): void {
    this.revokeImagePreview();
    this.kind = 'text';
    this.text = 'CONFIDENTIAL';
    this.font = 'Helvetica';
    this.fontSize = 42;
    this.color = '#17324d';
    this.opacity = 0.28;
    this.rotation = -35;
    this.position = 'center';
    this.tiled = false;
    this.pageMode = 'all';
    this.currentPageSnapshot = this.currentPage;
    this.pageRanges = '';
    this.pageRangeError = '';
    this.imageFile = null;
    this.imageScalePercent = 28;
    this.imageErrorMessage = '';
    this.emitChange();
  }

  selectPageMode(mode: 'all' | 'current' | 'ranges'): void {
    if (this.busy) return;

    this.pageMode = mode;
    if (mode === 'ranges') {
      this.validatePageRanges();
    } else {
      this.pageRangeError = '';
    }
    if (mode === 'current') {
      this.currentPageSnapshot = this.currentPage;
    }

    this.emitChange();
  }

  onPageRangesChange(value: string): void {
    this.pageRanges = value;
    this.validatePageRanges();
    this.emitChange();
  }

  private validatePageRanges(): boolean {
    if (this.pageMode !== 'ranges') {
      this.pageRangeError = '';
      return true;
    }

    const value = this.pageRanges.trim();
    if (!value) {
      this.pageRangeError = 'Enter at least one page number or range, for example 1-3,5,8-10.';
      return false;
    }

    if (!this.pageCount) {
      this.pageRangeError = 'Page range validation is unavailable until the document page count is known.';
      return false;
    }

    // Reject malformed comma-separated expressions before delegating to the
    // canonical page-selection resolver. This keeps the control-level UX
    // deterministic even for values such as `1,,3`, `1-`, or whitespace-only
    // tokens.
    const tokens = value.split(',').map(token => token.trim());
    if (tokens.some(token => token.length === 0 || !/^\d+(?:-\d+)?$/.test(token))) {
      this.pageRangeError = 'Enter valid page numbers or ranges, for example 1-3,5,8-10.';
      return false;
    }

    try {
      resolveWatermarkPageSelection({ mode: 'ranges', ranges: value }, this.pageCount);
      this.pageRangeError = '';
      return true;
    } catch (error: unknown) {
      this.pageRangeError = error instanceof Error
        ? error.message
        : 'Enter valid page numbers or ranges within the document.';
      return false;
    }
  }

  emitChange(): void {
    this.requestChange.emit(this.buildRequest());
  }

  apply(): void {
    if (!this.canApply) return;
    this.applyWatermark.emit(this.buildRequest());
  }

  remove(): void {
    if (this.busy || !this.showRemoveButton) return;
    this.removeWatermark.emit();
  }

  private buildRequest(): PdfWatermarkRequest {
    return {
      kind: this.kind,
      text: this.kind === 'text' ? this.text.trim() : undefined,
      imageFile: this.kind === 'image' ? this.imageFile ?? undefined : undefined,
      opacity: this.opacity,
      rotation: this.rotation,
      position: this.position,
      pageSelection: this.pageMode === 'all'
        ? { mode: 'all' }
        : this.pageMode === 'current'
          ? { mode: 'current', page: this.currentPageSnapshot }
          : { mode: 'ranges', ranges: this.pageRanges.trim() },
      tiled: this.tiled,
      fontSize: this.fontSize,
      font: this.font,
      color: this.color,
      imageScalePercent: this.imageScalePercent,
    };
  }

  private revokeImagePreview(): void {
    if (this.imagePreviewUrl.startsWith('blob:')) URL.revokeObjectURL(this.imagePreviewUrl);
    this.imagePreviewUrl = '';
  }

  ngOnDestroy(): void {
    this.revokeImagePreview();
  }
}

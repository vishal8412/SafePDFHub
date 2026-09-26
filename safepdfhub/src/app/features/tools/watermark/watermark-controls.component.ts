import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  pageMode: 'all' | 'ranges' = 'all';
  pageRanges = '';
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
    return true;
  }

  get selectedPageSummary(): string {
    if (this.pageMode === 'all') return `All ${this.pageCount} pages`;
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
    this.pageMode = request.pageSelection.mode;
    this.pageRanges = request.pageSelection.mode === 'ranges' ? request.pageSelection.ranges : '';
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
    this.pageRanges = '';
    this.imageFile = null;
    this.imageScalePercent = 28;
    this.imageErrorMessage = '';
    this.emitChange();
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

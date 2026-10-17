import { LARGE_COMPRESSION_THRESHOLD, LOSSLESS_ONLY_THRESHOLD } from '../../../../core/compression/large/large-compression-policy';
import {
  Component,
  Input,
  Output,
  EventEmitter
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { CompressionResult } from '../../../../core/compression/compression.models';
import { CommonModule } from '@angular/common';
import { OperationResultComponent } from '../../../../shared/components/operation-result/operation-result.component';

@Component({
  selector: 'app-compress-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, OperationResultComponent],
  templateUrl:
    './compress-workspace.component.html',
  styleUrls: [
    './compress-workspace.component.scss'
  ]
})
export class CompressWorkspaceComponent {

  @Input() allowGrayscale = false;
  @Input() sizePriority = false;
  @Output() sizePriorityChange = new EventEmitter<boolean>();
  @Output() allowGrayscaleChange = new EventEmitter<boolean>();
  @Input() targetSizeMB: number | null = null;
  @Input() compressionResult: CompressionResult | null = null;
  @Output() targetSizeMBChange = new EventEmitter<number | null>();

  get targetInvalid(): boolean {
    return this.targetSizeMB !== null && (!Number.isFinite(this.targetSizeMB) || this.targetSizeMB <= 0 || this.targetSizeMB > 10000);
  }

  setTarget(value: number | null): void {
    if (this.loading || this.compressing) return;
    if (value === null) this.allowGrayscaleChange.emit(false);
    if (value === null) this.sizePriorityChange.emit(false);
    this.targetSizeMBChange.emit(value);
  }

  retryWithGrayscale(): void {
    if (this.loading || this.compressing || this.largeFileMode) return;
    this.allowGrayscaleChange.emit(true);
    this.compress.emit();
  }

  retryWithSizePriority(): void {
    if (this.loading || this.compressing || this.largeFileMode) return;
    this.sizePriorityChange.emit(true);
    this.compress.emit();
  }

  get sizePriorityNotice(): string {
    return this.compressionResult?.sizePriorityRequested
      ? ' Stronger image reduction was allowed. Small scanned text may be unreadable; compare it with your original.' : '';
  }

  get grayscaleNotice(): string {
    return this.compressionResult?.grayscaleRequested && !this.compressionResult.processingNote?.includes('Grayscale was unavailable')
      ? ' Grayscale was allowed for this run. Review fine text, stamps and signatures before using the file.' : '';
  }

  get processingNotice(): string {
    const note = this.compressionResult?.processingNote ?? '';
    if (note.includes('Grayscale was unavailable')) return ' Grayscale was unavailable for this file on this device; colour was retained.';
    if (note.includes('resource or validation limit') || note.includes('could not be validated')) {
      return ' A device resource or validation limit stopped further compression. The best validated result was retained.';
    }
    return this.largeFileMode ? ' This file used lossless compression.' : '';
  }

  get limitedReduction(): boolean {
    return !!this.resultFile && !this.compressionResult?.returnedOriginal &&
      (this.files[0]?.size ?? 0) > 0 && this.resultFile.size >= this.files[0].size * 0.99;
  }

  get resultDescription(): string {
    if (!this.resultFile) return '';
    const bytes = this.resultFile.size;
    const actual = `${this.formatFileSize(bytes)} (${bytes.toLocaleString()} bytes)`;
    const result = this.compressionResult;
    if (result?.targetBytes !== undefined) {
      return result.targetMet
        ? `Target met. Requested maximum: ${this.formatFileSize(result.targetBytes)}. Download size: ${actual}.`
        : `Target not reached. Requested maximum: ${this.formatFileSize(result.targetBytes)}. Smallest validated result: ${actual}. Further reduction may soften small text. ${!result.grayscaleRequested && !this.largeFileMode ? 'Try grayscale if you do not need colour, or choose a larger limit.' : 'Choose a larger limit, or split the PDF if multiple files are accepted.'}`;
    }
    if (this.limitedReduction) return `Only a small reduction was possible. Download size: ${actual}. Some images may already be optimized or require a format this device cannot recompress safely.`;
    return result?.returnedOriginal
      ? `No smaller result passed validation. Your original PDF is retained: ${actual}.`
      : `Download size: ${actual}. Saved ${result?.reduction ?? 0}% from the original.`;
  }

  @Input() files: File[] = [];
  get largeFileMode(): boolean { return (this.files[0]?.size ?? 0) > LOSSLESS_ONLY_THRESHOLD; }
  get diskBackedMode(): boolean { return (this.files[0]?.size ?? 0) > LARGE_COMPRESSION_THRESHOLD; }
  @Input() previews: string[] = [];
  @Input() pageCounts: number[] = [];
  @Input() estimatedReduction = 0;
  @Input() estimatedFinalSize = 0;
  @Input() analyzedPdfType: 'text' | 'scanned' | null = null;
  @Input() pdfInsights: any = null;
  @Input() compressionLevel: 'light' | 'recommended' | 'strong' = 'recommended';
  @Input() loading = false;
  @Input() compressing = false;
  @Input() progress = 0;
  @Input() resultFile: File | null = null;
  @Input() originalFileName = '';
  @Input() durationMs = 0;

  @Output() compressionLevelChange = new EventEmitter<'light' | 'recommended' | 'strong'>();
  @Output() compress = new EventEmitter<void>();
  @Output() replaceFile = new EventEmitter<void>();
  @Output() smartTool = new EventEmitter<'split-pdf' | 'protect-pdf'>();
  @Output() downloadResult = new EventEmitter<void>();
  @Output() processAnother = new EventEmitter<void>();
  @Output() editAgain = new EventEmitter<void>();

  get originalSizeDetails(): string {
    const bytes = this.files[0]?.size ?? 0;
    return `${bytes.toLocaleString()} bytes · ${(bytes / 1_048_576).toFixed(2)} MiB`;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1000) return `${bytes} bytes`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(2)} KB`;
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }

  selectLevel(
    level:
      'light'
      | 'recommended'
      | 'strong'
  ) {

    if (this.loading || this.compressing) return;
    this.targetSizeMBChange.emit(null);
    this.allowGrayscaleChange.emit(false);
    this.sizePriorityChange.emit(false);
    this.compressionLevelChange.emit(level);
  }

  startCompress() {
    if (this.loading || this.compressing || this.targetInvalid) {
      return;
    }
    this.compress.emit();
  }

  triggerReplace() {
    this.replaceFile.emit();
  }

  openSmartTool(slug: 'split-pdf' | 'protect-pdf'): void {
    this.smartTool.emit(slug);
  }

}

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

  @Input() targetSizeMB: number | null = null;
  @Input() compressionResult: CompressionResult | null = null;
  @Output() targetSizeMBChange = new EventEmitter<number | null>();

  get targetInvalid(): boolean {
    return this.targetSizeMB !== null && (!Number.isFinite(this.targetSizeMB) || this.targetSizeMB <= 0 || this.targetSizeMB > 10000);
  }

  setTarget(value: number | null): void {
    if (this.loading || this.compressing) return;
    this.targetSizeMBChange.emit(value);
  }

  get resultDescription(): string {
    if (!this.resultFile) return '';
    const bytes = this.resultFile.size;
    const actual = `${this.formatFileSize(bytes)} (${bytes.toLocaleString()} bytes)`;
    const result = this.compressionResult;
    if (result?.targetBytes !== undefined) {
      return result.targetMet
        ? `Target met. Requested maximum: ${this.formatFileSize(result.targetBytes)}. Download size: ${actual}.`
        : `Target not reached. Requested maximum: ${this.formatFileSize(result.targetBytes)}. Smallest validated result: ${actual}. This limit could not be reached with content-preserving compression; consider splitting the PDF.`;
    }
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
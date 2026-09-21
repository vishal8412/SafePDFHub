import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type PdfCompletionTheme = 'dark' | 'light';

@Component({
  selector: 'app-pdf-completion-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pdf-completion-result.component.html',
  styleUrl: './pdf-completion-result.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfCompletionResultComponent {
  @Input({ required: true }) file!: File;
  @Input() eyebrow = 'PROCESSING COMPLETE';
  @Input() successIcon: 'check' | 'signature' = 'check';
  @Input({ required: true }) title = '';
  @Input() description = '';
  @Input() operationLabel = 'PDF ready';
  @Input() originalFileName = '';
  @Input() durationMs = 0;
  @Input() primaryActionLabel = 'Download PDF';
  @Input() privacyTitle = 'Your PDF stayed on this device.';
  @Input() privacyDescription = 'SafePDFHub did not upload or receive your document.';
  @Input() statusLabel = 'Ready';
  @Input() theme: PdfCompletionTheme = 'dark';
  @Input() showEditAgain = true;
  @Input() showProcessAnother = true;
  @Input() processAnotherLabel = 'Process another PDF';
  @Input() editAgainLabel = 'Back to editor';

  @Output() readonly download = new EventEmitter<void>();
  @Output() readonly processAnother = new EventEmitter<void>();
  @Output() readonly editAgain = new EventEmitter<void>();

  get sizeLabel(): string {
    const bytes = this.file?.size ?? 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  get durationLabel(): string {
    if (this.durationMs < 1000) return `${Math.max(1, Math.round(this.durationMs))} ms`;
    return `${(this.durationMs / 1000).toFixed(1)} s`;
  }
}

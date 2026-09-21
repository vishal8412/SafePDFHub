import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { OperationResultIcon } from './operation-result.model';

@Component({
  selector: 'app-operation-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './operation-result.component.html',
  styleUrl: './operation-result.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationResultComponent {
  @Input({ required: true }) file!: File;
  @Input() originalFileName = '';
  @Input() durationMs = 0;

  @Input() eyebrow = 'PROCESSING COMPLETE';
  @Input({ required: true }) title = '';
  @Input() description = '';
  @Input() operationLabel = 'Processed PDF';
  @Input() icon: OperationResultIcon = 'check';

  @Input() actionLabel = 'Download PDF';
  @Input() actionDescription = 'Save your finished PDF to your device';
  @Input() statusLabel = 'Ready';
  @Input() processedLabel = 'On this device';
  @Input() footerNote = 'Your document was processed locally. Nothing was uploaded to a server.';
  @Input() showFooterNote = true;

  @Input() privacyHeading = 'Your PDF stayed on this device.';
  @Input() privacyDescription = 'SafePDFHub did not upload or receive your document.';
  @Input() privacyBadge = 'PRIVATE BY DESIGN';
  @Input() privacyLocalLabel = 'LOCAL';
  @Input() showPrivacyBadge = true;
  @Input() showPrivacyLocal = true;

  @Input() showEditAgain = false;
  @Input() editAgainLabel = 'Back to editor';
  @Input() processAnotherLabel = 'Process another PDF';

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

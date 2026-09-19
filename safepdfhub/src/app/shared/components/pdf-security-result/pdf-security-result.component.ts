import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { PdfSecurityMode, PdfSecurityResult } from '../../../core/security/pdf-security.types';

@Component({
  selector: 'app-pdf-security-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pdf-security-result.component.html',
  styleUrl: './pdf-security-result.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PdfSecurityResultComponent {
  @Input({ required: true }) result!: PdfSecurityResult;
  @Input() originalFileName = '';

  @Output() readonly download = new EventEmitter<void>();
  @Output() readonly processAnother = new EventEmitter<void>();

  get title(): string {
    switch (this.result.mode) {
      case 'protect': return 'Your PDF is protected';
      case 'unlock': return 'Your PDF is unlocked';
      case 'remove-password': return 'Your PDF password was removed';
    }
  }

  get description(): string {
    switch (this.result.mode) {
      case 'protect': return 'The PDF has been encrypted on your device and is ready to download.';
      case 'unlock': return 'A password-free copy was created locally using the password you provided.';
      case 'remove-password': return 'A password-free copy was created locally using the password you provided.';
    }
  }

  get actionLabel(): string {
    switch (this.result.mode) {
      case 'protect': return 'Download protected PDF';
      case 'unlock': return 'Download unlocked PDF';
      case 'remove-password': return 'Download password-free PDF';
    }
  }

  get operationLabel(): string {
    switch (this.result.mode) {
      case 'protect': return 'Password protected';
      case 'unlock': return 'Password removed';
      case 'remove-password': return 'Password removed';
    }
  }

  get sizeLabel(): string {
    const bytes = this.result.file.size;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  get durationLabel(): string {
    if (this.result.durationMs < 1000) return `${Math.max(1, Math.round(this.result.durationMs))} ms`;
    return `${(this.result.durationMs / 1000).toFixed(1)} s`;
  }
}

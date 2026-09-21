import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { OperationResultComponent } from '../operation-result/operation-result.component';
import type { PdfSecurityResult } from '../../../core/security/pdf-security.types';
import type { OperationResultIcon } from '../operation-result/operation-result.model';

@Component({
  selector: 'app-pdf-security-result',
  standalone: true,
  imports: [OperationResultComponent],
  templateUrl: './pdf-security-result.component.html',
  styleUrl: './pdf-security-result.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  get icon(): OperationResultIcon {
    return this.result.mode === 'protect' ? 'protect' : 'unlock';
  }

  get privacyDescription(): string {
    if (this.result.mode === 'protect') {
      return 'SafePDFHub did not upload or receive the document or password.';
    }
    return 'SafePDFHub did not upload or receive the document or password.';
  }
}

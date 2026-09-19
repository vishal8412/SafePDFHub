import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { PdfSecurityFormComponent } from '../../../../shared/components/pdf-security-form/pdf-security-form.component';
import { PdfSecurityResultComponent } from '../../../../shared/components/pdf-security-result/pdf-security-result.component';
import type {
  PdfSecurityMode,
  PdfSecurityRequest,
  PdfSecurityResult
} from '../../../../core/security/pdf-security.types';

@Component({
  selector: 'app-security-workspace',
  standalone: true,
  imports: [CommonModule, PdfSecurityFormComponent, PdfSecurityResultComponent],
  templateUrl: './security-workspace.component.html',
  styleUrl: './security-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SecurityWorkspaceComponent {
  @Input() mode: PdfSecurityMode = 'protect';
  @Input() file: File | null = null;
  @Input() busy = false;
  @Input() progress = 0;
  @Input() errorMessage: string | null = null;
  @Input() result: PdfSecurityResult | null = null;

  @Output() readonly replaceFile = new EventEmitter<void>();
  @Output() readonly submit = new EventEmitter<PdfSecurityRequest>();
  @Output() readonly downloadResult = new EventEmitter<void>();
  @Output() readonly processAnother = new EventEmitter<void>();

  onSubmit(request: PdfSecurityRequest): void {
    this.submit.emit(request);
  }
}

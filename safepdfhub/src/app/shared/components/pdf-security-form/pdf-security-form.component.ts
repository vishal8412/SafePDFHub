import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type {
  PdfSecurityMode,
  PdfSecurityRequest,
  PdfSecurityPermissions
} from '../../../core/security/pdf-security.types';

@Component({
  selector: 'app-pdf-security-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pdf-security-form.component.html',
  styleUrl: './pdf-security-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PdfSecurityFormComponent {
  @Input() mode: PdfSecurityMode = 'protect';
  @Input() busy = false;
  @Input() fileName = '';
  @Input() errorMessage: string | null = null;

  @Output() readonly submitted = new EventEmitter<PdfSecurityRequest>();
  @Output() readonly cancelled = new EventEmitter<void>();

  password = '';
  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;
  passwordTouched = false;
  confirmTouched = false;

  permissions: PdfSecurityPermissions = {
    allowPrinting: true,
    allowCopying: true,
    allowModifying: false,
    allowAnnotations: true,
    allowForms: true,
    allowAssembly: false
  };

  get title(): string {
    switch (this.mode) {
      case 'protect': return 'Protect PDF';
      case 'unlock': return 'Unlock PDF';
      case 'remove-password': return 'Remove Password';
    }
  }

  get description(): string {
    switch (this.mode) {
      case 'protect':
        return 'Add password protection and control what readers can do with your PDF.';
      case 'unlock':
        return 'Remove password protection when you know the current PDF password.';
      case 'remove-password':
        return 'Create a password-free copy when you know the current PDF password.';
    }
  }

  get actionLabel(): string {
    switch (this.mode) {
      case 'protect': return 'Protect PDF';
      case 'unlock': return 'Unlock PDF';
      case 'remove-password': return 'Remove Password';
    }
  }

  get passwordLabel(): string {
    return this.mode === 'protect' ? 'Create a password' : 'Current PDF password';
  }

  get passwordHint(): string {
    return this.mode === 'protect'
      ? 'Use a password you can remember. It is used only on this device and is never sent to SafePDFHub.'
      : 'Your password is used only in this browser to create the new PDF. SafePDFHub never receives it.';
  }

  get passwordAutocomplete(): string {
    return this.mode === 'protect' ? 'new-password' : 'current-password';
  }

  get passwordLengthValid(): boolean {
    return this.password.length >= 8 && this.password.length <= 128;
  }

  get passwordCharacterMixValid(): boolean {
    if (!this.password) return false;
    const categories = [
      /[a-z]/.test(this.password),
      /[A-Z]/.test(this.password),
      /\d/.test(this.password),
      /[^A-Za-z0-9\s]/.test(this.password)
    ];
    return categories.filter(Boolean).length >= 3;
  }

  get passwordHasControlCharacter(): boolean {
    return /[\u0000-\u001F\u007F]/.test(this.password);
  }

  get passwordValid(): boolean {
    if (this.mode !== 'protect') {
      return this.password.length > 0 && this.password.length <= 128 && !this.passwordHasControlCharacter;
    }

    return this.passwordLengthValid
      && this.passwordCharacterMixValid
      && !this.passwordHasControlCharacter
      && !/^\s+$/.test(this.password);
  }

  get confirmPasswordValid(): boolean {
    return this.mode !== 'protect'
      || (this.confirmPassword.length > 0 && this.password === this.confirmPassword);
  }

  get formValid(): boolean {
    return this.passwordValid && this.confirmPasswordValid;
  }

  get passwordStrength(): 'weak' | 'fair' | 'strong' {
    if (!this.password) return 'weak';

    let score = 0;
    if (this.password.length >= 8) score++;
    if (this.password.length >= 12) score++;
    if (/[a-z]/.test(this.password) && /[A-Z]/.test(this.password)) score++;
    if (/\d/.test(this.password)) score++;
    if (/[^A-Za-z0-9\s]/.test(this.password)) score++;

    return score >= 4 ? 'strong' : score >= 2 ? 'fair' : 'weak';
  }

  get passwordStrengthLabel(): string {
    if (!this.password) return 'Use 8–128 characters';
    if (this.passwordStrength === 'strong') return 'Strong password';
    if (this.passwordStrength === 'fair') return 'Good start — make it stronger';
    return 'Use a longer, more varied password';
  }

  get passwordValidationMessage(): string | null {
    if (!this.passwordTouched && !this.password) return null;
    if (!this.password) return 'Enter a password.';
    if (this.passwordHasControlCharacter) return 'Control characters are not supported in PDF passwords.';
    if (!this.passwordLengthValid) return 'Use between 8 and 128 characters.';
    if (this.mode === 'protect' && !this.passwordCharacterMixValid) {
      return 'Use at least 3 of these 4 groups: lowercase, uppercase, number, symbol.';
    }
    return null;
  }

  get confirmValidationMessage(): string | null {
    if (this.mode !== 'protect' || (!this.confirmTouched && !this.confirmPassword)) return null;
    if (!this.confirmPassword) return 'Confirm your password.';
    if (this.password !== this.confirmPassword) return 'Passwords do not match.';
    return null;
  }

  onPasswordChanged(): void {
    this.passwordTouched = true;
  }

  onConfirmChanged(): void {
    this.confirmTouched = true;
  }

  submit(): void {
    this.passwordTouched = true;
    this.confirmTouched = true;

    if (this.busy || !this.formValid) return;

    this.submitted.emit({
      mode: this.mode,
      password: this.password,
      confirmPassword: this.mode === 'protect' ? this.confirmPassword : undefined,
      permissions: this.mode === 'protect' ? this.permissions : undefined
    });
  }
}

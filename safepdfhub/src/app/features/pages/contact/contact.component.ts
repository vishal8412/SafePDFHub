import { Component } from '@angular/core';
import { AbstractControl, FormsModule, NgForm } from '@angular/forms';
import { LucideAngularModule, ArrowRight, CircleAlert, CircleHelp, Handshake, LoaderCircle, ShieldCheck } from 'lucide-angular';
import { SITE_CONFIG } from '../../../config/site.config';

interface ContactPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  website: string;
  startedAt: number;
}

type SubmitState = 'idle' | 'success' | 'error';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent {
  readonly contactEmail = SITE_CONFIG.contactEmail;
  readonly icons = {
    ArrowRight,
    CircleAlert,
    CircleHelp,
    Handshake,
    LoaderCircle,
    ShieldCheck
  };

  name = '';
  email = '';
  subject = '';
  message = '';

  /** Honeypot field. Real users never see or fill this field. */
  website = '';

  readonly formStartedAt = Date.now();

  isSubmitting = false;
  submitState: SubmitState = 'idle';
  submitMessage = '';

  async sendMessage(form: NgForm): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    form.form.markAllAsTouched();

    const name = this.name.trim();
    const email = this.email.trim();
    const subject = this.subject.trim();
    const message = this.message.trim();

    this.setTrimValidationError(form, 'name', name.length < 2);
    this.setTrimValidationError(form, 'subject', subject.length < 2);
    this.setTrimValidationError(form, 'message', message.length < 10);

    if (form.invalid || name.length < 2 || subject.length < 2 || message.length < 10 || !this.isValidEmail(email)) {
      this.submitState = 'error';
      this.submitMessage = 'Please check the highlighted fields and complete the form before sending.';
      return;
    }

    this.submitState = 'idle';
    this.submitMessage = '';
    this.isSubmitting = true;

    const payload: ContactPayload = {
      name,
      email,
      subject,
      message,
      website: this.website.trim(),
      startedAt: this.formStartedAt
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json')
        ? await response.json().catch(() => null) as { message?: string } | null
        : null;

      if (!response.ok) {
        throw new Error(result?.message || this.getRequestErrorMessage(response.status));
      }

      if (!result?.message) {
        throw new Error(this.getRequestErrorMessage(response.status, true));
      }

      this.submitState = 'success';
      this.submitMessage = result.message;
      this.name = '';
      this.email = '';
      this.subject = '';
      this.message = '';
      this.website = '';
      form.resetForm();
    } catch (error) {
      this.submitState = 'error';
      this.submitMessage = this.getClientErrorMessage(error);
    } finally {
      window.clearTimeout(timeoutId);
      this.isSubmitting = false;
    }
  }

private setTrimValidationError(
  form: NgForm,
  fieldName: string,
  invalid: boolean
): void {
  const control = form.controls[fieldName];

  if (!control) {
    return;
  }

  if (invalid) {
    control.setErrors({
      ...(control.errors ?? {}),
      trimValidation: true
    });

    return;
  }

  if (!control.errors?.['trimValidation']) {
    return;
  }

  const remainingErrors = { ...control.errors };
  delete remainingErrors['trimValidation'];

  control.setErrors(
    Object.keys(remainingErrors).length > 0
      ? remainingErrors
      : null
  );
}

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  }

  private getRequestErrorMessage(status: number, invalidSuccessResponse = false): string {
    if (invalidSuccessResponse) {
      return 'The contact service returned an unexpected response. Please try again or email us directly.';
    }

    if (status === 404) {
      return 'The contact service is not available on this server. If you are testing locally, run the SafePDFHub SSR server.';
    }

    return 'We could not send your message right now. Please try again or email us directly.';
  }

  private getClientErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'The request timed out. Please check the server connection and try again, or email us directly.';
    }

    if (error instanceof TypeError) {
      return 'We could not reach the contact service. Please check the server connection and try again, or email us directly.';
    }

    return error instanceof Error
      ? error.message
      : 'We could not send your message right now. Please try again or email us directly.';
  }
}

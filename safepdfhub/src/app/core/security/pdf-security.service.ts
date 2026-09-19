import { Injectable } from '@angular/core';

import { QpdfWasmRuntimeService } from '../qpdf/qpdf-wasm-runtime.service';
import { LargePdfSecurityEngine, LargePdfSecurityEngineError } from './large-file/large-pdf-security.engine';
import type { QpdfRunResult } from '../qpdf/qpdf-wasm.types';
import { PdfSecurityError } from './pdf-security.types';
import type { PdfProtectOptions, PdfSecurityMode, PdfSecurityResult } from './pdf-security.types';

@Injectable({ providedIn: 'root' })
export class PdfSecurityService {
  private cancelled = false;

  constructor(
    private readonly qpdf: QpdfWasmRuntimeService,
    private readonly largeEngine: LargePdfSecurityEngine
  ) {}

  async protect(
    file: File,
    options: PdfProtectOptions,
    onProgress?: (progress: number) => void
  ): Promise<PdfSecurityResult> {
    this.cancelled = false;
    this.assertPassword(options.userPassword, 'Password is required to protect the PDF.');
    this.assertPasswordPolicy(options.userPassword);

    const requestedOwnerPassword = options.ownerPassword?.trim();
    // Never use the same user and owner password. qpdf documents this as insecure
    // because the owner password is intended to bypass user-level restrictions.
    const ownerPassword = requestedOwnerPassword && requestedOwnerPassword !== options.userPassword
      ? requestedOwnerPassword
      : this.generateOwnerPassword();

    const outputName = this.outputName(file.name, 'protected');
    const inputName = this.inputName(file.name);
    const startedAt = performance.now();

    const args = [
      '--encrypt',
      `--user-password=${options.userPassword}`,
      `--owner-password=${ownerPassword}`,
      `--bits=${options.bits ?? 256}`,
      `--print=${options.permissions.allowPrinting ? 'full' : 'none'}`,
      `--extract=${options.permissions.allowCopying ? 'y' : 'n'}`,
      `--modify=${options.permissions.allowModifying ? 'all' : 'none'}`,
      `--annotate=${options.permissions.allowAnnotations ? 'y' : 'n'}`,
      `--form=${options.permissions.allowForms ? 'y' : 'n'}`,
      `--assemble=${options.permissions.allowAssembly ? 'y' : 'n'}`,
      '--',
      inputName,
      outputName
    ];

    onProgress?.(5);

    if (this.largeEngine.supported && file.size <= 1024 * 1024 * 1024) {
      try {
        return await this.largeEngine.protect(file, {
          ...options,
          ownerPassword
        }, onProgress);
      } catch (error: unknown) {
        if (!this.isLargeEngineUnavailable(error)) {
          throw this.normalizeEngineError(error, 'protect');
        }
      }
    }

    return this.runTransform(file, inputName, outputName, args, 'protect', startedAt, onProgress);
  }

  async unlock(
    file: File,
    password: string,
    onProgress?: (progress: number) => void
  ): Promise<PdfSecurityResult> {
    return this.removePassword(file, password, onProgress, 'unlock');
  }

  async removePassword(
    file: File,
    password: string,
    onProgress?: (progress: number) => void,
    mode: PdfSecurityMode = 'remove-password'
  ): Promise<PdfSecurityResult> {
    this.cancelled = false;
    this.assertPassword(password, 'Enter the PDF password.');

    const outputName = this.outputName(file.name, mode === 'unlock' ? 'unlocked' : 'password-removed');
    const inputName = this.inputName(file.name);
    const startedAt = performance.now();
    const args = [
      `--password=${password}`,
      '--decrypt',
      '--',
      inputName,
      outputName
    ];

    onProgress?.(5);

    if (this.largeEngine.supported && file.size <= 1024 * 1024 * 1024) {
      try {
        return mode === 'unlock'
          ? await this.largeEngine.unlock(file, password, onProgress)
          : await this.largeEngine.removePassword(file, password, onProgress, mode);
      } catch (error: unknown) {
        if (!this.isLargeEngineUnavailable(error)) {
          throw this.normalizeEngineError(error, mode);
        }
      }
    }

    return this.runTransform(file, inputName, outputName, args, mode, startedAt, onProgress);
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.largeEngine.cancel();
    await this.qpdf.cancel();
  }

  private async runTransform(
    file: File,
    inputName: string,
    outputName: string,
    args: readonly string[],
    mode: PdfSecurityMode,
    startedAt: number,
    onProgress?: (progress: number) => void
  ): Promise<PdfSecurityResult> {
    this.cancelled = false;

    // Keep the JS-side copy count low. qpdf-run owns the worker transfer/copy boundary,
    // so there is no reason for SafePDFHub to create another Uint8Array or output buffer.
    const buffer = await file.arrayBuffer();
    this.throwIfCancelled();
    onProgress?.(20);

    let result: QpdfRunResult;

    try {
      result = await this.qpdf.run({
        inputs: { [inputName]: new Uint8Array(buffer) },
        args,
        outputs: [outputName]
      }, progress => onProgress?.(20 + Math.round(progress * 0.7)));
    } catch (error: unknown) {
      if (this.cancelled) {
        throw new PdfSecurityError('PDF security operation was cancelled.', 'CANCELLED');
      }
      throw this.normalizeEngineError(error, mode);
    }

    this.throwIfCancelled();

    if (!result.ok || result.exitCode !== 0) {
      throw this.normalizeQpdfFailure(result, mode);
    }

    const output = result.outputs[outputName];
    if (!output) {
      throw new PdfSecurityError('The PDF security engine did not return an output file.', 'ENGINE_FAILED');
    }

    onProgress?.(95);

    /*
     * TypeScript 5.9's DOM typings model Uint8Array as Uint8Array<ArrayBufferLike>,
     * while File/BlobPart requires an ArrayBuffer-backed view. qpdf-run returns a
     * Uint8Array<ArrayBufferLike>, so passing it directly to File produces TS2322.
     *
     * Normalize only at this final File boundary. The copy is intentional and keeps
     * the qpdf runtime boundary unchanged; it also preserves the correct byte range
     * when the returned Uint8Array is a view into a larger buffer.
     */
    const outputBuffer = new ArrayBuffer(output.byteLength);
    new Uint8Array(outputBuffer).set(output);
    const outputFile = new File([outputBuffer], outputName, { type: 'application/pdf' });

    onProgress?.(100);

    return {
      file: outputFile,
      mode,
      durationMs: performance.now() - startedAt
    };
  }

  private normalizeQpdfFailure(result: QpdfRunResult, mode: PdfSecurityMode): PdfSecurityError {
    const details = [...result.stderr, ...result.warnings]
      .map(entry => entry.trim())
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (this.looksLikeMemoryFailure(details)) {
      return new PdfSecurityError(
        'This PDF is too memory-intensive for the browser security engine on this device. Try a smaller PDF or a copy with very large images reduced/flattened.',
        'MEMORY_LIMIT'
      );
    }

    if (this.looksLikeStorageFailure(details)) {
      return new PdfSecurityError(
        'There is not enough local browser storage available for the protected PDF output. Free some browser storage and try again.',
        'STORAGE_LIMIT'
      );
    }

    if (mode === 'protect' && this.looksLikeEncryptedInput(details)) {
      return new PdfSecurityError(
        'This PDF is already password-protected. Unlock it first with the current password, then protect the unlocked copy with a new password.',
        'INPUT_ENCRYPTED'
      );
    }

    if (mode !== 'protect' && this.looksLikePasswordFailure(details)) {
      return new PdfSecurityError(
        'The password is incorrect or this PDF cannot be unlocked with the supplied password.',
        'INVALID_PASSWORD'
      );
    }

    return new PdfSecurityError(
      details ? `PDF security operation failed. ${details}` : 'PDF security operation failed.',
      'ENGINE_FAILED'
    );
  }

  private isLargeEngineUnavailable(error: unknown): boolean {
    return error instanceof PdfSecurityError && error.code === 'ENGINE_FAILED'
      && error.message.includes('large-file browser security engine is not available');
  }

  private normalizeEngineError(error: unknown, mode: PdfSecurityMode): PdfSecurityError {
    const largeError = error instanceof LargePdfSecurityEngineError ? error : null;
    const message = largeError
      ? [...largeError.stderr, ...largeError.stdout, largeError.message].filter(Boolean).join(' ')
      : error instanceof Error ? error.message : 'PDF security operation failed.';
    const normalized = message.toLowerCase();

    if (this.looksLikeMemoryFailure(normalized)) {
      return new PdfSecurityError(
        'This PDF is too memory-intensive for the browser security engine on this device. Try a smaller PDF or a copy with very large images reduced/flattened.',
        'MEMORY_LIMIT'
      );
    }

    if (this.looksLikeStorageFailure(normalized)) {
      return new PdfSecurityError(
        'There is not enough local browser storage available for the protected PDF output. Free some browser storage and try again.',
        'STORAGE_LIMIT'
      );
    }

    if (mode === 'protect' && this.looksLikeEncryptedInput(normalized)) {
      return new PdfSecurityError(
        'This PDF is already password-protected. Unlock it first with the current password, then protect the unlocked copy with a new password.',
        'INPUT_ENCRYPTED'
      );
    }

    if (mode !== 'protect' && this.looksLikePasswordFailure(normalized)) {
      return new PdfSecurityError(
        'The password is incorrect or this PDF cannot be unlocked with the supplied password.',
        'INVALID_PASSWORD'
      );
    }

    return new PdfSecurityError(message, 'ENGINE_FAILED');
  }

  private looksLikeStorageFailure(message: string): boolean {
    return message.includes('quotaexceedederror')
      || message.includes('quota exceeded')
      || message.includes('storage quota')
      || message.includes('origin private file system');
  }

  private looksLikeMemoryFailure(message: string): boolean {
    return message.includes('aborted(oom)')
      || message.includes('out of memory')
      || message.includes('cannot enlarge memory')
      || message.includes('memory allocation failed')
      || message.includes('not enough memory')
      || message.includes('memory growth');
  }

  private looksLikeEncryptedInput(message: string): boolean {
    return message.includes('file is encrypted')
      || message.includes('encrypted file')
      || message.includes('password required')
      || message.includes('encryption dictionary');
  }

  private looksLikePasswordFailure(message: string): boolean {
    return message.includes('password')
      || message.includes('invalid password')
      || message.includes('incorrect password')
      || message.includes('invalid encryption key');
  }

  private assertPassword(password: string, message: string): void {
    if (!password) {
      throw new PdfSecurityError(message, 'PASSWORD_REQUIRED');
    }
  }

  private assertPasswordPolicy(password: string): void {
    if (password.length < 8 || password.length > 128) {
      throw new PdfSecurityError('Use a password between 8 and 128 characters.', 'PASSWORD_INVALID');
    }

    if (/\u0000|[\u0001-\u001F\u007F]/.test(password)) {
      throw new PdfSecurityError('Control characters are not supported in PDF passwords.', 'PASSWORD_INVALID');
    }

    const categories = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9\s]/.test(password)
    ];

    if (categories.filter(Boolean).length < 3) {
      throw new PdfSecurityError('Use at least 3 of these 4 character groups: lowercase, uppercase, number, and symbol.', 'PASSWORD_INVALID');
    }
  }

  private generateOwnerPassword(): string {
    const bytes = new Uint8Array(24);
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
      throw new PdfSecurityError('Secure password generation is unavailable in this browser.', 'ENGINE_FAILED');
    }
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      throw new PdfSecurityError('PDF security operation was cancelled.', 'CANCELLED');
    }
  }

  private inputName(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `input-${safe || 'document.pdf'}`;
  }

  private outputName(name: string, suffix: string): string {
    const base = name.replace(/\.pdf$/i, '') || 'document';
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safe}_${suffix}.pdf`;
  }
}

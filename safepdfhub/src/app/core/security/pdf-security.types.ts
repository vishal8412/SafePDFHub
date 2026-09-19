export type PdfSecurityMode =
  | 'protect'
  | 'unlock'
  | 'remove-password';

export interface PdfSecurityPermissions {
  readonly allowPrinting: boolean;
  readonly allowCopying: boolean;
  readonly allowModifying: boolean;
  readonly allowAnnotations: boolean;
  readonly allowForms: boolean;
  readonly allowAssembly: boolean;
}

export type PdfLargeFilePerformanceMode =
  | 'balanced'
  | 'fast';

export interface PdfProtectOptions {
  readonly userPassword: string;
  readonly ownerPassword?: string;
  readonly permissions: PdfSecurityPermissions;
  readonly bits?: 128 | 256;
  /**
   * Explicit opt-in for the large-file speed profile.
   *
   * 'balanced' keeps the requested/default AES-256 security level.
   * 'fast' uses AES-128 for large protect jobs (>=64 MiB) together with
   * stream-data preservation. AES-128 is still AES encryption, but it has
   * a smaller key size than the 256-bit default.
   */
  readonly largeFilePerformance?: PdfLargeFilePerformanceMode;
  /** Development-only F3 profiling; never enabled by normal Protect UI. */
  readonly enableF3Diagnostics?: boolean;
}

export interface PdfSecurityRequest {
  readonly mode: PdfSecurityMode;
  readonly password: string;
  readonly confirmPassword?: string;
  readonly permissions?: PdfSecurityPermissions;
}

export interface PdfSecurityResult {
  readonly file: File;
  readonly mode: PdfSecurityMode;
  readonly durationMs: number;
}

export type PdfSecurityErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'INPUT_INVALID'
  | 'INPUT_ENCRYPTED'
  | 'PASSWORD_INVALID'
  | 'MEMORY_LIMIT'
  | 'STORAGE_LIMIT'
  | 'ENGINE_FAILED'
  | 'CANCELLED';

export class PdfSecurityError extends Error {
  constructor(
    message: string,
    readonly code: PdfSecurityErrorCode
  ) {
    super(message);
    this.name = 'PdfSecurityError';
  }
}

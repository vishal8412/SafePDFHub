import { Injectable } from '@angular/core';
import { LocalProcessingCapabilityService } from './local-processing-capability.service';
import { FileValidationResult, PdfValidationCode } from './local-processing-capability.model';
import { LargePdfSecurityCapabilityService } from '../security/large-file/large-pdf-security-capability.service';
import { QpdfWasmRuntimeService } from '../qpdf/qpdf-wasm-runtime.service';
import type { QpdfRunResult } from '../qpdf/qpdf-wasm.types';
import type { PdfSecurityMode } from '../security/pdf-security.types';

export type PdfEncryptionHint = 'encrypted' | 'not-encrypted' | 'unknown';

/**
 * Central PDF upload validation.
 *
 * Validation is intentionally split into two layers:
 *  1. cheap envelope checks that run before a File enters the workspace;
 *  2. optional qpdf diagnostics that can be invoked explicitly when a caller
 *     needs authoritative structural inspection.
 *
 * Upload admission must remain fast. A deep qpdf --check is not an upload gate
 * because it parses the document and can turn a normal upload into a long-running
 * validation step. The actual PDF engine remains authoritative at operation time.
 */
@Injectable({ providedIn: 'root' })
export class PdfValidationService {
  private readonly headerScanBytes = 1024;
  private readonly encryptionHintScanBytes = 256 * 1024;
  // qpdf-run receives an in-memory Uint8Array. Avoid duplicating very large
  // security inputs during upload; those files are validated by the dedicated
  // Worker during the actual operation.
  private readonly deepPreflightMaxBytes = 128 * 1024 * 1024;

  constructor(
    private readonly capabilityService: LocalProcessingCapabilityService,
    private readonly securityCapability: LargePdfSecurityCapabilityService,
    private readonly qpdf: QpdfWasmRuntimeService
  ) {}

  validateSelection(
    file: File,
    existingFiles: readonly File[],
    allowMultiple: boolean
  ): FileValidationResult {
    const typeResult = this.validateFileType(file);
    if (!typeResult.valid) return typeResult;

    if (file.size <= 0) {
      return {
        valid: false,
        code: 'empty-file',
        message: `${file.name} is empty and cannot be processed.`
      };
    }

    const duplicate = existingFiles.some(existing =>
      existing.name === file.name && existing.size === file.size
    );
    if (duplicate) {
      return { valid: false, code: 'duplicate', message: `${file.name} is already added.` };
    }

    const budget = this.capabilityService.budget;

    if (file.size > budget.maxFileBytes) {
      return {
        valid: false,
        code: 'file-too-large',
        message: `${file.name} is larger than the ${this.formatBytes(budget.maxFileBytes)} local limit for this device.`
      };
    }

    if (allowMultiple && existingFiles.length + 1 > budget.maxFiles) {
      return {
        valid: false,
        code: 'too-many-files',
        message: `You can process up to ${budget.maxFiles} PDFs at a time on this device.`
      };
    }

    const totalBytes = existingFiles.reduce((sum, item) => sum + item.size, 0) + file.size;
    if (totalBytes > budget.maxTotalBytes) {
      return {
        valid: false,
        code: 'total-too-large',
        message: `The combined files would exceed the ${this.formatBytes(budget.maxTotalBytes)} local limit for this device.`
      };
    }

    return { valid: true, code: 'ok' };
  }

  validateSecuritySelection(file: File): FileValidationResult {
    const typeResult = this.validateFileType(file);
    if (!typeResult.valid) return typeResult;

    if (file.size <= 0) {
      return {
        valid: false,
        code: 'empty-file',
        message: `${file.name} is empty and cannot be processed.`
      };
    }

    if (!this.securityCapability.supported) {
      return this.validateSelection(file, [], false);
    }

    if (file.size > this.securityCapability.current.maxFileBytes) {
      return {
        valid: false,
        code: 'file-too-large',
        message: `This PDF exceeds the 1 GB local security-engine input target.`
      };
    }

    return { valid: true, code: 'ok' };
  }

  /**
   * Performs a cheap, non-authoritative encryption hint check without loading
   * the whole PDF into JavaScript memory. The /Encrypt entry normally lives in
   * the trailer dictionary near the end of the file. This is intentionally a
   * hint only: the real qpdf security engine remains authoritative.
   */
  async inspectEncryptionHint(file: File): Promise<PdfEncryptionHint> {
    try {
      // Find the authoritative startxref pointer from the end of the file.
      // Reading only the final 256 KiB keeps this check cheap even for 1 GiB
      // security inputs.
      const tailStart = Math.max(0, file.size - this.encryptionHintScanBytes);
      const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
      const tailText = new TextDecoder('latin1').decode(tail);
      const startxrefMatches = [...tailText.matchAll(/startxref\s+(\d+)/g)];
      const startxrefMatch = startxrefMatches.at(-1);
      if (!startxrefMatch) return 'unknown';

      const startxref = Number(startxrefMatch[1]);
      if (!Number.isSafeInteger(startxref) || startxref < 0 || startxref >= file.size) {
        return 'unknown';
      }

      // A PDF can use either a traditional xref table or a cross-reference
      // stream. In the latter case the /Encrypt entry is commonly in the
      // xref-stream object's dictionary, which may be hundreds of KiB before
      // the final %%EOF. Searching only the final bytes therefore misses large
      // encrypted PDFs.
      const inspectedOffsets = new Set<number>();
      let currentOffset: number | null = startxref;

      for (let depth = 0; depth < 4 && currentOffset !== null; depth++) {
        if (inspectedOffsets.has(currentOffset)) break;
        inspectedOffsets.add(currentOffset);

        const section = new Uint8Array(
          await file.slice(currentOffset, Math.min(file.size, currentOffset + 4 * 1024 * 1024)).arrayBuffer()
        );
        const sectionText = new TextDecoder('latin1').decode(section);

        if (this.containsPdfDictionaryKey(sectionText, '/Encrypt')) {
          return 'encrypted';
        }

        // Traditional xref tables place the trailer after the xref entries.
        // Four MiB is intentionally bounded; if an unusually large xref table
        // exceeds this window we stay conservative and let the real engine
        // decide rather than rejecting a valid PDF.
        const trailerIndex = sectionText.indexOf('trailer');
        if (trailerIndex >= 0) {
          const trailerText = sectionText.slice(trailerIndex, trailerIndex + 64 * 1024);
          if (this.containsPdfDictionaryKey(trailerText, '/Encrypt')) {
            return 'encrypted';
          }

          const xrefStm = this.extractPdfOffset(trailerText, '/XRefStm');
          if (xrefStm !== null && !inspectedOffsets.has(xrefStm)) {
            currentOffset = xrefStm;
            continue;
          }

          const previousXref = this.extractPdfOffset(trailerText, '/Prev');
          if (previousXref !== null && !inspectedOffsets.has(previousXref)) {
            currentOffset = previousXref;
            continue;
          }
        }

        // Cross-reference streams can contain /Prev in their object dictionary
        // as well, so follow an incremental-update chain when visible.
        const previousXref = this.extractPdfOffset(sectionText.slice(0, 64 * 1024), '/Prev');
        if (previousXref !== null && !inspectedOffsets.has(previousXref)) {
          currentOffset = previousXref;
          continue;
        }

        currentOffset = null;
      }

      // If a structurally recognizable trailer/xref region was found without
      // /Encrypt, report not-encrypted. Otherwise stay conservative.
      const hasPdfStructure = /(?:^|\n)\s*(?:xref|\d+\s+\d+\s+obj|trailer)\b/.test(tailText)
        || /(?:^|\n)\s*(?:xref|\d+\s+\d+\s+obj|trailer)\b/.test(
          new TextDecoder('latin1').decode(
            await file.slice(startxref, Math.min(file.size, startxref + 16 * 1024)).arrayBuffer()
          )
        );
      return hasPdfStructure ? 'not-encrypted' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private containsPdfDictionaryKey(text: string, key: string): boolean {
    // /Encrypt must be a PDF name token. This avoids false positives from
    // arbitrary binary/text content elsewhere in a stream.
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?=\\s|/|>)`).test(text);
  }

  private extractPdfOffset(text: string, key: string): number | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s+(\\d+)`));
    if (!match) return null;
    const offset = Number(match[1]);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
  }

  /**
   * Performs content validation without adding the file to the workspace.

   * Security tools get a qpdf-backed structural/encryption preflight because
   * they intentionally do not render a preview before processing.
   */
  async validateSecurityContent(
    file: File,
    mode: PdfSecurityMode
  ): Promise<FileValidationResult> {
    const envelope = await this.validatePdfEnvelope(file);
    if (!envelope.valid) return envelope;

    if (file.size > this.deepPreflightMaxBytes) {
      return {
        valid: true,
        code: 'ok',
        message: 'Large PDF detected. Lightweight validation passed; full structural validation is deferred to the dedicated security Worker to avoid duplicating the large file in browser memory.'
      };
    }

    const inputName = `validation-${this.safeInputName(file.name)}`;
    let buffer: ArrayBuffer;

    try {
      buffer = await file.arrayBuffer();
    } catch {
      return {
        valid: false,
        code: 'invalid-pdf',
        message: 'The PDF could not be read from the browser. Please choose the file again.'
      };
    }

    const bytes = new Uint8Array(buffer);

    const encryptedProbe = await this.runInspection(bytes, inputName, ['--is-encrypted']);
    const encrypted = encryptedProbe.exitCode === 0;

    if (!encrypted && encryptedProbe.exitCode !== 2) {
      return this.classifyInspectionFailure(encryptedProbe, 'The PDF encryption state could not be determined.');
    }

    if (mode === 'protect' && encrypted) {
      return {
        valid: false,
        code: 'encrypted',
        message: 'This PDF is already encrypted/password-protected. Unlock it first with the current password, then protect the unlocked copy.'
      };
    }

    if ((mode === 'unlock' || mode === 'remove-password') && !encrypted) {
      return {
        valid: false,
        code: 'not-encrypted',
        message: 'This PDF is not password-protected, so there is no PDF password to remove.'
      };
    }

    // For encrypted inputs we don't know the password yet. qpdf can identify
    // encryption without it, but a full structural check may legitimately stop
    // at the encrypted content. The actual unlock operation will perform the
    // password-authenticated parse. We therefore avoid falsely labelling a valid
    // encrypted PDF as corrupt at upload time.
    if (encrypted && (mode === 'unlock' || mode === 'remove-password')) {
      return { valid: true, code: 'ok' };
    }

    const check = await this.runInspection(bytes, inputName, ['--check']);
    if (check.exitCode === 0) {
      return { valid: true, code: 'ok' };
    }

    return this.classifyInspectionFailure(
      check,
      'This PDF failed the local PDF structure check and may be damaged or unsupported.'
    );
  }

  /**
   * qpdf structural validation for non-security tools. Use this only after the
   * cheap envelope checks have passed. It intentionally does not inspect
   * encryption because Merge/Split/Compress have different product policies.
   */
  async validatePdfStructure(file: File): Promise<FileValidationResult> {
    const envelope = await this.validatePdfEnvelope(file);
    if (!envelope.valid) return envelope;

    if (file.size > this.deepPreflightMaxBytes) {
      return {
        valid: true,
        code: 'ok',
        message: 'Large PDF detected. Lightweight validation passed; full structural validation is deferred to the processing engine to avoid duplicating the large file in browser memory.'
      };
    }

    try {
      const inputName = `validation-${this.safeInputName(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = await this.runInspection(bytes, inputName, ['--check']);
      if (check.exitCode === 0) return { valid: true, code: 'ok' };
      return this.classifyInspectionFailure(
        check,
        'This PDF failed the local PDF structure check and may be damaged or unsupported.'
      );
    } catch {
      return {
        valid: false,
        code: 'engine-unavailable',
        message: 'The local PDF validation engine is temporarily unavailable. Please try again.'
      };
    }
  }

  /**
   * Minimal upload-admission check. This deliberately validates only the PDF
   * signature (plus the cheap type/empty checks already performed by the
   * selection validator). It does NOT scan for %%EOF, parse xref tables, count
   * pages, decode streams, or invoke qpdf. Valid PDFs can contain incremental
   * updates and other structures that are best judged by the actual operation
   * engine rather than by an upload gate.
   */
  async validateUploadHeader(file: File): Promise<FileValidationResult> {
    const typeResult = this.validateFileType(file);
    if (!typeResult.valid) return typeResult;

    if (file.size <= 0) {
      return {
        valid: false,
        code: 'empty-file',
        message: `${file.name} is empty and cannot be processed.`
      };
    }

    try {
      const header = new Uint8Array(
        await file.slice(0, Math.min(this.headerScanBytes, file.size)).arrayBuffer()
      );
      if (!this.containsAscii(header, '%PDF-')) {
        return {
          valid: false,
          code: 'invalid-header',
          message: `${file.name} does not contain a valid PDF header.`
        };
      }
    } catch {
      return {
        valid: false,
        code: 'invalid-pdf',
        message: `${file.name} could not be read for upload validation.`
      };
    }

    return { valid: true, code: 'ok' };
  }

  /**
   * Backward-compatible alias for callers that need the lightweight upload
   * envelope check. Deep structural validation belongs to validatePdfStructure
   * and validateSecurityContent, not to upload admission.
   */
  async validatePdfEnvelope(file: File): Promise<FileValidationResult> {
    return this.validateUploadHeader(file);
  }

  private async runInspection(
    bytes: Uint8Array,
    inputName: string,
    args: readonly string[]
  ): Promise<QpdfRunResult> {
    return this.qpdf.run({
      inputs: { [inputName]: bytes },
      args: [...args, '--', inputName],
      outputs: []
    });
  }

  private classifyInspectionFailure(
    result: QpdfRunResult,
    fallback: string
  ): FileValidationResult {
    const details = [...result.stderr, ...result.stdout, ...result.warnings]
      .map(line => line.trim())
      .filter(Boolean)
      .join(' ');
    const normalized = details.toLowerCase();

    if (this.looksEncrypted(normalized)) {
      return {
        valid: false,
        code: 'encrypted',
        message: 'This PDF is password-protected. Unlock it first before using this tool.'
      };
    }

    if (this.looksUnsupported(normalized)) {
      return {
        valid: false,
        code: 'unsupported-pdf',
        message: 'This PDF uses a structure or encryption feature that SafePDFHub cannot process reliably.'
      };
    }

    if (result.exitCode === 2) {
      return {
        valid: false,
        code: 'damaged-pdf',
        message: 'This PDF appears damaged or malformed. Please use a repaired/exported copy and try again.'
      };
    }

    if (result.exitCode === 3) {
      return {
        valid: false,
        code: 'damaged-pdf',
        message: 'This PDF contains structural warnings and is not accepted for reliable browser processing. Please export or repair it first.'
      };
    }

    return {
      valid: false,
      code: 'invalid-pdf',
      message: fallback
    };
  }

  private looksEncrypted(message: string): boolean {
    return message.includes('password is required')
      || message.includes('file is encrypted')
      || message.includes('encrypted file')
      || message.includes('requires a password');
  }

  private looksUnsupported(message: string): boolean {
    return message.includes('not supported')
      || message.includes('unsupported')
      || message.includes('cannot open')
      || message.includes('unknown encryption')
      || message.includes('unsupported encryption')
      || message.includes('unknown filter');
  }

  private validateFileType(file: File): FileValidationResult {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return {
        valid: false,
        code: 'invalid-type',
        message: 'Only PDF files are allowed.'
      };
    }
    return { valid: true, code: 'ok' };
  }

  private containsAscii(bytes: Uint8Array, needle: string): boolean {
    const target = Array.from(needle, char => char.charCodeAt(0));
    if (target.length === 0 || bytes.length < target.length) return false;

    outer: for (let i = 0; i <= bytes.length - target.length; i++) {
      for (let j = 0; j < target.length; j++) {
        if (bytes[i + j] !== target[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  private safeInputName(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || 'document.pdf';
  }

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
    return `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;
  }
}

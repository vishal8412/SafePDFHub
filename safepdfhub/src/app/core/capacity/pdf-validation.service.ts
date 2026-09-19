import { Injectable } from '@angular/core';
import { LocalProcessingCapabilityService } from './local-processing-capability.service';
import { FileValidationResult } from './local-processing-capability.model';
import { LargePdfSecurityCapabilityService } from '../security/large-file/large-pdf-security-capability.service';

@Injectable({ providedIn: 'root' })
export class PdfValidationService {
  constructor(
    private readonly capabilityService: LocalProcessingCapabilityService,
    private readonly securityCapability: LargePdfSecurityCapabilityService
  ) {}

  validateSelection(
    file: File,
    existingFiles: readonly File[],
    allowMultiple: boolean
  ): FileValidationResult {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return { valid: false, code: 'invalid-type', message: 'Only PDF files are allowed.' };
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
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return { valid: false, code: 'invalid-type', message: 'Only PDF files are allowed.' };
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

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
    return `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;
  }
}

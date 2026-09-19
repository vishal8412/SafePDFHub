import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface LargePdfSecurityCapability {
  readonly browser: boolean;
  readonly worker: boolean;
  readonly fileApi: boolean;
  readonly opfs: boolean;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
  readonly benchmarkPending: boolean;
}

@Injectable({ providedIn: 'root' })
export class LargePdfSecurityCapabilityService {
  private readonly capability: LargePdfSecurityCapability;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    const browser = isPlatformBrowser(platformId);
    const worker = browser && typeof Worker !== 'undefined';
    const fileApi = browser && typeof File !== 'undefined';
    const opfs = browser && typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

    this.capability = {
      browser,
      worker,
      fileApi,
      opfs,
      // This is an input acceptance target, not a performance guarantee.
      // The engine remains benchmark-gated before we call 1 GB production-safe.
      maxFileBytes: 1024 * 1024 * 1024,
      maxTotalBytes: 1024 * 1024 * 1024,
      maxFiles: 1,
      benchmarkPending: true
    };
  }

  get current(): LargePdfSecurityCapability {
    return this.capability;
  }

  get supported(): boolean {
    return this.capability.browser && this.capability.worker && this.capability.fileApi && this.capability.opfs;
  }

  supportsFile(file: File): boolean {
    return this.supported && file.size <= this.capability.maxFileBytes;
  }
}

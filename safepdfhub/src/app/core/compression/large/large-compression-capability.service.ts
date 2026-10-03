import { Injectable } from '@angular/core';
import { LocalProcessingCapabilityService } from '../../capacity/local-processing-capability.service';
import { compressionBudget, compressionDevice, requiredScratchBytes } from './large-compression-policy';
@Injectable({ providedIn: 'root' })
export class LargeCompressionCapabilityService {
  constructor(private readonly local: LocalProcessingCapabilityService) {}
  get budget() {
    const c = this.local.current;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const supported = typeof Worker !== 'undefined' && !!nav?.storage?.getDirectory && !!nav?.storage?.estimate && !!nav?.locks?.query;
    const device = compressionDevice(nav?.userAgent ?? '', nav?.platform ?? '', nav?.maxTouchPoints ?? 0,
      (nav as (Navigator & { userAgentData?: {mobile?: boolean} }) | undefined)?.userAgentData?.mobile, c.formFactor);
    return compressionBudget(c.memoryGiB, device, supported);
  }
  get maxFileBytes(): number { return this.budget.maxFileBytes; }
  assertFile(file: File): void {
    if (file.size <= 0 || file.size > this.maxFileBytes) throw new Error(
      `This device supports PDFs up to ${this.maxFileBytes / 1_000_000} MB for compression. Use a smaller PDF or a more capable device.`);
  }
  async checkStorage(file: File, imageSearch = false): Promise<void> {
    this.assertFile(file);
    const { quota, usage } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage) || quota! - usage! < requiredScratchBytes(file.size, imageSearch)) {
      throw new Error('Not enough temporary browser storage. Free disk space or use a smaller PDF.');
    }
  }
}

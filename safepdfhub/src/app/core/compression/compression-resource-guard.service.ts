import { Injectable } from '@angular/core';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';

export interface CompressionResourceProfile {
  fileBytes: number;
  pages: number;
  largeWorkload: boolean;
  highWorkload: boolean;
  maxStrategyBranches: 1 | 2 | 3;
}

/**
 * V2 production resource guard.
 *
 * Compression is deliberately sequential, but candidate generation can still
 * multiply the number of large File/PDF representations held by the browser.
 * This guard keeps the branch fan-out bounded as document size/page count grows.
 * It does not reject a document; it only constrains optional exploration.
 */
@Injectable({ providedIn: 'root' })
export class CompressionResourceGuardService {
  constructor(private readonly capability: LocalProcessingCapabilityService) {}

  profile(fileBytes: number, pages: number): CompressionResourceProfile {
    const budget = this.capability.budget;
    const largeWorkload =
      fileBytes >= budget.largeWorkloadBytes || pages >= budget.largeWorkloadPages;
    const highWorkload =
      fileBytes >= Math.min(budget.maxFileBytes, Math.max(budget.largeWorkloadBytes * 0.5, 1)) ||
      pages >= Math.min(budget.maxPages, Math.max(budget.largeWorkloadPages * 0.5, 1));

    return {
      fileBytes,
      pages,
      largeWorkload,
      highWorkload,
      maxStrategyBranches: largeWorkload ? 1 : highWorkload ? 2 : 3,
    };
  }
}

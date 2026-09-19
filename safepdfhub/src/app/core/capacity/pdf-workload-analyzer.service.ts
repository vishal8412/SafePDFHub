import { Injectable } from '@angular/core';
import { LocalProcessingCapabilityService } from './local-processing-capability.service';
import { PdfWorkload, WorkloadAssessment, WorkloadRisk, ProcessingBudget } from './local-processing-capability.model';
import { LargePdfSecurityCapabilityService } from '../security/large-file/large-pdf-security-capability.service';

@Injectable({ providedIn: 'root' })
export class PdfWorkloadAnalyzerService {
  constructor(
    private readonly capabilityService: LocalProcessingCapabilityService,
    private readonly securityCapability: LargePdfSecurityCapabilityService
  ) {}

  assess(files: readonly File[], pageCounts: readonly number[] = []): WorkloadAssessment {
    return this.assessWithBudget(files, pageCounts, this.capabilityService.budget);
  }

  assessSecurity(files: readonly File[], pageCounts: readonly number[] = []): WorkloadAssessment {
    const security = this.securityCapability.current;
    const budget: ProcessingBudget = {
      maxFileBytes: security.maxFileBytes,
      maxTotalBytes: security.maxTotalBytes,
      maxFiles: security.maxFiles,
      // Page capacity remains benchmark-gated for the large engine; do not invent
      // a page ceiling that has not been measured.
      maxPages: Number.MAX_SAFE_INTEGER,
      largeWorkloadBytes: 8 * 1024 * 1024,
      largeWorkloadPages: Number.MAX_SAFE_INTEGER
    };
    return this.assessWithBudget(files, pageCounts, budget);
  }

  private assessWithBudget(
    files: readonly File[],
    pageCounts: readonly number[],
    budget: ProcessingBudget
  ): WorkloadAssessment {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const maxFileBytes = files.reduce((max, file) => Math.max(max, file.size), 0);
    const knownCounts = pageCounts.filter(pageCount => Number.isFinite(pageCount) && pageCount > 0);
    const knownPageCount = knownCounts.length === files.length && files.length > 0;
    const totalPages = knownPageCount ? knownCounts.reduce((sum, pages) => sum + pages, 0) : null;
    const maxPages = knownPageCount ? Math.max(...knownCounts) : null;

    const workload: PdfWorkload = {
      fileCount: files.length,
      totalBytes,
      maxFileBytes,
      totalPages,
      maxPages,
      knownPageCount
    };

    const reasons: string[] = [];
    if (files.length > budget.maxFiles) {
      reasons.push(`Too many files for reliable local processing (maximum ${budget.maxFiles}).`);
    }
    if (maxFileBytes > budget.maxFileBytes) {
      reasons.push(`At least one file exceeds the ${this.formatBytes(budget.maxFileBytes)} local limit.`);
    }
    if (totalBytes > budget.maxTotalBytes) {
      reasons.push(`The combined files exceed the ${this.formatBytes(budget.maxTotalBytes)} local limit.`);
    }
    if (knownPageCount && (maxPages ?? 0) > budget.maxPages) {
      reasons.push(`A PDF exceeds the ${budget.maxPages.toLocaleString()} page local limit.`);
    }

    const sizeRatio = budget.maxTotalBytes > 0 ? totalBytes / budget.maxTotalBytes : 1;
    const fileRatio = budget.maxFileBytes > 0 ? maxFileBytes / budget.maxFileBytes : 1;
    const pageRatio = knownPageCount && budget.maxPages > 0 ? (totalPages ?? 0) / budget.maxPages : 0;
    const score = Math.round(Math.min(100, Math.max(
      sizeRatio * 70,
      fileRatio * 80,
      pageRatio * 100,
      files.length / budget.maxFiles * 35
    )));

    let risk: WorkloadRisk = 'safe';
    if (files.length === 0) return { risk, score: 0, reasons, workload, budget };
    if (reasons.length > 0) {
      risk = 'blocked';
    } else if (
      totalBytes >= budget.largeWorkloadBytes ||
      (knownPageCount && (totalPages ?? 0) >= budget.largeWorkloadPages)
    ) {
      risk = 'large';
    } else if (score >= 80) {
      risk = 'high-risk';
    }

    return { risk, score, reasons, workload, budget };
  }

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }
}

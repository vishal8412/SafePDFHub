import { Injectable } from '@angular/core';
import { QpdfProductionMergeRouterService } from './qpdf-production-merge-router.service';
import { QpdfProductionPilotService } from './qpdf-production-pilot.service';
import type { QpdfProductionPilotConfig } from './qpdf-production-pilot.types';
import type {
  QpdfProductionRoutingValidationReport,
  QpdfProductionRoutingValidationResult,
  QpdfProductionRoutingValidationScenario
} from './qpdf-production-routing-validation.types';

@Injectable({ providedIn: 'root' })
export class QpdfProductionRoutingValidationService {
  private cancelled = false;

  constructor(
    private readonly router: QpdfProductionMergeRouterService,
    private readonly pilotService: QpdfProductionPilotService
  ) {}

  async run(
    files: readonly File[],
    scenarios: readonly QpdfProductionRoutingValidationScenario[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<QpdfProductionRoutingValidationReport> {
    this.cancelled = false;

    if (files.length < 2) {
      throw new Error('Select at least 2 PDFs before validating production routing.');
    }

    const results: QpdfProductionRoutingValidationResult[] = [];
    const pageCounts = await this.readPageCounts(files);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const baseConfig = this.pilotService.getConfig();

    for (let index = 0; index < scenarios.length; index++) {
      if (this.cancelled) break;
      const scenario = scenarios[index];
      const startProgress = Math.round((index / scenarios.length) * 100);
      onProgress?.(startProgress, `Validating ${this.labelFor(scenario)}...`);

      const config = this.configForScenario(baseConfig, scenario);
      const eligibility = this.pilotService.evaluateEligibilityForValidation(
        config,
        files.length,
        totalBytes
      );

      const result = await this.router.validateControlledRoutingPath(
        files,
        pageCounts,
        config,
        scenario === 'qpdf-failure-fallback',
        (progress, message) => {
          const scaled = startProgress + Math.round((progress / 100) * (100 / scenarios.length));
          onProgress?.(Math.min(99, scaled), `${this.labelFor(scenario)}: ${message}`);
        }
      );

      results.push({
        ...result,
        eligibilityAllowed: eligibility.allowed,
        eligibilityReason: eligibility.reason ?? null
      });
    }

    onProgress?.(100, this.cancelled ? 'Production routing validation cancelled.' : 'Production routing validation complete.');

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      passed: results.every(result => result.passed),
      results,
      config: baseConfig,
      safetyNote: 'Validation uses local PDFs only and never changes the production pilot configuration. qpdf execution is forced only inside the development validation scenarios; normal production routing remains governed by the fail-closed configuration.'
    };
  }

  cancel(): void {
    this.cancelled = true;
    this.router.cancel();
  }

  private configForScenario(
    base: QpdfProductionPilotConfig,
    scenario: QpdfProductionRoutingValidationScenario
  ): QpdfProductionPilotConfig {
    switch (scenario) {
      case 'default-blocked':
        return { ...base };
      case 'kill-switch-blocked':
        return {
          ...base,
          enabled: true,
          killSwitch: true,
          humanApprovalRecorded: true,
          rolloutPercent: 100
        };
      case 'capacity-blocked':
        return {
          ...base,
          enabled: true,
          killSwitch: false,
          humanApprovalRecorded: true,
          rolloutPercent: 100,
          maxFiles: 1,
          maxTotalBytes: Math.max(1, base.maxTotalBytes)
        };
      case 'eligible-qpdf':
      case 'qpdf-failure-fallback':
        return {
          ...base,
          enabled: true,
          killSwitch: false,
          humanApprovalRecorded: true,
          rolloutPercent: 100,
          maxFiles: Math.max(base.maxFiles, 40),
          maxTotalBytes: Math.max(base.maxTotalBytes, 400 * 1024 * 1024)
        };
    }
  }

  private labelFor(scenario: QpdfProductionRoutingValidationScenario): string {
    switch (scenario) {
      case 'default-blocked': return 'default production path';
      case 'kill-switch-blocked': return 'kill-switch path';
      case 'capacity-blocked': return 'capacity-block path';
      case 'eligible-qpdf': return 'eligible qpdf path';
      case 'qpdf-failure-fallback': return 'qpdf failure fallback path';
    }
  }

  private async readPageCounts(files: readonly File[]): Promise<number[]> {
    const { PDFDocument } = await import('pdf-lib');
    const counts: number[] = [];
    for (const file of files) {
      const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      counts.push(document.getPageCount());
    }
    return counts;
  }
}

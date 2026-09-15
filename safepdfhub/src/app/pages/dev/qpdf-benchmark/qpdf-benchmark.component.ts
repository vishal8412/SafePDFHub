import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QpdfBenchmarkService } from '../../../core/qpdf/qpdf-benchmark.service';
import { QpdfBenchmarkEvidenceService } from '../../../core/qpdf/qpdf-benchmark-evidence.service';
import type {
  QpdfBenchmarkComplexity,
  QpdfBenchmarkResult
} from '../../../core/qpdf/qpdf-benchmark.types';
import type {
  QpdfBenchmarkEvidenceRecord,
  QpdfBenchmarkEvidenceSummary
} from '../../../core/qpdf/qpdf-benchmark-evidence.types';
import { QpdfProductionGateService } from '../../../core/qpdf/qpdf-production-gate.service';
import type { QpdfProductionGateResult } from '../../../core/qpdf/qpdf-production-gate.types';
import { QpdfBenchmarkPlanService } from '../../../core/qpdf/qpdf-benchmark-plan.service';
import { QpdfSoakService } from '../../../core/qpdf/qpdf-soak.service';
import type { QpdfSoakResult } from '../../../core/qpdf/qpdf-soak.types';
import type { QpdfBenchmarkPlanResult } from '../../../core/qpdf/qpdf-benchmark-plan.types';
import { QpdfCorpusHardeningService } from '../../../core/qpdf/qpdf-corpus-hardening.service';
import type { QpdfCorpusHardeningResult } from '../../../core/qpdf/qpdf-corpus-hardening.types';
import { QpdfFinalDecisionService } from '../../../core/qpdf/qpdf-final-decision.service';
import type { QpdfFinalDecisionResult } from '../../../core/qpdf/qpdf-final-decision.types';
import { QpdfControlledFallbackPilotService } from '../../../core/qpdf/qpdf-controlled-fallback-pilot.service';
import type { QpdfControlledFallbackPilotResult } from '../../../core/qpdf/qpdf-controlled-fallback-pilot.types';
import { QpdfProductionPilotService } from '../../../core/qpdf/qpdf-production-pilot.service';
import { QpdfProductionRoutingValidationService } from '../../../core/qpdf/qpdf-production-routing-validation.service';
import type { QpdfProductionRoutingValidationReport, QpdfProductionRoutingValidationScenario } from '../../../core/qpdf/qpdf-production-routing-validation.types';
import type { QpdfProductionPilotEligibility, QpdfProductionPilotTelemetryEvent } from '../../../core/qpdf/qpdf-production-pilot.types';
import type { QpdfProductionPilotKillSwitchValidation, QpdfProductionPilotObservabilitySnapshot } from '../../../core/qpdf/qpdf-production-pilot-observability.types';
import { QpdfPhase0dFinalService } from '../../../core/qpdf/qpdf-phase0d-final.service';
import type { QpdfPhase0dFinalReport } from '../../../core/qpdf/qpdf-phase0d-final.types';

@Component({
  selector: 'app-qpdf-benchmark',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './qpdf-benchmark.component.html',
  styles: [`
    :host { display: block; min-height: 100vh; background: #061727; color: #eaf7ff; padding: 32px; font-family: Inter, system-ui, sans-serif; }
    .shell { max-width: 1080px; margin: 0 auto; }
    h1 { margin: 0 0 8px; }
    h2 { margin: 0 0 14px; }
    h3 { margin: 22px 0 10px; }
    p { color: #9eb4c7; line-height: 1.6; }
    .panel { margin-top: 24px; padding: 24px; border: 1px solid rgba(89,191,255,.22); border-radius: 16px; background: rgba(10,31,48,.86); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric { padding: 14px; border: 1px solid rgba(89,191,255,.16); border-radius: 12px; background: rgba(6,23,39,.7); }
    .metric span { display: block; color: #9eb4c7; font-size: 12px; margin-bottom: 5px; }
    .metric strong { font-variant-numeric: tabular-nums; }
    input, select { width: 100%; box-sizing: border-box; margin: 12px 0; padding: 10px; border-radius: 9px; border: 1px solid #31516a; background: #081d2e; color: #eaf7ff; }
    .pilot-panel input[type='checkbox'] { width: auto; margin: 0 8px 0 0; padding: 0; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; cursor: pointer; background: #19ead3; color: #061727; font-weight: 700; margin-right: 8px; }
    button.secondary { background: #17384e; color: #eaf7ff; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .progress { margin-top: 18px; height: 8px; overflow: hidden; border-radius: 99px; background: #102d42; }
    .progress > div { height: 100%; background: #19ead3; transition: width .15s ease; }
    .pass { color: #19ead3; }
    .warn { color: #ffd58a; }
    .fail { color: #ff9d9d; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; margin: 0; }
    dt { color: #9eb4c7; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid rgba(89,191,255,.12); }
    th { color: #9eb4c7; font-size: 12px; }
    .note { font-size: 13px; margin-top: 18px; }
    .table-note { color: #7f9caf; font-size: 12px; line-height: 1.4; }
    .evidence-heading { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
    .evidence-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .file-button { display: inline-flex; align-items: center; border: 0; border-radius: 10px; padding: 11px 16px; cursor: pointer; font-weight: 700; margin-right: 8px; }
    .danger { background: #4a2630; color: #ffdfe3; }
    .tiny { padding: 6px 9px; margin: 0; font-size: 12px; }
    .evidence-message { color: #8ff8df; }
    .empty { padding: 16px; border: 1px dashed rgba(89,191,255,.2); border-radius: 10px; }
    .decision-panel li, .gate-list li { color: #9eb4c7; margin: 8px 0; line-height: 1.5; }
    .routing-validation-panel table { margin-top: 16px; }
    .gate-panel h3 { margin-top: 18px; }
    .final-decision-panel h3 { margin-top: 18px; }
    .final-decision-panel dd.pass, .final-decision-panel dd.fail { font-weight: 700; }
    @media (max-width: 760px) { .grid, .metric-grid { grid-template-columns: 1fr; } .evidence-heading { flex-direction: column; } .evidence-actions { justify-content: flex-start; } :host { padding: 18px; } }
  `]
})
export class QpdfBenchmarkComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly benchmarkService = inject(QpdfBenchmarkService);
  private readonly evidenceService = inject(QpdfBenchmarkEvidenceService);
  private readonly productionGateService = inject(QpdfProductionGateService);
  private readonly benchmarkPlanService = inject(QpdfBenchmarkPlanService);
  private readonly soakService = inject(QpdfSoakService);
  private readonly corpusHardeningService = inject(QpdfCorpusHardeningService);
  private readonly finalDecisionService = inject(QpdfFinalDecisionService);
  private readonly fallbackPilotService = inject(QpdfControlledFallbackPilotService);
  private readonly productionPilotService = inject(QpdfProductionPilotService);
  private readonly routingValidationService = inject(QpdfProductionRoutingValidationService);
  private readonly phase0dFinalService = inject(QpdfPhase0dFinalService);

  selectedFiles: File[] = [];
  complexity: QpdfBenchmarkComplexity = 'unknown';
  progress = 0;
  statusMessage = 'Select at least two PDFs.';
  running = false;
  result: QpdfBenchmarkResult | null = null;
  evidenceRecords: QpdfBenchmarkEvidenceRecord[] = [];
  evidenceSummary: QpdfBenchmarkEvidenceSummary = this.evidenceService.summarize([]);
  evidenceMessage = '';
  productionGate: QpdfProductionGateResult = this.productionGateService.evaluate({ records: [] });
  benchmarkPlan: QpdfBenchmarkPlanResult = this.benchmarkPlanService.evaluate({ records: [] });
  soakIterations = 5;
  soakCooldownMs = 1000;
  soakProgress = 0;
  soakStatusMessage = 'Select at least two PDFs to begin a repeated-run soak test.';
  soakRunning = false;
  soakResult: QpdfSoakResult | null = null;
  corpusHardening: QpdfCorpusHardeningResult = this.corpusHardeningService.evaluate({ records: [] });
  finalDecision: QpdfFinalDecisionResult = this.finalDecisionService.evaluate({
    productionGate: this.productionGate,
    corpusHardening: this.corpusHardening
  });
  fallbackPilotEnabled = false;
  fallbackPilotRunning = false;
  fallbackPilotProgress = 0;
  fallbackPilotStatusMessage = 'Enable the pilot explicitly for an internal test only.';
  fallbackPilotResult: QpdfControlledFallbackPilotResult | null = null;
  productionPilotEligibility: QpdfProductionPilotEligibility = this.productionPilotService.evaluateEligibility(0, 0);
  productionPilotTelemetry: QpdfProductionPilotTelemetryEvent[] = this.productionPilotService.getTelemetry();
  productionPilotObservability: QpdfProductionPilotObservabilitySnapshot = this.productionPilotService.getObservabilitySnapshot();
  killSwitchValidation: QpdfProductionPilotKillSwitchValidation | null = null;
  routingValidationRunning = false;
  routingValidationProgress = 0;
  routingValidationStatusMessage = 'Run the controlled validation against the selected local PDFs.';
  routingValidationReport: QpdfProductionRoutingValidationReport | null = null;
  phase0dFinalReport: QpdfPhase0dFinalReport = this.phase0dFinalService.evaluate(
    this.finalDecision,
    this.productionPilotService.getConfig()
  );
  routingValidationScenarios: QpdfProductionRoutingValidationScenario[] = [
    'default-blocked',
    'kill-switch-blocked',
    'capacity-blocked',
    'eligible-qpdf',
    'qpdf-failure-fallback'
  ];

  readonly complexityOptions: Array<{ value: QpdfBenchmarkComplexity; label: string }> = [
    { value: 'unknown', label: 'Unknown / mixed' },
    { value: 'text-light', label: 'Text-light' },
    { value: 'font-heavy', label: 'Font-heavy' },
    { value: 'image-heavy', label: 'Image-heavy' },
    { value: 'scanned', label: 'Scanned / image-based' },
    { value: 'encrypted', label: 'Encrypted / password-protected' },
    { value: 'malformed', label: 'Malformed / intentionally invalid' },
    { value: 'mixed', label: 'Mixed real-world' }
  ];

  get browserAvailable(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  get requiredDeviceCoverageCount(): number {
    return this.benchmarkPlan.devices.filter(
      device => device.priority === 'required' && device.covered
    ).length;
  }

  get requiredDeviceTargetCount(): number {
    return this.benchmarkPlan.devices.filter(
      device => device.priority === 'required'
    ).length;
  }

  ngOnInit(): void {
    this.refreshEvidence();
    this.refreshProductionPilotEligibility();
  }

  private refreshEvidence(): void {
    this.evidenceRecords = this.evidenceService.load();
    this.evidenceSummary = this.evidenceService.summarize(this.evidenceRecords);
    this.productionGate = this.productionGateService.evaluate({ records: this.evidenceRecords });
    this.benchmarkPlan = this.benchmarkPlanService.evaluate({ records: this.evidenceRecords });
    this.corpusHardening = this.corpusHardeningService.evaluate({ records: this.evidenceRecords });
    this.finalDecision = this.finalDecisionService.evaluate({
      productionGate: this.productionGate,
      corpusHardening: this.corpusHardening
    });
    this.phase0dFinalReport = this.phase0dFinalService.evaluate(
      this.finalDecision,
      this.productionPilotService.getConfig()
    );
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
    this.result = null;
    this.progress = 0;
    this.statusMessage = this.selectedFiles.length >= 2
      ? `${this.selectedFiles.length} PDFs selected.`
      : 'Select at least two PDFs.';
    this.refreshProductionPilotEligibility();
  }

  async run(): Promise<void> {
    if (!this.browserAvailable || this.selectedFiles.length < 2 || this.running) return;

    this.running = true;
    this.result = null;
    this.progress = 0;

    try {
      this.result = await this.benchmarkService.run(
        this.selectedFiles,
        this.complexity,
        (progress, message) => {
          this.progress = progress;
          this.statusMessage = message;
        }
      );

      if (this.result.status === 'completed') {
        const saved = this.evidenceService.save(this.result);
        this.refreshEvidence();
        this.evidenceMessage = saved
          ? 'Benchmark result saved locally. No PDF bytes were stored.'
          : 'Benchmark completed, but local evidence storage was unavailable.';
      }
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Benchmark failed.';
    } finally {
      this.running = false;
    }
  }

  cancel(): void {
    if (!this.running) return;
    this.statusMessage = 'Cancellation requested...';
    this.benchmarkService.cancel();
  }

  async runSoak(): Promise<void> {
    if (!this.browserAvailable || this.selectedFiles.length < 2 || this.running || this.soakRunning) return;

    this.soakRunning = true;
    this.soakResult = null;
    this.soakProgress = 0;
    this.soakStatusMessage = 'Preparing repeated-run soak test...';

    try {
      this.soakResult = await this.soakService.run(
        this.selectedFiles,
        this.complexity,
        this.soakIterations,
        this.soakCooldownMs,
        (progress, message) => {
          this.soakProgress = progress;
          this.soakStatusMessage = message;
        }
      );
      this.refreshEvidence();
    } catch (error) {
      this.soakStatusMessage = error instanceof Error
        ? error.message
        : 'Soak test failed.';
    } finally {
      this.soakRunning = false;
    }
  }

  cancelSoak(): void {
    if (!this.soakRunning) return;
    this.soakStatusMessage = 'Soak cancellation requested...';
    this.soakService.cancel();
  }

  async runProductionRoutingValidation(): Promise<void> {
    if (!this.browserAvailable || this.selectedFiles.length < 2 || this.routingValidationRunning) return;

    this.routingValidationRunning = true;
    this.routingValidationProgress = 0;
    this.routingValidationReport = null;
    this.routingValidationStatusMessage = 'Preparing controlled production routing validation...';

    try {
      this.routingValidationReport = await this.routingValidationService.run(
        this.selectedFiles,
        this.routingValidationScenarios,
        (progress, message) => {
          this.routingValidationProgress = progress;
          this.routingValidationStatusMessage = message;
        }
      );
    } catch (error) {
      this.routingValidationStatusMessage = error instanceof Error
        ? error.message
        : 'Production routing validation failed.';
    } finally {
      this.routingValidationRunning = false;
    }
  }

  cancelProductionRoutingValidation(): void {
    if (!this.routingValidationRunning) return;
    this.routingValidationStatusMessage = 'Production routing validation cancellation requested...';
    this.routingValidationService.cancel();
  }

  routingScenarioLabel(scenario: QpdfProductionRoutingValidationScenario): string {
    switch (scenario) {
      case 'default-blocked': return 'Default production path';
      case 'kill-switch-blocked': return 'Kill-switch blocked path';
      case 'capacity-blocked': return 'Capacity blocked path';
      case 'eligible-qpdf': return 'Eligible qpdf path';
      case 'qpdf-failure-fallback': return 'qpdf failure → pdf-lib fallback';
    }
  }

  exportEvidence(): void {
    if (!this.browserAvailable || this.evidenceRecords.length === 0) return;
    this.evidenceService.exportJson(this.evidenceRecords);
    this.evidenceMessage = 'Evidence export created. It contains benchmark metadata/results only, not PDF bytes.';
  }

  async importEvidence(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const imported = await this.evidenceService.importJson(file);
      this.refreshEvidence();
      this.evidenceMessage = `${imported} evidence record${imported === 1 ? '' : 's'} imported.`;
    } catch (error) {
      this.evidenceMessage = error instanceof Error
        ? error.message
        : 'Evidence import failed.';
    }
  }

  clearEvidence(): void {
    if (this.evidenceRecords.length === 0) return;
    this.evidenceService.clear();
    this.refreshEvidence();
    this.evidenceMessage = 'Local benchmark evidence cleared.';
  }

  deleteEvidence(id: string): void {
    this.evidenceService.remove(id);
    this.refreshEvidence();
  }

  formatDeviceClass(value: QpdfBenchmarkEvidenceRecord['deviceClass']): string {
    switch (value) {
      case 'desktop-high-end': return 'Desktop high-end';
      case 'desktop-standard': return 'Desktop standard';
      case 'mobile': return 'Mobile';
      case 'tablet': return 'Tablet';
      default: return 'Unknown';
    }
  }

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  formatBytes(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  formatSignedBytes(bytes: number | null): string {
    if (bytes === null) return '—';
    const sign = bytes > 0 ? '+' : '';
    return `${sign}${this.formatBytes(Math.abs(bytes))}`;
  }

  formatNumber(value: number | null): string {
    return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  formatMs(value: number | null): string {
    return value === null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms`;
  }

  formatPercent(value: number | null): string {
    return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  }

  gateStatusClass(): string {
    switch (this.productionGate.status) {
      case 'primary-review-ready':
      case 'fallback-review-ready':
        return 'pass';
      case 'blocked-by-failures':
      case 'review-required':
        return 'fail';
      default:
        return 'warn';
    }
  }

  formatGateDeviceClasses(): string {
    return this.productionGate.deviceClasses.length > 0
      ? this.productionGate.deviceClasses.map(value => this.formatDeviceClass(value)).join(', ')
      : 'None';
  }

  formatGateComplexityClasses(): string {
    return this.productionGate.complexityClasses.length > 0
      ? this.productionGate.complexityClasses.join(', ')
      : 'None';
  }

  status(value: boolean | null): string {
    return value === null ? 'N/A' : value ? 'YES' : 'NO';
  }

  exportCorpusHardening(): void {
    if (!this.browserAvailable || this.evidenceRecords.length === 0) return;
    this.corpusHardeningService.exportJson(this.corpusHardening, this.evidenceRecords);
    this.evidenceMessage = 'Phase 0D.14 corpus hardening report exported. It contains metadata only, not PDF bytes.';
  }

  corpusRequirementClass(covered: boolean): string {
    return covered ? 'pass' : 'warn';
  }

  formatCorpusPercent(value: number | null): string {
    return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  }


  private refreshProductionPilotEligibility(): void {
    const inputBytes = this.selectedFiles.reduce((sum, file) => sum + file.size, 0);
    this.productionPilotEligibility = this.productionPilotService.evaluateEligibility(
      this.selectedFiles.length,
      inputBytes
    );
    this.productionPilotTelemetry = this.productionPilotService.getTelemetry();
    this.productionPilotObservability = this.productionPilotService.getObservabilitySnapshot();
  }

  runKillSwitchValidation(): void {
    this.killSwitchValidation = this.productionPilotService.validateKillSwitch();
  }

  refreshProductionPilotObservability(): void {
    this.productionPilotTelemetry = this.productionPilotService.getTelemetry();
    this.productionPilotObservability = this.productionPilotService.getObservabilitySnapshot();
  }

  productionPilotBlockReason(): string {
    switch (this.productionPilotEligibility.reason) {
      case 'disabled': return 'Pilot is disabled by configuration.';
      case 'kill-switch': return 'Global qpdf kill switch is active.';
      case 'approval-required': return 'Explicit human approval has not been recorded.';
      case 'rollout-not-selected': return 'This session is outside the configured rollout percentage.';
      case 'capacity-exceeded': return 'The selected workload exceeds the pilot safety envelope.';
      default: return 'Pilot is eligible for this workload.';
    }
  }

  exportPhase0dFinalReport(): void {
    if (!this.browserAvailable) return;
    this.phase0dFinalService.exportJson(this.phase0dFinalReport);
    this.evidenceMessage = 'Phase 0D consolidated status exported. It contains metadata only, not PDF bytes.';
  }

  exportProductionPilotTelemetry(): void {
    this.productionPilotService.exportTelemetry();
  }

  exportProductionPilotObservability(): void {
    this.productionPilotService.exportObservability();
  }

  clearProductionPilotTelemetry(): void {
    this.productionPilotService.clearTelemetry();
    this.productionPilotTelemetry = [];
    this.productionPilotObservability = this.productionPilotService.getObservabilitySnapshot();
  }


  async runFallbackPilot(): Promise<void> {
    if (!this.browserAvailable || !this.fallbackPilotEnabled || this.selectedFiles.length < 2 || this.running || this.soakRunning || this.fallbackPilotRunning) return;

    this.fallbackPilotRunning = true;
    this.fallbackPilotResult = null;
    this.fallbackPilotProgress = 0;
    this.fallbackPilotStatusMessage = 'Preparing controlled fallback pilot...';

    try {
      this.fallbackPilotResult = await this.fallbackPilotService.run(this.selectedFiles, {
        enabled: true,
        usePdfLibWorkerFallback: true,
        onProgress: (progress, message) => {
          this.fallbackPilotProgress = progress;
          this.fallbackPilotStatusMessage = message;
        }
      });
      this.productionPilotService.record({
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        outcome: this.fallbackPilotResult.outcome,
        inputFileCount: this.fallbackPilotResult.inputFileCount,
        inputBytes: this.fallbackPilotResult.inputBytes,
        inputPageCount: this.fallbackPilotResult.inputPageCount,
        qpdfAttempted: this.fallbackPilotResult.qpdfAttempted,
        qpdfSucceeded: this.fallbackPilotResult.qpdfSucceeded,
        fallbackUsed: this.fallbackPilotResult.fallbackUsed,
        hardFidelityPassed: this.fallbackPilotResult.hardFidelityPassed,
        elapsedMs: this.fallbackPilotResult.elapsedMs,
        failureCode: this.fallbackPilotResult.outcome === 'failed'
          ? 'pilot-failed'
          : this.fallbackPilotResult.outcome === 'cancelled'
            ? 'pilot-cancelled'
            : undefined
      });
      this.productionPilotTelemetry = this.productionPilotService.getTelemetry();
      this.productionPilotObservability = this.productionPilotService.getObservabilitySnapshot();
    } catch (error) {
      this.fallbackPilotStatusMessage = error instanceof Error
        ? error.message
        : 'Controlled fallback pilot failed.';
    } finally {
      this.fallbackPilotRunning = false;
    }
  }

  cancelFallbackPilot(): void {
    if (!this.fallbackPilotRunning) return;
    this.fallbackPilotStatusMessage = 'Pilot cancellation requested...';
    this.fallbackPilotService.cancel();
  }

  fallbackPilotOutcomeLabel(): string {
    switch (this.fallbackPilotResult?.outcome) {
      case 'qpdf-success': return 'qpdf path succeeded';
      case 'pdf-lib-fallback': return 'pdf-lib Worker fallback used';
      case 'cancelled': return 'Cancelled';
      case 'failed': return 'Pilot failed';
      default: return '—';
    }
  }

  exportFinalDecision(): void {
    if (!this.browserAvailable) return;
    this.finalDecisionService.exportJson(this.finalDecision);
    this.evidenceMessage = 'Final engineering decision report exported. It contains metadata only, not PDF bytes.';
  }

  finalDecisionStatusClass(): string {
    switch (this.finalDecision.status) {
      case 'fallback-pilot-candidate':
      case 'primary-experiment-candidate':
        return 'pass';
      case 'blocked':
        return 'fail';
      default:
        return 'warn';
    }
  }

  finalDecisionRoleLabel(): string {
    switch (this.finalDecision.recommendedProductionRole) {
      case 'controlled-fallback-pilot': return 'Controlled fallback pilot';
      case 'primary-engine-experiment': return 'Controlled primary-engine experiment';
      default: return 'Prototype only';
    }
  }
}

import { Injectable } from '@angular/core';
import { QPDF_PRODUCTION_PILOT_CONFIG } from './qpdf-production-pilot.config';
import type {
  QpdfProductionPilotConfig,
  QpdfProductionPilotEligibility,
  QpdfProductionPilotTelemetryEvent
} from './qpdf-production-pilot.types';
import type {
  QpdfProductionPilotControlProbe,
  QpdfProductionPilotKillSwitchValidation,
  QpdfProductionPilotObservabilityExport,
  QpdfProductionPilotObservabilitySnapshot
} from './qpdf-production-pilot-observability.types';

@Injectable({ providedIn: 'root' })
export class QpdfProductionPilotService {
  private readonly config: QpdfProductionPilotConfig = {
    ...QPDF_PRODUCTION_PILOT_CONFIG
  };

  private readonly sessionBucket = this.createSessionBucket();
  private readonly telemetry: QpdfProductionPilotTelemetryEvent[] = [];
  private readonly maxTelemetryEvents = 100;

  getConfig(): QpdfProductionPilotConfig {
    return { ...this.config };
  }

  evaluateEligibility(inputFileCount: number, inputBytes: number): QpdfProductionPilotEligibility {
    return this.evaluateWithConfig(this.config, inputFileCount, inputBytes);
  }

  /** Development validation hook. It evaluates a supplied test configuration without mutating production configuration. */
  evaluateEligibilityForValidation(
    config: QpdfProductionPilotConfig,
    inputFileCount: number,
    inputBytes: number
  ): QpdfProductionPilotEligibility {
    return this.evaluateWithConfig({ ...config }, inputFileCount, inputBytes);
  }

  validateKillSwitch(): QpdfProductionPilotKillSwitchValidation {
    const baseline = this.getConfig();
    const enabledConfig: QpdfProductionPilotConfig = {
      ...baseline,
      enabled: true,
      killSwitch: true,
      humanApprovalRecorded: true,
      rolloutPercent: 100
    };
    const killSwitchProbe = this.evaluateWithConfig(enabledConfig, 2, 1024);

    const approvalConfig: QpdfProductionPilotConfig = {
      ...baseline,
      enabled: true,
      killSwitch: false,
      humanApprovalRecorded: false,
      rolloutPercent: 100
    };
    const approvalProbe = this.evaluateWithConfig(approvalConfig, 2, 1024);

    const capacityConfig: QpdfProductionPilotConfig = {
      ...baseline,
      enabled: true,
      killSwitch: false,
      humanApprovalRecorded: true,
      rolloutPercent: 100,
      maxFiles: 1,
      maxTotalBytes: 1024
    };
    const capacityProbe = this.evaluateWithConfig(capacityConfig, 2, 1025);

    const rolloutConfig: QpdfProductionPilotConfig = {
      ...baseline,
      enabled: true,
      killSwitch: false,
      humanApprovalRecorded: true,
      rolloutPercent: 0
    };
    const rolloutProbe = this.evaluateWithConfig(rolloutConfig, 2, 1024);

    const checks = [
      {
        id: 'default-fail-closed' as const,
        label: 'Default configuration is fail-closed',
        passed: baseline.enabled === false && baseline.killSwitch === true &&
          baseline.rolloutPercent === 0 && baseline.humanApprovalRecorded === false,
        expected: 'disabled + kill switch ON + 0% rollout + no approval',
        observed: `${baseline.enabled ? 'enabled' : 'disabled'} + kill switch ${baseline.killSwitch ? 'ON' : 'OFF'} + ${baseline.rolloutPercent}% rollout + ${baseline.humanApprovalRecorded ? 'approval' : 'no approval'}`
      },
      {
        id: 'kill-switch-dominates' as const,
        label: 'Kill switch blocks an otherwise eligible workload',
        passed: !killSwitchProbe.allowed && killSwitchProbe.reason === 'kill-switch',
        expected: 'blocked: kill-switch',
        observed: killSwitchProbe.allowed ? 'allowed' : `blocked: ${killSwitchProbe.reason ?? 'unknown'}`
      },
      {
        id: 'approval-required' as const,
        label: 'Missing human approval blocks the pilot',
        passed: !approvalProbe.allowed && approvalProbe.reason === 'approval-required',
        expected: 'blocked: approval-required',
        observed: approvalProbe.allowed ? 'allowed' : `blocked: ${approvalProbe.reason ?? 'unknown'}`
      },
      {
        id: 'capacity-envelope' as const,
        label: 'Workload outside the pilot envelope is blocked',
        passed: !capacityProbe.allowed && capacityProbe.reason === 'capacity-exceeded',
        expected: 'blocked: capacity-exceeded',
        observed: capacityProbe.allowed ? 'allowed' : `blocked: ${capacityProbe.reason ?? 'unknown'}`
      },
      {
        id: 'rollout-zero-blocks' as const,
        label: 'Zero-percent rollout blocks the pilot',
        passed: !rolloutProbe.allowed && rolloutProbe.reason === 'rollout-not-selected',
        expected: 'blocked: rollout-not-selected',
        observed: rolloutProbe.allowed ? 'allowed' : `blocked: ${rolloutProbe.reason ?? 'unknown'}`
      }
    ];

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      passed: checks.every(check => check.passed),
      checks,
      baselineConfig: baseline,
      safetyNote: 'Validation exercises configuration logic only. It never executes qpdf, changes configuration, or processes PDF bytes.'
    };
  }

  getObservabilitySnapshot(): QpdfProductionPilotObservabilitySnapshot {
    const events = this.getTelemetry();
    const qpdfAttemptCount = events.filter(event => event.qpdfAttempted).length;
    const qpdfSuccessCount = events.filter(event => event.outcome === 'qpdf-success').length;
    const fallbackCount = events.filter(event => event.outcome === 'pdf-lib-fallback').length;
    const failedCount = events.filter(event => event.outcome === 'failed').length;
    const cancelledCount = events.filter(event => event.outcome === 'cancelled').length;
    const blockedCount = events.filter(event => event.outcome === 'blocked').length;
    const hardFidelityFailureCount = events.filter(event => event.hardFidelityPassed === false).length;
    const failureCodes: Record<string, number> = {};

    for (const event of events) {
      if (!event.failureCode) continue;
      failureCodes[event.failureCode] = (failureCodes[event.failureCode] ?? 0) + 1;
    }

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      totalEvents: events.length,
      qpdfSuccessCount,
      fallbackCount,
      failedCount,
      cancelledCount,
      blockedCount,
      qpdfAttemptCount,
      qpdfSuccessRate: qpdfAttemptCount === 0 ? null : qpdfSuccessCount / qpdfAttemptCount,
      fallbackRateAmongAttempts: qpdfAttemptCount === 0 ? null : fallbackCount / qpdfAttemptCount,
      hardFidelityFailureCount,
      failureCodes,
      lastEventAt: events.length > 0 ? events[events.length - 1].recordedAt : null
    };
  }

  getControlProbe(inputFileCount: number, inputBytes: number): QpdfProductionPilotControlProbe {
    const result = this.evaluateEligibility(inputFileCount, inputBytes);
    return {
      allowed: result.allowed,
      reason: result.reason,
      sessionBucket: result.sessionBucket
    };
  }

  record(event: QpdfProductionPilotTelemetryEvent): void {
    this.telemetry.push({ ...event });
    if (this.telemetry.length > this.maxTelemetryEvents) {
      this.telemetry.splice(0, this.telemetry.length - this.maxTelemetryEvents);
    }
  }

  getTelemetry(): QpdfProductionPilotTelemetryEvent[] {
    return this.telemetry.map(event => ({ ...event }));
  }

  clearTelemetry(): void {
    this.telemetry.length = 0;
  }

  exportTelemetry(): void {
    if (typeof window === 'undefined') return;

    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      config: this.getConfig(),
      events: this.getTelemetry(),
      privacyNote: 'Pilot telemetry contains metadata/results only. PDF bytes, filenames, and document content are not included.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-qpdf-pilot-telemetry-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  exportObservability(): void {
    if (typeof window === 'undefined') return;

    const payload: QpdfProductionPilotObservabilityExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: this.getObservabilitySnapshot(),
      killSwitchValidation: this.validateKillSwitch(),
      config: this.getConfig(),
      events: this.getTelemetry(),
      privacyNote: 'Production-pilot observability contains metadata/results only. PDF bytes, filenames, and document content are not included.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-qpdf-pilot-observability-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private evaluateWithConfig(
    config: QpdfProductionPilotConfig,
    inputFileCount: number,
    inputBytes: number
  ): QpdfProductionPilotEligibility {
    if (!config.enabled) {
      return { allowed: false, reason: 'disabled', sessionBucket: this.sessionBucket, config: { ...config } };
    }
    if (config.killSwitch) {
      return { allowed: false, reason: 'kill-switch', sessionBucket: this.sessionBucket, config: { ...config } };
    }
    if (!config.humanApprovalRecorded) {
      return { allowed: false, reason: 'approval-required', sessionBucket: this.sessionBucket, config: { ...config } };
    }
    if (inputFileCount > config.maxFiles || inputBytes > config.maxTotalBytes) {
      return { allowed: false, reason: 'capacity-exceeded', sessionBucket: this.sessionBucket, config: { ...config } };
    }
    if (this.sessionBucket >= config.rolloutPercent) {
      return { allowed: false, reason: 'rollout-not-selected', sessionBucket: this.sessionBucket, config: { ...config } };
    }
    return { allowed: true, sessionBucket: this.sessionBucket, config: { ...config } };
  }

  private createSessionBucket(): number {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] % 100;
    }

    return Math.floor(Math.random() * 100);
  }

  private fileDateStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

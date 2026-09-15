import type { QpdfProductionPilotConfig } from './qpdf-production-pilot.types';

/**
 * Production-pilot defaults are fail-closed.
 *
 * This is intentionally a static safety configuration for the current
 * browser-only product. A future operational rollout should replace these
 * values with a trusted server/remote configuration mechanism without ever
 * accepting PDF bytes as part of the configuration or telemetry channel.
 */
export const QPDF_PRODUCTION_PILOT_CONFIG: QpdfProductionPilotConfig = {
  enabled: false,
  killSwitch: true,
  rolloutPercent: 0,
  humanApprovalRecorded: false,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFiles: 10
};

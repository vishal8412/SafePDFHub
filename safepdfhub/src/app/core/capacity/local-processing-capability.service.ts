import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  DeviceFormFactor,
  DeviceMemoryClass,
  LocalProcessingCapability,
  ProcessingBudget,
  ProcessingCapacityTier
} from './local-processing-capability.model';

/**
 * Central source of truth for local PDF-processing capacity.
 *
 * The current JS/pdf-lib engine has not yet been benchmarked enough to safely
 * unlock multi-gigabyte workloads. A conservative engine ceiling is therefore
 * applied today. Higher device budgets remain encoded here so the same API can
 * be unlocked after the Worker/WASM benchmark phase.
 */
@Injectable({ providedIn: 'root' })
export class LocalProcessingCapabilityService {
  private readonly browser: boolean;
  private readonly capability: LocalProcessingCapability;

  private readonly engineCeiling: ProcessingBudget = {
    maxFileBytes: 100 * 1024 * 1024,
    maxTotalBytes: 400 * 1024 * 1024,
    maxFiles: 40,
    maxPages: 40_000,
    largeWorkloadBytes: 300 * 1024 * 1024,
    largeWorkloadPages: 10_000
  };

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
    this.capability = this.detectCapability();
  }

  get current(): LocalProcessingCapability {
    return this.capability;
  }

  get budget(): ProcessingBudget {
    return this.capability.budget;
  }

  get isBrowser(): boolean {
    return this.browser;
  }

  private detectCapability(): LocalProcessingCapability {
    if (!this.browser) {
      return this.buildCapability('unknown', null, null, 'unknown', false, 'conservative');
    }

    const nav = navigator as Navigator & {
      deviceMemory?: number;
      userAgentData?: { mobile?: boolean };
    };

    const rawMemory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
      ? nav.deviceMemory
      : null;
    const memoryClass = this.toMemoryClass(rawMemory);
    const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null;
    const formFactor = this.detectFormFactor(nav.userAgentData?.mobile);
    const tier = this.resolveTier(memoryClass, hardwareConcurrency);

    return this.buildCapability(
      memoryClass,
      rawMemory,
      hardwareConcurrency,
      formFactor,
      rawMemory !== null,
      tier
    );
  }

  private buildCapability(
    memoryClass: DeviceMemoryClass,
    memoryGiB: number | null,
    hardwareConcurrency: number | null,
    formFactor: DeviceFormFactor,
    browserSupportsDeviceMemory: boolean,
    tier: ProcessingCapacityTier
  ): LocalProcessingCapability {
    const budget = this.applyEngineCeiling(this.deviceBudget(tier), formFactor);

    return {
      memoryClass,
      memoryGiB,
      hardwareConcurrency,
      formFactor,
      tier,
      browserSupportsDeviceMemory,
      benchmarkPending: true,
      budget
    };
  }

  private toMemoryClass(memoryGiB: number | null): DeviceMemoryClass {
    if (memoryGiB === null) return 'unknown';
    if (memoryGiB <= 2) return '2gb';
    if (memoryGiB <= 4) return '4gb';
    if (memoryGiB <= 8) return '8gb';
    if (memoryGiB <= 16) return '16gb';
    return '32gb-plus';
  }

  private resolveTier(
    memoryClass: DeviceMemoryClass,
    hardwareConcurrency: number | null
  ): ProcessingCapacityTier {
    if (memoryClass === '32gb-plus') return 'maximum';
    if (memoryClass === '16gb') return 'high';
    if (memoryClass === '8gb') return 'standard';
    if (memoryClass === '4gb') {
      return hardwareConcurrency !== null && hardwareConcurrency >= 8
        ? 'standard'
        : 'conservative';
    }
    return 'conservative';
  }

  private detectFormFactor(userAgentMobile?: boolean): DeviceFormFactor {
    if (userAgentMobile === true) return 'mobile';

    const touchPoints = typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : 0;

    if (touchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 900) {
      return 'tablet';
    }

    return window.innerWidth > 0 ? 'desktop' : 'unknown';
  }

  private deviceBudget(tier: ProcessingCapacityTier): ProcessingBudget {
    const MB = 1024 * 1024;

    switch (tier) {
      case 'maximum':
        return {
          maxFileBytes: 1000 * MB,
          maxTotalBytes: 2000 * MB,
          maxFiles: 75,
          maxPages: 60_000,
          largeWorkloadBytes: 750 * MB,
          largeWorkloadPages: 30_000
        };
      case 'high':
        return {
          maxFileBytes: 500 * MB,
          maxTotalBytes: 1250 * MB,
          maxFiles: 50,
          maxPages: 40_000,
          largeWorkloadBytes: 500 * MB,
          largeWorkloadPages: 20_000
        };
      case 'standard':
        return {
          maxFileBytes: 100 * MB,
          maxTotalBytes: 400 * MB,
          maxFiles: 40,
          maxPages: 20_000,
          largeWorkloadBytes: 300 * MB,
          largeWorkloadPages: 10_000
        };
      default:
        return {
          maxFileBytes: 50 * MB,
          maxTotalBytes: 150 * MB,
          maxFiles: 20,
          maxPages: 5_000,
          largeWorkloadBytes: 100 * MB,
          largeWorkloadPages: 2_500
        };
    }
  }

  private applyEngineCeiling(
    deviceBudget: ProcessingBudget,
    formFactor: DeviceFormFactor
  ): ProcessingBudget {
    const formFactorCeiling: ProcessingBudget = formFactor === 'mobile'
      ? {
          maxFileBytes: 80 * 1024 * 1024,
          maxTotalBytes: 250 * 1024 * 1024,
          maxFiles: 20,
          maxPages: 10_000,
          largeWorkloadBytes: 175 * 1024 * 1024,
          largeWorkloadPages: 5_000
        }
      : formFactor === 'tablet'
        ? {
            maxFileBytes: 80 * 1024 * 1024,
            maxTotalBytes: 300 * 1024 * 1024,
            maxFiles: 25,
            maxPages: 15_000,
            largeWorkloadBytes: 200 * 1024 * 1024,
            largeWorkloadPages: 7_500
          }
        : this.engineCeiling;

    return {
      maxFileBytes: Math.min(deviceBudget.maxFileBytes, formFactorCeiling.maxFileBytes),
      maxTotalBytes: Math.min(deviceBudget.maxTotalBytes, formFactorCeiling.maxTotalBytes),
      maxFiles: Math.min(deviceBudget.maxFiles, formFactorCeiling.maxFiles),
      maxPages: Math.min(deviceBudget.maxPages, formFactorCeiling.maxPages),
      largeWorkloadBytes: Math.min(deviceBudget.largeWorkloadBytes, formFactorCeiling.largeWorkloadBytes),
      largeWorkloadPages: Math.min(deviceBudget.largeWorkloadPages, formFactorCeiling.largeWorkloadPages)
    };
  }
}

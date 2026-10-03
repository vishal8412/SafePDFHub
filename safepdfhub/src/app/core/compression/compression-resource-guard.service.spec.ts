import { describe, expect, it } from 'vitest';
import { CompressionResourceGuardService } from './compression-resource-guard.service';

function makeGuard(overrides: Record<string, number> = {}): CompressionResourceGuardService {
  const capability = {
    budget: {
      largeWorkloadBytes: overrides['largeWorkloadBytes'] ?? 100 * 1024 * 1024,
      largeWorkloadPages: overrides['largeWorkloadPages'] ?? 10_000,
      maxFileBytes: overrides['maxFileBytes'] ?? 100 * 1024 * 1024,
      maxPages: overrides['maxPages'] ?? 40_000,
    },
  };
  return new CompressionResourceGuardService(capability as never);
}

describe('CompressionResourceGuardService', () => {
  it('keeps normal workloads at the full three-branch ceiling', () => {
    const profile = makeGuard().profile(15 * 1024 * 1024, 842);
    expect(profile.largeWorkload).toBe(false);
    expect(profile.highWorkload).toBe(false);
    expect(profile.maxStrategyBranches).toBe(3);
  });

  it('reduces branch fan-out for high workloads', () => {
    const profile = makeGuard().profile(60 * 1024 * 1024, 842);
    expect(profile.largeWorkload).toBe(false);
    expect(profile.highWorkload).toBe(true);
    expect(profile.maxStrategyBranches).toBe(2);
  });

  it('uses a single strategy branch for large workloads', () => {
    const profile = makeGuard().profile(110 * 1024 * 1024, 10_001);
    expect(profile.largeWorkload).toBe(true);
    expect(profile.maxStrategyBranches).toBe(1);
  });
});

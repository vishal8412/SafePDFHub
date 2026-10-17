import { describe, expect, it, vi } from 'vitest';
import { LargeCompressionCapabilityService } from './large-compression-capability.service';
import { compressionBudget } from './large-compression-policy';

describe('300 MB compression admission and storage', () => {
  const file = (size: number) => ({ size } as File);
  function capability(memory: number | null = 8, device: 'desktop' | 'tablet' | 'mobile' = 'desktop', disk = true) {
    const service = new LargeCompressionCapabilityService({} as never);
    vi.spyOn(service, 'budget', 'get').mockReturnValue(compressionBudget(memory, device, disk));
    return service;
  }
  it('accepts exactly 300 million bytes and rejects larger files before processing', () => {
    const c = capability();
    for (const size of [200_000_001, 265_380_000, 300_000_000]) expect(() => c.assertFile(file(size))).not.toThrow();
    for (const size of [300_000_001, 500_000_000, 0, NaN, Infinity]) expect(() => c.assertFile(file(size))).toThrow(/300 MB/);
  });
  it('keeps conservative limits for phones, unknown memory and missing disk workers', () => {
    expect(() => capability(8, 'mobile').assertFile(file(300_000_000))).toThrow(/200 MB/);
    expect(() => capability(4, 'tablet').assertFile(file(300_000_000))).toThrow(/200 MB/);
    expect(() => capability(null).assertFile(file(300_000_000))).toThrow(/150 MB/);
    expect(() => capability(8, 'desktop', false).assertFile(file(300_000_000))).toThrow(/32 MB/);
    expect(() => capability(8, 'tablet').assertFile(file(300_000_000))).not.toThrow();
  });
  it('requires enough temporary storage for two candidates at the 300 MB boundary', async () => {
    const estimate = vi.fn().mockResolvedValue({ quota: 800_000_000, usage: 108_000_000 });
    vi.stubGlobal('navigator', { storage: { estimate } });
    try {
      const c = capability();
      await expect(c.checkStorage(file(300_000_000), true)).resolves.toBeUndefined();
      estimate.mockResolvedValue({ quota: 800_000_000, usage: 108_000_001 });
      await expect(c.checkStorage(file(300_000_000), true)).rejects.toThrow(/temporary browser storage/);
      estimate.mockClear();
      await expect(c.checkStorage(file(300_000_001), true)).rejects.toThrow(/300 MB/);
      expect(estimate).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

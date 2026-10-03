import { describe, expect, it } from 'vitest';
import { compressionBudget, compressionDevice, imageQualities, requiredScratchBytes } from './large-compression-policy';
import { attachDiskOutput } from './opfs-output';
describe('large PDF resource boundaries', () => {
  it('separates mobile, tablet and desktop budgets, including unknown memory', () => {
    expect(compressionBudget(8, 'desktop', true).maxFileBytes).toBe(500_000_000);
    expect(compressionBudget(4, 'desktop', true).maxFileBytes).toBe(300_000_000);
    expect(compressionBudget(8, 'tablet', true).maxFileBytes).toBe(300_000_000);
    expect(compressionBudget(4, 'tablet', true).maxFileBytes).toBe(200_000_000);
    expect(compressionBudget(8, 'mobile', true).maxFileBytes).toBe(200_000_000);
    expect(compressionBudget(4, 'mobile', true).maxFileBytes).toBe(150_000_000);
    expect(compressionBudget(null, 'mobile', true).maxFileBytes).toBe(75_000_000);
    expect(compressionBudget(2, 'mobile', true).memoryMiB).toBe(128);
    expect(compressionBudget(8, 'desktop', false).maxFileBytes).toBe(32_000_000);
    expect(compressionBudget(1, 'mobile', true).maxFileBytes).toBe(32_000_000);
  });
  it('detects iPad desktop mode and Android tablets independently of screen width', () => {
    expect(compressionDevice('Macintosh', 'MacIntel', 5, false, 'desktop')).toBe('tablet');
    expect(compressionDevice('Android 14', 'Linux', 5, false, 'desktop')).toBe('tablet');
    expect(compressionDevice('Android Mobile', 'Linux', 5, true, 'tablet')).toBe('mobile');
  });
  it('keeps quality modes through exactly 200 MB and lossless above it', () => {
    expect(imageQualities(200_000_000, 'recommended', 100_000_000)).toEqual([82]);
    expect(imageQualities(200_000_000, 'strong', 100_000_000)).toEqual([55]);
    expect(imageQualities(200_000_001, 'strong', 100_000_000)).toEqual([]);
    expect(imageQualities(200_000_000, 'light', 100_000_000)).toEqual([]);
    expect(imageQualities(200_000_000, 'strong', 100_000_000, 5_000_000)).toEqual([45, 20]);
    expect(imageQualities(200_000_000, 'strong', 4_000_000, 5_000_000)).toEqual([]);
    expect(requiredScratchBytes(200_000_000, true)).toBe(472_000_000);
  });
  it('reserves output growth plus scratch space without copying the input', () => {
    expect(requiredScratchBytes(500_000_000)).toBe(582_000_000);
  });
  it('writes bounded chunks, handles short writes and rejects oversized output before writing', () => {
    let size = 0; const writes: number[] = [];
    const node: any = { node_ops: { getattr: () => ({ mode: 0 }) } };
    const disk = { getSize: () => size, truncate: (n: number) => { size = n; },
      write: (b: Uint8Array, options: any) => { const n = Math.min(b.length, 100_000); writes.push(n); size = Math.max(size, options.at + n); return n; },
      read: () => 0 };
    attachDiskOutput({ writeFile: () => {}, lookupPath: () => ({ node }) }, '/out', disk, 3_000_000);
    const buffer = new Uint8Array(2_000_000);
    expect(node.stream_ops.write({}, buffer, 0, buffer.length, 0)).toBe(buffer.length);
    expect(writes.length).toBe(20);
    expect(node.node_ops.getattr(node).size).toBe(2_000_000);
    expect(() => node.stream_ops.write({}, buffer, 0, buffer.length, 2_000_000)).toThrow(/limit/);
    expect(writes.length).toBe(20);
    node.node_ops.setattr(node, { size: 0 }); expect(size).toBe(0);
  });
  it('stops on storage exhaustion instead of retrying forever', () => {
    const node: any = { node_ops: {} };
    attachDiskOutput({ writeFile: () => {}, lookupPath: () => ({ node }) }, '/out', { write: () => 0 }, 100);
    expect(() => node.stream_ops.write({}, new Uint8Array(10), 0, 10, 0)).toThrow(/write failed/);
  });
});

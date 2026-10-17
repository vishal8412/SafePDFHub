import { describe, expect, it } from 'vitest';
import { allocateImageBudgets, encodeJpegWithinBudget } from './target-image-budget';

describe('Target image budget', () => {
  it('only searches below the normal quality floor when explicitly requested', async () => {
    const encode = async (q: number) => new Blob([new Uint8Array(10_000 + Math.round(q * 100_000))]);
    const normal = await encodeJpegWithinBudget(encode, 16_000);
    const sizePriority = await encodeJpegWithinBudget(encode, 16_000, 0.85, 0.05);
    expect(normal.size).toBeGreaterThan(16_000);
    expect(sizePriority.size).toBeLessThanOrEqual(16_000);
  });

  it('reserves fixed PDF content, margin, and extra space for complex scans', () => {
    const budgets = allocateImageBudgets(10_000_000, 143_000_000, [70_000_000, 72_000_000])!;
    expect(budgets[1]).toBeGreaterThan(budgets[0]);
    expect(budgets.reduce((a, b) => a + b, 0)).toBeLessThan(9_000_000);
    expect(allocateImageBudgets(500_000, 143_000_000, [142_000_000])).toBeNull();
    expect(allocateImageBudgets(10_000, 100_000, [])).toBeNull();
  });
  it('finds an encoding below the real byte budget with a bounded search', async () => {
    const calls: number[] = [];
    const result = await encodeJpegWithinBudget(async q => {
      calls.push(q); return new Blob([new Uint8Array(Math.floor(10_000 + q * 100_000))]);
    }, 40_000);
    expect(result.size).toBeLessThanOrEqual(40_000);
    expect(result.size).toBeGreaterThan(34_000);
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(0.1);
  });
  it('does not keep reducing quality when the image cannot fit at this resolution', async () => {
    let calls = 0;
    const result = await encodeJpegWithinBudget(async q => {
      calls++; return new Blob([new Uint8Array(50_000 + Math.floor(q * 1000))]);
    }, 20_000);
    expect(result.size).toBeGreaterThan(20_000);
    expect(calls).toBe(2);
  });
  it('preserves quality when the first encoding already fits', async () => {
    let calls = 0;
    await encodeJpegWithinBudget(async () => { calls++; return new Blob(['jpeg']); }, 1000);
    expect(calls).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { PdfWatermarkMetricsService } from './pdf-watermark-metrics.service';

describe('PdfWatermarkMetricsService', () => {
  it('uses exact pdf-lib standard-font metrics', async () => {
    const service = new PdfWatermarkMetricsService();

    const metrics = await service.measure('Helvetica', 'CONFIDENTIAL', 42);

    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.ascenderHeight).toBeGreaterThan(0);
    expect(metrics.descenderHeight).toBeGreaterThanOrEqual(0);
    expect(metrics.font).toBe('Helvetica');
    expect(metrics.fontSize).toBe(42);
    expect(metrics.text).toBe('CONFIDENTIAL');
  });

  it('caches identical metric requests', async () => {
    const service = new PdfWatermarkMetricsService();

    const first = await service.measure('Times-Roman', 'DRAFT', 36);
    const second = await service.measure('Times-Roman', 'DRAFT', 36);

    expect(second).toBe(first);
  });

  it('keeps different fonts/text isolated', async () => {
    const service = new PdfWatermarkMetricsService();

    const helvetica = await service.measure('Helvetica', 'SAMPLE', 42);
    const courier = await service.measure('Courier', 'SAMPLE', 42);
    const otherText = await service.measure('Helvetica', 'DIFFERENT', 42);

    expect(courier).not.toBe(helvetica);
    expect(otherText).not.toBe(helvetica);
  });
});

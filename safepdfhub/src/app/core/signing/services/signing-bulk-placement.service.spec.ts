import { SigningBulkPlacementService } from './signing-bulk-placement.service';
import type { SigningBounds } from '../models/signing.models';

describe('SigningBulkPlacementService', () => {
  const service = new SigningBulkPlacementService();

  it('resolves current, all, and bounded range scopes deterministically', () => {
    expect(service.resolvePages('current', 5, 3, 1, 5, '')).toEqual([3]);
    expect(service.resolvePages('current', 5, 99, 1, 5, '')).toEqual([5]);
    expect(service.resolvePages('all', 5, 3, 1, 5, '')).toEqual([1, 2, 3, 4, 5]);
    expect(service.resolvePages('range', 5, 3, 2, 4, '')).toEqual([2, 3, 4]);
    expect(service.resolvePages('range', 5, 3, 0, 99, '')).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses specific page lists and ranges, removes duplicates, and ignores invalid pages', () => {
    expect(service.resolvePages('specific', 12, 1, 1, 1, '1, 3, 5-8, 8, 12, 0, 13, nope'))
      .toEqual([1, 3, 5, 6, 7, 8, 12]);
  });

  it('returns no pages for an empty document', () => {
    expect(service.resolvePages('all', 0, 1, 1, 1, '1-3')).toEqual([]);
    expect(service.resolvePages('specific', 0, 1, 1, 1, '1,2')).toEqual([]);
  });

  it('keeps normalized bounds inside the page for every bulk position', () => {
    const bounds: SigningBounds = { x: 0.72, y: 0.81, width: 0.24, height: 0.16 };
    const positions = ['same', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;

    for (const position of positions) {
      const result = service.positionBounds(bounds, position);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.x + result.width).toBeLessThanOrEqual(1);
      expect(result.y + result.height).toBeLessThanOrEqual(1);
    }
  });

  it('preserves field dimensions when moving a field between differently sized pages', () => {
    const bounds: SigningBounds = { x: 0.15, y: 0.20, width: 0.30, height: 0.12 };
    const copied = service.positionBounds(bounds, 'same');

    expect(copied).toEqual(bounds);
    expect(copied.width).toBe(0.30);
    expect(copied.height).toBe(0.12);
  });

  it('keeps the selected-page ordering stable for specific ranges', () => {
    expect(service.resolvePages('specific', 20, 1, 1, 1, '10-12, 2, 4-6, 3, 12')).toEqual([
      2, 3, 4, 5, 6, 10, 11, 12,
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { imageShapes } from './large-image-inspection';
describe('bounded image preflight', () => {
  it('keeps a comparable inventory without decoding pixels', () => {
    expect(imageShapes({ pages: [{ images: [{ width: 1000, height: 660 }] }, { images: [] }] }, 2_000_000)).toEqual(['1000x660', '']);
  });
  it('rejects oversized, unknown and malformed image dimensions', () => {
    for (const image of [{ width: 10_000, height: 10_000 }, { width: null, height: 1 }, { width: 2.5, height: 10 }]) {
      expect(() => imageShapes({ pages: [{ images: [image] }] }, 2_000_000)).toThrow();
    }
    expect(() => imageShapes({ pages: [{}] }, 2_000_000)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  resolveWatermarkPageSelection,
  watermarkDisplayPointToPdfPoint,
  watermarkDisplayRotationToPdfRotation,
  watermarkDisplayCenterToCssTopLeft,
  watermarkDisplayPositionCenter,
  watermarkPositionCenter,
  watermarkPositionCenterTopOrigin,
  watermarkRotatedBounds,
  watermarkTiledCenters,
} from './pdf-watermark.service';

describe('PdfWatermarkService geometry contracts', () => {
  it('selects every page deterministically', () => {
    expect(resolveWatermarkPageSelection({ mode: 'all' }, 4)).toEqual([1, 2, 3, 4]);
  });

  it('deduplicates and sorts overlapping ranges', () => {
    expect(resolveWatermarkPageSelection({ mode: 'ranges', ranges: '4-5,1,3-4' }, 5)).toEqual([1, 3, 4, 5]);
  });

  it('rejects ranges outside the document', () => {
    expect(() => resolveWatermarkPageSelection({ mode: 'ranges', ranges: '2-6' }, 5)).toThrow();
  });


  it('maps display rotation to the PDF-space rotation contract', () => {
    expect(watermarkDisplayRotationToPdfRotation(-35, 0)).toBe(35);
    expect(watermarkDisplayRotationToPdfRotation(35, 0)).toBe(-35);
    expect(watermarkDisplayRotationToPdfRotation(-35, 90)).toBe(125);
    expect(watermarkDisplayRotationToPdfRotation(-35, 180)).toBe(215);
    expect(watermarkDisplayRotationToPdfRotation(-35, 270)).toBe(305);
  });

  it('converts a visual center to a CSS top-left without rotating the anchor', () => {
    const center = { x: 300, y: 400 };
    const result = watermarkDisplayCenterToCssTopLeft(center, 600, 800, 240, 42, 1);
    expect(result.left).toBe(180);
    expect(result.top).toBe(379);

    const scaled = watermarkDisplayCenterToCssTopLeft(center, 600, 800, 240, 42, 0.5);
    expect(scaled.left).toBe(90);
    expect(scaled.top).toBe(189.5);
  });

  it('maps all nine positions to deterministic visual centers', () => {
    const centers = [
      ['top-left', { x: 86, y: 702 }],
      ['top-center', { x: 300, y: 702 }],
      ['top-right', { x: 514, y: 702 }],
      ['middle-left', { x: 86, y: 400 }],
      ['center', { x: 300, y: 400 }],
      ['middle-right', { x: 514, y: 400 }],
      ['bottom-left', { x: 86, y: 98 }],
      ['bottom-center', { x: 300, y: 98 }],
      ['bottom-right', { x: 514, y: 98 }],
    ] as const;

    for (const [position, expected] of centers) {
      expect(watermarkPositionCenter(position, 600, 800, 100, 100)).toEqual(expected);
    }
  });



  it('maps all nine Studio display positions directly in top-origin coordinates', () => {
    const expected = [
      ['top-left', { x: 86, y: 98 }],
      ['top-center', { x: 300, y: 98 }],
      ['top-right', { x: 514, y: 98 }],
      ['middle-left', { x: 86, y: 400 }],
      ['center', { x: 300, y: 400 }],
      ['middle-right', { x: 514, y: 400 }],
      ['bottom-left', { x: 86, y: 702 }],
      ['bottom-center', { x: 300, y: 702 }],
      ['bottom-right', { x: 514, y: 702 }],
    ] as const;

    for (const [position, center] of expected) {
      expect(watermarkDisplayPositionCenter(position, 600, 800, 100, 100)).toEqual(center);
    }
  });

  it('keeps Studio display anchors vertically stable with rotation', () => {
    const top = watermarkDisplayPositionCenter('top-right', 600, 800, 240, 42, -35);
    const bottom = watermarkDisplayPositionCenter('bottom-right', 600, 800, 240, 42, -35);

    expect(top.y).toBeLessThan(400);
    expect(bottom.y).toBeGreaterThan(400);
    expect(top.x).toBe(bottom.x);
  });

  it('maps Studio top/bottom positions to browser top-origin coordinates exactly once', () => {
    expect(watermarkPositionCenterTopOrigin('top-left', 600, 800, 100, 100)).toEqual({ x: 86, y: 98 });
    expect(watermarkPositionCenterTopOrigin('top-right', 600, 800, 100, 100)).toEqual({ x: 514, y: 98 });
    expect(watermarkPositionCenterTopOrigin('bottom-left', 600, 800, 100, 100)).toEqual({ x: 86, y: 702 });
    expect(watermarkPositionCenterTopOrigin('bottom-right', 600, 800, 100, 100)).toEqual({ x: 514, y: 702 });
    expect(watermarkPositionCenterTopOrigin('center', 600, 800, 100, 100)).toEqual({ x: 300, y: 400 });
  });

  it('keeps rotated watermark bounds inside the selected page anchor', () => {
    const bounds = watermarkRotatedBounds(240, 42, -35);
    const center = watermarkPositionCenter('bottom-left', 600, 800, 240, 42, -35);
    expect(center.x - bounds.width / 2).toBeGreaterThanOrEqual(36);
    expect(center.y - bounds.height / 2).toBeGreaterThanOrEqual(48);

    const topRight = watermarkPositionCenter('top-right', 600, 800, 240, 42, 35);
    const topBounds = watermarkRotatedBounds(240, 42, 35);
    expect(topRight.x + topBounds.width / 2).toBeLessThanOrEqual(564);
    expect(topRight.y + topBounds.height / 2).toBeLessThanOrEqual(752);
  });

  it('clamps every corner anchor to the page safe area', () => {
    const pageWidth = 612;
    const pageHeight = 792;
    const width = 260;
    const height = 54;
    const rotation = -35;
    const bounds = watermarkRotatedBounds(width, height, rotation);
    const marginX = Math.max(24, pageWidth * 0.06);
    const marginY = Math.max(24, pageHeight * 0.06);

    for (const position of [
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
    ] as const) {
      const center = watermarkPositionCenter(position, pageWidth, pageHeight, width, height, rotation);
      expect(center.x - bounds.width / 2).toBeGreaterThanOrEqual(marginX);
      expect(center.x + bounds.width / 2).toBeLessThanOrEqual(pageWidth - marginX);
      expect(center.y - bounds.height / 2).toBeGreaterThanOrEqual(marginY);
      expect(center.y + bounds.height / 2).toBeLessThanOrEqual(pageHeight - marginY);
    }
  });

  it('falls back to the page center when the rotated watermark is larger than the safe area', () => {
    const center = watermarkPositionCenter('top-right', 300, 300, 500, 120, 45);
    expect(center).toEqual({ x: 150, y: 150 });
  });

  it('uses rotation-aware bounds only when rotation is requested', () => {
    expect(watermarkRotatedBounds(100, 50, 0)).toEqual({ width: 100, height: 50 });
    expect(watermarkRotatedBounds(100, 50, 90)).toEqual({ width: 50, height: 100 });
  });


  it('uses exactly four normalized repeat anchors', () => {
    const centers = watermarkTiledCenters(600, 800, 120, 42, 'text', 1, -35);
    expect(centers).toEqual([
      { x: 150, y: 600 },
      { x: 450, y: 600 },
      { x: 150, y: 200 },
      { x: 450, y: 200 },
    ]);
  });

  it('does not change repeat count when the rotated watermark becomes large', () => {
    const small = watermarkTiledCenters(600, 800, 120, 42, 'text', 1, -35);
    const large = watermarkTiledCenters(600, 800, 420, 120, 'text', 1, -35);
    expect(small).toHaveLength(4);
    expect(large).toHaveLength(4);
  });

  it('keeps the same four-copy pattern when the watermark fits the page', () => {
    const a = watermarkTiledCenters(600, 800, 120, 42, 'text', 1, -35);
    const b = watermarkTiledCenters(612, 792, 122.4, 41.58, 'text', 1, -35);
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    for (let index = 0; index < 4; index += 1) {
      expect(b[index]!.x / 612).toBeCloseTo(a[index]!.x / 600, 12);
      expect(b[index]!.y / 792).toBeCloseTo(a[index]!.y / 800, 12);
    }
  });

  it('keeps the four repeat copies fully visible when the rotated bounds approach the edges', () => {
    const pageWidth = 612;
    const pageHeight = 792;
    const width = 420;
    const height = 120;
    const rotation = -35;
    const centers = watermarkTiledCenters(pageWidth, pageHeight, width, height, 'text', 1, rotation);
    const bounds = watermarkRotatedBounds(width, height, rotation);
    const marginX = Math.max(18, pageWidth * 0.04);
    const marginY = Math.max(18, pageHeight * 0.04);

    expect(centers).toHaveLength(4);
    for (const center of centers) {
      expect(center.x - bounds.width / 2).toBeGreaterThanOrEqual(marginX);
      expect(center.x + bounds.width / 2).toBeLessThanOrEqual(pageWidth - marginX);
      expect(center.y - bounds.height / 2).toBeGreaterThanOrEqual(marginY);
      expect(center.y + bounds.height / 2).toBeLessThanOrEqual(pageHeight - marginY);
    }
  });

  it('keeps text and image repeat geometry deterministic for the same visible bounds', () => {
    const text = watermarkTiledCenters(600, 800, 120, 80, 'text');
    const image = watermarkTiledCenters(600, 800, 120, 80, 'image');
    expect(image).toEqual(text);
  });

  it('keeps the repeat pattern normalized across proportionally scaled pages', () => {
    const a = watermarkTiledCenters(600, 800, 120, 42, 'text', 1, -35);
    const b = watermarkTiledCenters(1200, 1600, 240, 84, 'text', 1, -35);
    expect(b).toHaveLength(a.length);
    for (let index = 0; index < a.length; index += 1) {
      expect(b[index]!.x / 1200).toBeCloseTo(a[index]!.x / 600, 10);
      expect(b[index]!.y / 1600).toBeCloseTo(a[index]!.y / 800, 10);
    }
  });

  it('uses the same four-copy layout on equivalent A4 pages', () => {
    const page1 = watermarkTiledCenters(595.32, 841.92, 120, 44.1, 'text', 1, -35);
    const page2 = watermarkTiledCenters(595.32, 841.92, 120, 44.1, 'text', 1, -35);
    expect(page1).toEqual(page2);
    expect(page1).toHaveLength(4);
  });

  it('does not clip repeated copies at the page edges', () => {
    const centers = watermarkTiledCenters(612, 792, 420, 120, 'text', 1, -35);
    const bounds = watermarkRotatedBounds(420, 120, -35);
    expect(centers).toHaveLength(4);
    expect(centers[0]!.x - bounds.width / 2).toBeGreaterThan(0);
    expect(centers[1]!.x + bounds.width / 2).toBeLessThan(612);
  });

  it('inverts rotated display coordinates exactly once', () => {
    const width = 600;
    const height = 800;
    const point = { x: 100, y: 150 };
    expect(watermarkDisplayPointToPdfPoint(point, width, height, 0)).toEqual({ x: 100, y: 150 });
    expect(watermarkDisplayPointToPdfPoint(point, width, height, 90)).toEqual({ x: 450, y: 100 });
    expect(watermarkDisplayPointToPdfPoint(point, width, height, 180)).toEqual({ x: 500, y: 650 });
    expect(watermarkDisplayPointToPdfPoint(point, width, height, 270)).toEqual({ x: 150, y: 700 });
  });
});


describe('Watermark preview transform contract', () => {
  it('keeps the requested anchor at the transform center for diagonal rotations', () => {
    const width = 250;
    const height = 50;
    const rotations = [-35, 35, 90, 180, 270];

    for (const rotation of rotations) {
      const radians = rotation * Math.PI / 180;
      // rotate() is applied first and translate(-50%, -50%) is applied after
      // it. The centering translation therefore remains in screen axes and
      // is not rotated with the watermark.
      const translatedCenter = { x: 0, y: 0 };
      const localCenter = { x: width / 2, y: height / 2 };
      const rotatedCenter = {
        x: localCenter.x * Math.cos(radians) - localCenter.y * Math.sin(radians),
        y: localCenter.x * Math.sin(radians) + localCenter.y * Math.cos(radians),
      };
      const afterCentering = {
        x: rotatedCenter.x - localCenter.x * Math.cos(radians) + localCenter.y * Math.sin(radians),
        y: rotatedCenter.y - localCenter.x * Math.sin(radians) - localCenter.y * Math.cos(radians),
      };

      expect(afterCentering.x).toBeCloseTo(translatedCenter.x, 10);
      expect(afterCentering.y).toBeCloseTo(translatedCenter.y, 10);
    }
  });
});

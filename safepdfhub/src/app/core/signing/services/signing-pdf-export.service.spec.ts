import { displayBoundsToPdfBox, normalizeSigningFieldRotation } from './signing-pdf-export.service';
import type { SigningBounds } from '../models/signing.models';

describe('displayBoundsToPdfBox', () => {
  const bounds: SigningBounds = { x: 0.10, y: 0.20, width: 0.30, height: 0.25 };
  const pageWidth = 600;
  const pageHeight = 800;

  it('maps unrotated pages from top-left display space to bottom-left PDF space', () => {
    expect(displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 0)).toEqual({
      x: 60,
      y: 440,
      width: 180,
      height: 200,
    });
  });

  it('maps 90-degree rotated pages without applying the page rotation twice', () => {
    expect(displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 90)).toEqual({
      x: 330,
      y: 80,
      width: 150,
      height: 240,
    });
  });

  it('maps 180-degree rotated pages correctly', () => {
    expect(displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 180)).toEqual({
      x: 360,
      y: 160,
      width: 180,
      height: 200,
    });
  });

  it('maps 270-degree rotated pages correctly', () => {
    expect(displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 270)).toEqual({
      x: 120,
      y: 480,
      width: 150,
      height: 240,
    });
  });

  it('preserves full-page bounds for every supported rotation', () => {
    const full: SigningBounds = { x: 0, y: 0, width: 1, height: 1 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const box = displayBoundsToPdfBox(full, pageWidth, pageHeight, rotation);
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(pageWidth);
      expect(box.height).toBe(pageHeight);
    }
  });

  it('keeps display-space corner fields inside the PDF page for every rotation', () => {
    const corners: SigningBounds[] = [
      { x: 0, y: 0, width: 0.1, height: 0.1 },
      { x: 0.9, y: 0, width: 0.1, height: 0.1 },
      { x: 0, y: 0.9, width: 0.1, height: 0.1 },
      { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
    ];

    for (const rotation of [0, 90, 180, 270] as const) {
      for (const corner of corners) {
        const box = displayBoundsToPdfBox(corner, pageWidth, pageHeight, rotation);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(pageWidth);
        expect(box.y + box.height).toBeLessThanOrEqual(pageHeight);
      }
    }
  });
});

describe('displayBoundsToPdfBox — asymmetric pages and rotation boundaries', () => {
  const pageWidth = 612;
  const pageHeight = 792;
  const cases = [
    { rotation: 0 as const, bounds: { x: 0.02, y: 0.03, width: 0.18, height: 0.11 } },
    { rotation: 90 as const, bounds: { x: 0.78, y: 0.04, width: 0.18, height: 0.11 } },
    { rotation: 180 as const, bounds: { x: 0.78, y: 0.86, width: 0.18, height: 0.11 } },
    { rotation: 270 as const, bounds: { x: 0.03, y: 0.86, width: 0.18, height: 0.11 } },
  ];

  it('keeps asymmetric-page corner placements within the unrotated PDF box', () => {
    for (const item of cases) {
      const box = displayBoundsToPdfBox(item.bounds, pageWidth, pageHeight, item.rotation);
      expect(box.x).toBeGreaterThanOrEqual(-0.000001);
      expect(box.y).toBeGreaterThanOrEqual(-0.000001);
      expect(box.x + box.width).toBeLessThanOrEqual(pageWidth + 0.000001);
      expect(box.y + box.height).toBeLessThanOrEqual(pageHeight + 0.000001);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  it('swaps display dimensions only for quarter-turn page rotations', () => {
    const bounds = { x: 0.25, y: 0.20, width: 0.30, height: 0.25 };
    const zero = displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 0);
    const ninety = displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 90);
    const oneEighty = displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 180);
    const twoSeventy = displayBoundsToPdfBox(bounds, pageWidth, pageHeight, 270);

    expect(zero.width).toBeCloseTo(pageWidth * bounds.width, 8);
    expect(zero.height).toBeCloseTo(pageHeight * bounds.height, 8);
    expect(ninety.width).toBeCloseTo(pageWidth * bounds.height, 8);
    expect(ninety.height).toBeCloseTo(pageHeight * bounds.width, 8);
    expect(oneEighty.width).toBeCloseTo(zero.width, 8);
    expect(oneEighty.height).toBeCloseTo(zero.height, 8);
    expect(twoSeventy.width).toBeCloseTo(pageWidth * bounds.height, 8);
    expect(twoSeventy.height).toBeCloseTo(pageHeight * bounds.width, 8);
  });
});


describe('normalizeSigningFieldRotation', () => {
  it('accepts the four supported field rotations', () => {
    expect(normalizeSigningFieldRotation(0)).toBe(0);
    expect(normalizeSigningFieldRotation(90)).toBe(90);
    expect(normalizeSigningFieldRotation(180)).toBe(180);
    expect(normalizeSigningFieldRotation(270)).toBe(270);
  });

  it('normalizes negative and wrapped quarter-turn rotations', () => {
    expect(normalizeSigningFieldRotation(-90)).toBe(270);
    expect(normalizeSigningFieldRotation(450)).toBe(90);
    expect(normalizeSigningFieldRotation(720)).toBe(0);
  });

  it('fails closed for unsupported non-quarter-turn values', () => {
    expect(normalizeSigningFieldRotation(45)).toBe(0);
    expect(normalizeSigningFieldRotation(Number.NaN)).toBe(0);
    expect(normalizeSigningFieldRotation(undefined)).toBe(0);
  });
});

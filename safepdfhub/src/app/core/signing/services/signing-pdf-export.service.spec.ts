import { displayBoundsToPdfBox } from './signing-pdf-export.service';
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

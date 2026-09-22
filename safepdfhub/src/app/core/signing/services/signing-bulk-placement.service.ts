import { Injectable } from '@angular/core';
import type { SigningBounds } from '../models/signing.models';

export type SigningBulkScope = 'current' | 'all' | 'range' | 'specific';
export type SigningBulkPosition = 'same' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

/**
 * Pure multi-page placement rules used by the Sign PDF workspace.
 * Keeping page selection and normalized positioning outside the component
 * makes the cross-page contract deterministic and directly testable.
 */
@Injectable()
export class SigningBulkPlacementService {
  resolvePages(
    scope: SigningBulkScope,
    pageCount: number,
    currentPage: number,
    from: number,
    to: number,
    specific: string,
  ): number[] {
    const count = Math.max(0, Math.floor(pageCount));
    if (!count) return [];

    const clampPage = (value: number): number => Math.max(1, Math.min(count, Math.floor(value)));

    if (scope === 'current') {
      return [clampPage(currentPage)];
    }

    if (scope === 'all') {
      return Array.from({ length: count }, (_, index) => index + 1);
    }

    if (scope === 'range') {
      const start = clampPage(from);
      const end = Math.max(start, clampPage(to));
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }

    const result = new Set<number>();
    for (const part of specific.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = clampPage(Number(range[1]));
        const end = Math.max(start, clampPage(Number(range[2])));
        for (let page = start; page <= end; page += 1) result.add(page);
        continue;
      }

      if (/^\d+$/.test(trimmed)) {
        const page = Number(trimmed);
        if (page >= 1 && page <= count) result.add(page);
      }
    }

    return [...result].sort((a, b) => a - b);
  }

  positionBounds(bounds: SigningBounds, position: SigningBulkPosition): SigningBounds {
    const safeWidth = this.clamp(bounds.width, 0, 1);
    const safeHeight = this.clamp(bounds.height, 0, 1);
    const base = {
      ...bounds,
      width: safeWidth,
      height: safeHeight,
    };

    if (position === 'same') {
      return {
        ...base,
        x: this.clamp(base.x, 0, 1 - safeWidth),
        y: this.clamp(base.y, 0, 1 - safeHeight),
      };
    }

    const margin = 0.06;
    let x = this.clamp(base.x, 0, 1 - safeWidth);
    let y = this.clamp(base.y, 0, 1 - safeHeight);

    if (position.includes('left')) x = margin;
    if (position.includes('right')) x = 1 - margin - safeWidth;
    if (position.includes('top')) y = margin;
    if (position.includes('bottom')) y = 1 - margin - safeHeight;
    if (position === 'center') {
      x = (1 - safeWidth) / 2;
      y = (1 - safeHeight) / 2;
    }

    return {
      ...base,
      x: this.clamp(x, 0, 1 - safeWidth),
      y: this.clamp(y, 0, 1 - safeHeight),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

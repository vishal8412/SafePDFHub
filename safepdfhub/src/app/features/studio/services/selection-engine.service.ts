import {
  Injectable
} from '@angular/core';

import type {
  StudioObject,
  StudioSelection
} from '../models/studio-selection.model';

@Injectable({
  providedIn: 'root'
})
export class SelectionEngineService {

  /**
   * Return every selectable Studio object under a page-space point,
   * ordered from back-to-front. Geometry-aware hit testing is used for
   * lines and freehand strokes so thin old annotations remain selectable.
   */
  hitTestAll(
    objects: readonly StudioObject[],
    pageNumber: number,
    x: number,
    y: number
  ): StudioObject[] {
    const hits: StudioObject[] = [];

    for (const object of objects) {
      if (object.pageNumber !== pageNumber) {
        continue;
      }

      if (this.containsPoint(object, x, y)) {
        hits.push(object);
      }
    }

    return hits;
  }

  /**
   * Find the top-most object at a page-space point.
   */
  hitTest(
    objects: readonly StudioObject[],
    pageNumber: number,
    x: number,
    y: number
  ): StudioObject | null {
    const hits = this.hitTestAll(objects, pageNumber, x, y);
    return hits.length ? hits[hits.length - 1] : null;
  }

  private containsPoint(
    object: StudioObject,
    x: number,
    y: number
  ): boolean {
    const { x: bx, y: by, width, height } = object.bounds;

    if (
      object.type === 'shape' &&
      object.shape &&
      (object.shape.kind === 'line' || object.shape.kind === 'arrow') &&
      object.shape.points &&
      object.shape.points.length >= 2
    ) {
      return this.pointNearSegment(
        x, y,
        object.shape.points[0].x, object.shape.points[0].y,
        object.shape.points[1].x, object.shape.points[1].y,
        Math.max(0.006, object.shape.style.strokeWidth * 0.75)
      );
    }

    if (
      (object.type === 'draw' || object.type === 'highlight') &&
      object.drawing &&
      object.drawing.points.length >= 2
    ) {
      const tolerance = Math.max(0.006, object.drawing.style.strokeWidth * 0.75);
      const points = object.drawing.points;
      for (let i = 1; i < points.length; i++) {
        if (this.pointNearSegment(
          x, y,
          points[i - 1].x, points[i - 1].y,
          points[i].x, points[i].y,
          tolerance
        )) {
          return true;
        }
      }
      return false;
    }

    if (
      object.type === 'shape' &&
      object.shape?.kind === 'ellipse'
    ) {
      const rx = Math.max(width / 2, 0.0001);
      const ry = Math.max(height / 2, 0.0001);
      const nx = (x - (bx + width / 2)) / rx;
      const ny = (y - (by + height / 2)) / ry;
      return nx * nx + ny * ny <= 1.0;
    }

    return (
      x >= bx &&
      x <= bx + width &&
      y >= by &&
      y <= by + height
    );
  }

  private pointNearSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    tolerance: number
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared <= 1e-10) {
      return Math.hypot(px - x1, py - y1) <= tolerance;
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy) <= tolerance;
  }

  toSelection(
    object: StudioObject
  ): StudioSelection {

    return {
      objectId:
        object.id,

      pageNumber:
        object.pageNumber,

      type:
        object.type,

      bounds:
        object.bounds
    };
  }
}
import {
  Injectable,
  signal
} from '@angular/core';

import type {
  StudioObject,
  StudioObjectBounds,
  StudioTextAlign,
  StudioTextFontStyle,
  StudioTextFontWeight,
  StudioTextStyle,
  StudioImageData,
  StudioShapeKind,
  StudioShapeStyle,
  StudioDrawingData,
  StudioDrawingStyle,
  StudioPoint
} from '../models/studio-selection.model';

const DEFAULT_TEXT_STYLE: StudioTextStyle = {
  fontSize: 0.018,
  fontWeight: 400,
  fontStyle: 'normal',
  textAlign: 'left'
};

@Injectable({
  providedIn: 'root'
})
export class StudioObjectService {

  private readonly objects =
    new Map<string, StudioObject>();

  /**
   * Reactive mutation version. Any Studio object mutation increments
   * this signal so OnPush templates can immediately reflect changes
   * to text, formatting, move/resize and deletion.
   */
  private readonly revision = signal(0);

  readonly changes = this.revision.asReadonly();

  listForPage(
    pageNumber: number
  ): readonly StudioObject[] {

    return Array.from(
      this.objects.values()
    ).filter(
      object =>
        object.pageNumber === pageNumber
    );
  }

  /**
   * F5 — Return a deep, immutable snapshot of every Studio object.
   *
   * This is used by page-management history because insert/delete/reorder can
   * remap object page numbers. Restoring pages without restoring objects would
   * corrupt the document state.
   */
  snapshot(): readonly StudioObject[] {

    return Array.from(
      this.objects.values()
    ).map(
      object =>
        this.cloneObject(object)
    );
  }

  /**
   * F5 — Replace the complete object collection from a history snapshot.
   */
  restore(
    objects: readonly StudioObject[]
  ): void {

    this.objects.clear();

    for (
      const object of objects
    ) {
      const clone =
        this.cloneObject(object);

      this.objects.set(
        clone.id,
        clone
      );
    }

    this.touch();
  }

  get(
    objectId: string
  ): StudioObject | null {

    return (
      this.objects.get(objectId) ?? null
    );
  }

  add(
    object: StudioObject
  ): void {

    this.objects.set(
      object.id,
      object
    );
    this.touch();
  }

  createTextObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number
  ): StudioObject {

    const width = 0.22;
    const height = 0.055;

    const bounds: StudioObjectBounds = {
      x: this.clamp(
        normalizedX,
        0,
        1 - width
      ),
      y: this.clamp(
        normalizedY,
        0,
        1 - height
      ),
      width,
      height
    };

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'text',
      bounds,
      text: '',
      textStyle: {
        ...DEFAULT_TEXT_STYLE
      }
    };

    this.objects.set(
      object.id,
      object
    );
    this.touch();

    return object;
  }

  createImageObject(
    pageNumber: number,
    normalizedX: number,
    normalizedY: number,
    image: StudioImageData
  ): StudioObject {

    const maxDimension = 0.38;
    const sourceRatio =
      image.aspectRatio > 0
        ? image.aspectRatio
        : 1;

    let width = maxDimension;
    let height = width / sourceRatio;

    if (height > maxDimension) {
      height = maxDimension;
      width = height * sourceRatio;
    }

    width = Math.min(0.75, Math.max(0.06, width));
    height = Math.min(0.75, Math.max(0.06, height));

    const bounds: StudioObjectBounds = {
      x: this.clamp(
        normalizedX - width / 2,
        0,
        Math.max(0, 1 - width)
      ),
      y: this.clamp(
        normalizedY - height / 2,
        0,
        Math.max(0, 1 - height)
      ),
      width,
      height
    };

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'image',
      bounds,
      image
    };

    this.objects.set(
      object.id,
      object
    );

    this.touch();

    return object;
  }

  createShapeObject(
    pageNumber: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    kind: StudioShapeKind,
    style: StudioShapeStyle
  ): StudioObject {

    const normalized = this.normalizeDragBounds(
      startX,
      startY,
      endX,
      endY,
      0.02,
      0.02
    );

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type: 'shape',
      bounds: normalized,
      shape: {
        kind,
        style: this.normalizeShapeStyle(style),
        points:
          (
            kind === 'line' ||
            kind === 'arrow'
          )
            ? [
                {
                  x: this.clamp(startX, 0, 1),
                  y: this.clamp(startY, 0, 1)
                },
                {
                  x: this.clamp(endX, 0, 1),
                  y: this.clamp(endY, 0, 1)
                }
              ]
            : undefined
      }
    };

    this.objects.set(object.id, object);
    this.touch();

    return object;
  }

  createDrawingObject(
    pageNumber: number,
    points: readonly StudioPoint[],
    style: StudioDrawingStyle,
    type: 'draw' | 'highlight'
  ): StudioObject | null {

    const normalizedPoints = this.normalizePoints(points);

    if (normalizedPoints.length < 2) {
      return null;
    }

    /**
     * Keep freehand/highlight bounds geometrically tight to the actual pointer
     * path. The SVG itself is allowed to render its round stroke caps outside
     * the tight geometry, so a fixed 0.004 page padding is unnecessary and
     * caused visible extra space at both ends of straight strokes.
     */
    const bounds = this.boundsFromPoints(
      normalizedPoints,
      0.0001
    );

    const object: StudioObject = {
      id: this.createObjectId(),
      pageNumber,
      type,
      bounds,
      drawing: {
        points: normalizedPoints,
        style: this.normalizeDrawingStyle(style, type)
      }
    };

    this.objects.set(object.id, object);
    this.touch();

    return object;
  }

  updateShapeStyle(
    objectId: string,
    style: Partial<StudioShapeStyle>
  ): StudioObject | null {

    const object = this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'shape' ||
      !object.shape
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      shape: {
        ...object.shape,
        style: this.normalizeShapeStyle({
          ...object.shape.style,
          ...style
        })
      }
    };

    this.objects.set(objectId, updated);
    this.touch();

    return updated;
  }

  updateDrawingStyle(
    objectId: string,
    style: Partial<StudioDrawingStyle>
  ): StudioObject | null {

    const object = this.objects.get(objectId);

    if (
      !object ||
      (
        object.type !== 'draw' &&
        object.type !== 'highlight'
      ) ||
      !object.drawing
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      bounds: this.boundsFromPoints(
        object.drawing.points,
        0.0001
      ),
      drawing: {
        ...object.drawing,
        style: this.normalizeDrawingStyle(
          {
            ...object.drawing.style,
            ...style
          },
          object.type
        )
      }
    };

    this.objects.set(objectId, updated);
    this.touch();

    return updated;
  }

  duplicateObject(
    objectId: string
  ): StudioObject | null {

    const source =
      this.objects.get(objectId);

    if (!source) {
      return null;
    }

    const duplicatedBounds =
      this.normalizeBounds({
        ...source.bounds,
        x: source.bounds.x + 0.02,
        y: source.bounds.y + 0.02
      });

    const deltaX =
      duplicatedBounds.x - source.bounds.x;
    const deltaY =
      duplicatedBounds.y - source.bounds.y;

    const duplicated: StudioObject =
      (
        source.type === 'draw' ||
        source.type === 'highlight'
      ) && source.drawing
        ? {
            ...source,
            id: this.createObjectId(),
            bounds: duplicatedBounds,
            drawing: {
              ...source.drawing,
              points: this.offsetPoints(
                source.drawing.points,
                deltaX,
                deltaY
              )
            }
          }
        : source.type === 'shape' && source.shape?.points
          ? {
              ...source,
              id: this.createObjectId(),
              bounds: duplicatedBounds,
              shape: {
                ...source.shape,
                points: this.offsetPoints(
                  source.shape.points,
                  deltaX,
                  deltaY
                ) as [StudioPoint, StudioPoint]
              }
            }
          : {
              ...source,
              id: this.createObjectId(),
              bounds: duplicatedBounds
            };

    this.objects.set(
      duplicated.id,
      duplicated
    );

    this.touch();

    return duplicated;
  }

  updateImageData(
    objectId: string,
    image: StudioImageData
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'image'
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      image
    };

    this.objects.set(
      objectId,
      updated
    );

    this.touch();

    return updated;
  }

  updateBounds(
    objectId: string,
    bounds: StudioObjectBounds
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (!object) {
      return null;
    }

    const normalizedBounds =
      this.normalizeBounds(bounds);

    const updated: StudioObject =
      (
        (
          object.type === 'draw' ||
          object.type === 'highlight'
        ) &&
        object.drawing
      )
        ? {
            ...object,
            bounds: normalizedBounds,
            drawing: {
              ...object.drawing,
              points: this.transformPointsToBounds(
                object.drawing.points,
                object.bounds,
                normalizedBounds
              )
            }
          }
        : (
            object.type === 'shape' &&
            object.shape?.points
          )
            ? {
                ...object,
                bounds: normalizedBounds,
                shape: {
                  ...object.shape,
                  points: this.transformPointsToBounds(
                    object.shape.points,
                    object.bounds,
                    normalizedBounds
                  ) as [
                    StudioPoint,
                    StudioPoint
                  ]
                }
              }
            : {
                ...object,
                bounds: normalizedBounds
              };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return updated;
  }

  updateText(
    objectId: string,
    text: string
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'text'
    ) {
      return null;
    }

    const updated: StudioObject = {
      ...object,
      text
    };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return updated;
  }

  updateTextStyle(
    objectId: string,
    style: Partial<StudioTextStyle>
  ): StudioObject | null {

    const object =
      this.objects.get(objectId);

    if (
      !object ||
      object.type !== 'text'
    ) {
      return null;
    }

    const currentStyle =
      object.textStyle ??
      DEFAULT_TEXT_STYLE;

    const nextStyle: StudioTextStyle = {
      fontSize: this.clamp(
        style.fontSize ??
          currentStyle.fontSize,
        0.006,
        0.12
      ),
      fontWeight:
        this.normalizeFontWeight(
          style.fontWeight ??
            currentStyle.fontWeight
        ),
      fontStyle:
        this.normalizeFontStyle(
          style.fontStyle ??
            currentStyle.fontStyle
        ),
      textAlign:
        this.normalizeTextAlign(
          style.textAlign ??
            currentStyle.textAlign
        )
    };

    const minimumHeightForFont =
      Math.min(1, nextStyle.fontSize * 1.6);

    const adjustedBounds: StudioObjectBounds =
      object.bounds.height < minimumHeightForFont
        ? this.normalizeBounds({
            ...object.bounds,
            height: minimumHeightForFont
          })
        : object.bounds;

    const updated: StudioObject = {
      ...object,
      bounds: adjustedBounds,
      textStyle: nextStyle
    };

    this.objects.set(
      objectId,
      updated
    );
    this.touch();

    return updated;
  }

  remove(
    objectId: string
  ): boolean {

    const removed = this.objects.delete(
      objectId
    );

    if (removed) {
      this.touch();
    }

    return removed;
  }

  clearPage(
    pageNumber: number
  ): void {

    let changed = false;

    for (
      const [
        id,
        object
      ] of this.objects
    ) {

      if (
        object.pageNumber === pageNumber
      ) {
        this.objects.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.touch();
    }
  }

  remapPageNumbers(mapping: ReadonlyMap<number, number>): void {
    let changed = false;
    for (const [id, object] of this.objects) {
      const pageNumber = mapping.get(object.pageNumber);
      if (pageNumber !== undefined && pageNumber !== object.pageNumber) {
        this.objects.set(id, { ...object, pageNumber });
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  duplicatePage(sourcePageNumber: number,targetPageNumber: number): void {

  const sourceObjects = this.listForPage(sourcePageNumber);
  for (const source of sourceObjects) {

    const clone: StudioObject = {
      ...structuredClone(source),
      id: this.createObjectId(),
      pageNumber: targetPageNumber
    };

    this.objects.set(clone.id,clone);
  }

  if (sourceObjects.length) {
    this.touch();
  }
}

  shiftPageNumbers(startPageNumber: number, delta: number): void {
    if (!delta) return;
    let changed = false;
    for (const [id, object] of this.objects) {
      if (object.pageNumber >= startPageNumber) {
        this.objects.set(id, { ...object, pageNumber: object.pageNumber + delta });
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  clearAll(): void {
    if (this.objects.size === 0) {
      return;
    }

    this.objects.clear();
    this.touch();
  }


  private offsetPoints(
    points: readonly StudioPoint[],
    deltaX: number,
    deltaY: number
  ): readonly StudioPoint[] {
    return points.map(point => ({
      x: this.clamp(point.x + deltaX, 0, 1),
      y: this.clamp(point.y + deltaY, 0, 1)
    }));
  }

  private normalizeDragBounds(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    minWidth: number,
    minHeight: number
  ): StudioObjectBounds {

    const width = Math.max(
      minWidth,
      Math.abs(endX - startX)
    );

    const height = Math.max(
      minHeight,
      Math.abs(endY - startY)
    );

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);

    return this.normalizeBounds({
      x,
      y,
      width,
      height
    });
  }

  private normalizePoints(
    points: readonly StudioPoint[]
  ): readonly StudioPoint[] {

    const finite = points
      .filter(
        point =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
      )
      .map(
        point => ({
          x: this.clamp(point.x, 0, 1),
          y: this.clamp(point.y, 0, 1)
        })
      );

    return finite;
  }

  private boundsFromPoints(
    points: readonly StudioPoint[],
    padding: number
  ): StudioObjectBounds {

    if (!points.length) {
      return {
        x: 0,
        y: 0,
        width: 0.0001,
        height: 0.0001
      };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const width = Math.max(
      0.0001,
      maxX - minX + padding * 2
    );

    const height = Math.max(
      0.0001,
      maxY - minY + padding * 2
    );

    return this.normalizeBounds({
      x: minX - padding,
      y: minY - padding,
      width,
      height
    });
  }

  private transformPointsToBounds(
    points: readonly StudioPoint[],
    oldBounds: StudioObjectBounds,
    newBounds: StudioObjectBounds
  ): readonly StudioPoint[] {

    return points.map(point => {
      const localX =
        oldBounds.width > 0
          ? (point.x - oldBounds.x) / oldBounds.width
          : 0.5;

      const localY =
        oldBounds.height > 0
          ? (point.y - oldBounds.y) / oldBounds.height
          : 0.5;

      return {
        x: this.clamp(
          newBounds.x +
            localX * newBounds.width,
          0,
          1
        ),
        y: this.clamp(
          newBounds.y +
            localY * newBounds.height,
          0,
          1
        )
      };
    });
  }

  private normalizeShapeStyle(
    style: StudioShapeStyle
  ): StudioShapeStyle {

    return {
      strokeColor:
        this.normalizeColor(
          style.strokeColor,
          '#00d4b3'
        ),
      fillColor:
        style.fillColor
          ? this.normalizeColor(
              style.fillColor,
              '#00d4b3'
            )
          : null,
      strokeWidth:
        this.clamp(
          style.strokeWidth,
          0.001,
          0.03
        ),
      opacity:
        this.clamp(
          style.opacity,
          0.05,
          1
        )
    };
  }

  private normalizeDrawingStyle(
    style: StudioDrawingStyle,
    type: 'draw' | 'highlight'
  ): StudioDrawingStyle {

    return {
      strokeColor:
        this.normalizeColor(
          style.strokeColor,
          type === 'highlight'
            ? '#f4d03f'
            : '#00d4b3'
        ),
      strokeWidth:
        this.clamp(
          style.strokeWidth,
          0.001,
          0.05
        ),
      opacity:
        this.clamp(
          style.opacity,
          0.05,
          1
        )
    };
  }

  private cloneObject(
    object: StudioObject
  ): StudioObject {

    return JSON.parse(
      JSON.stringify(object)
    ) as StudioObject;
  }

  private normalizeColor(
    value: string,
    fallback: string
  ): string {

    if (
      typeof value !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(value.trim())
    ) {
      return fallback;
    }

    return value.trim().toLowerCase();
  }

  private normalizeBounds(
    bounds: StudioObjectBounds
  ): StudioObjectBounds {

    const width =
      this.clamp(
        bounds.width,
        0.0001,
        1
      );

    const height =
      this.clamp(
        bounds.height,
        0.0001,
        1
      );

    return {
      x: this.clamp(
        bounds.x,
        0,
        Math.max(
          0,
          1 - width
        )
      ),
      y: this.clamp(
        bounds.y,
        0,
        Math.max(
          0,
          1 - height
        )
      ),
      width,
      height
    };
  }

  private normalizeTextAlign(
    value: StudioTextAlign
  ): StudioTextAlign {

    return (
      value === 'center' ||
      value === 'right'
        ? value
        : 'left'
    );
  }

  private normalizeFontWeight(
    value: StudioTextFontWeight
  ): StudioTextFontWeight {

    return (
      value === 700
        ? 700
        : 400
    );
  }

  private normalizeFontStyle(
    value: StudioTextFontStyle
  ): StudioTextFontStyle {

    return (
      value === 'italic'
        ? 'italic'
        : 'normal'
    );
  }

  private clamp(
    value: number,
    min: number,
    max: number
  ): number {

    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.min(
      max,
      Math.max(
        min,
        value
      )
    );
  }

  private touch(): void {
    this.revision.update(value => value + 1);
  }

  private createObjectId(): string {

    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `studio-object-${crypto.randomUUID()}`;
    }

    return (
      `studio-object-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );
  }
}

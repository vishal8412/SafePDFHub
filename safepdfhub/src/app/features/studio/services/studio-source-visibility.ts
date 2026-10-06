import type { StudioObject } from '../models/studio-selection.model';

/** Source labels and nested image paints disappear with a replaced visual region.
 * Test original geometry, so dragging the replacement never exposes stale targets.
 * Newly added annotations are independent and remain visible. */
export function visibleStudioSources(objects: readonly StudioObject[]): StudioObject[] {
  const replacements = objects.filter(object => object.pdfImage?.replaced);
  return objects.filter(object => {
    if (!object.pdfText && !object.pdfImage) return true;
    return !replacements.some(image => {
      if (image.id === object.id || image.pageNumber !== object.pageNumber) return false;
      const region = image.pdfImage!.sourceBounds ?? image.bounds;
      const bounds = object.pdfImage?.sourceBounds ?? object.bounds;
      const epsilon = 1e-6;
      // A paragraph crossing an image is still an editable paragraph. A centre
      // hit alone used to hide its text outside the replaced image as well.
      return bounds.x >= region.x - epsilon && bounds.y >= region.y - epsilon
        && bounds.x + bounds.width <= region.x + region.width + epsilon
        && bounds.y + bounds.height <= region.y + region.height + epsilon
        && bounds.width * bounds.height < region.width * region.height;
    });
  });
}

/** Apply flow as a delta to live object geometry, so dragging stays responsive
 * while an asynchronous export preview still describes the previous position. */
export function studioDisplayBounds(
  current: StudioObject['bounds'],
  rendered?: StudioObject['bounds'],
  snapshot?: StudioObject['bounds'],
): StudioObject['bounds'] {
  if (!rendered || !snapshot) return current;
  return {
    x: current.x + rendered.x - snapshot.x,
    y: current.y + rendered.y - snapshot.y,
    width: current.width + rendered.width - snapshot.width,
    height: current.height + rendered.height - snapshot.height,
  };
}

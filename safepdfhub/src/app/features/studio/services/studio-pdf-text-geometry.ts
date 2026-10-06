import type { StudioObject, StudioPdfTextSource } from '../models/studio-selection.model';

/** Source erase geometry stays immutable; the edited destination may be resized. */
export function pdfTextDestination(object: StudioObject, rotation = 0): StudioPdfTextSource | undefined {
  const source = object.pdfText;
  if (!source?.sourceBounds) return source;
  const width = source.pageWidthPdf ?? 1, height = source.pageHeightPdf ?? 1;
  const dx = (object.bounds.x - source.sourceBounds.x) * width;
  const dy = (object.bounds.y - source.sourceBounds.y) * height;
  const angle = ((rotation % 360) + 360) % 360;
  const [tx, ty] = angle === 90 ? [dy, dx] : angle === 180 ? [-dx, dy]
    : angle === 270 ? [-dy, -dx] : [dx, -dy];
  const transform = [...source.transform] as [number, number, number, number, number, number];
  transform[4] += tx; transform[5] += ty;
  return { ...source, transform,
    textWidthPdf: object.bounds.width * width,
    textHeightPdf: object.bounds.height * height };
}

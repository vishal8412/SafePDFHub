/** Shared by the canvas stage and source/blank-page fit calculations. */
export const STUDIO_CANVAS_PADDING = 12;

/** PDF points use 72 units/inch; browsers use 96 CSS pixels/inch. */
export const PDF_TO_CSS_UNITS = 96 / 72;
export function studioZoomScale(percent: number): number {
  const value = Number.isFinite(percent) ? percent : 100;
  return Math.min(200, Math.max(50, value)) / 100 * PDF_TO_CSS_UNITS;
}
export function studioZoomPercent(renderScale: number): number {
  return Math.round(renderScale / PDF_TO_CSS_UNITS * 100);
}

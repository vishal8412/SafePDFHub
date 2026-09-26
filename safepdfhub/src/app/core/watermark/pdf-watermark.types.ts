export type PdfWatermarkKind = 'text' | 'image';

export type PdfWatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PdfWatermarkFont = 'Helvetica' | 'Times-Roman' | 'Courier';

export type PdfWatermarkPageSelection =
  | { readonly mode: 'all' }
  | { readonly mode: 'current'; readonly page: number }
  | { readonly mode: 'ranges'; readonly ranges: string };

export interface PdfWatermarkRequest {
  readonly kind: PdfWatermarkKind;
  readonly text?: string;
  readonly imageFile?: File;
  readonly opacity: number;
  readonly rotation: number;
  readonly position: PdfWatermarkPosition;
  readonly pageSelection: PdfWatermarkPageSelection;
  readonly tiled: boolean;
  readonly fontSize: number;
  readonly font: PdfWatermarkFont;
  readonly color: string;
  /** Image width as a percentage of the page width. */
  readonly imageScalePercent: number;
}

export interface PdfWatermarkResult {
  readonly file: File;
  readonly pageCount: number;
  readonly watermarkedPageCount: number;
  readonly durationMs: number;
}

export type PdfWatermarkErrorCode =
  | 'INPUT_INVALID'
  | 'PAGE_SELECTION_INVALID'
  | 'TEXT_INVALID'
  | 'IMAGE_INVALID'
  | 'OPTION_INVALID'
  | 'OUTPUT_INVALID'
  | 'CANCELLED';

export class PdfWatermarkError extends Error {
  constructor(
    message: string,
    readonly code: PdfWatermarkErrorCode
  ) {
    super(message);
    this.name = 'PdfWatermarkError';
  }
}

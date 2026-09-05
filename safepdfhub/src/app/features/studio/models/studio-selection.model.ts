export type StudioObjectType =
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'shape'
  | 'comment'
  | 'link';

export type StudioTextAlign =
  | 'left'
  | 'center'
  | 'right';

export type StudioTextFontWeight =
  | 400
  | 700;

export type StudioTextFontStyle =
  | 'normal'
  | 'italic';

/**
 * Text appearance is stored in normalized page-space terms.
 *
 * fontSize is the fraction of the rendered PDF page height.
 * For example, 0.02 means 2% of the current page height.
 *
 * This keeps text visually attached to the PDF when zooming,
 * fitting, and resizing the browser.
 */
export interface StudioTextStyle {
  readonly fontSize: number;
  readonly fontWeight: StudioTextFontWeight;
  readonly fontStyle: StudioTextFontStyle;
  readonly textAlign: StudioTextAlign;
}

/**
 * Object bounds are stored in normalized page coordinates.
 *
 * x, y, width and height are all expected to be in the
 * 0..1 range relative to the current PDF page.
 */
export interface StudioObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioImageData {
  readonly dataUrl: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly aspectRatio: number;
}

export type StudioShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow';

export interface StudioShapeStyle {
  readonly strokeColor: string;
  readonly fillColor: string | null;
  readonly strokeWidth: number;
  readonly opacity: number;
}

export interface StudioPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioShapeData {
  readonly kind: StudioShapeKind;
  readonly style: StudioShapeStyle;
  /**
   * For line/arrow shapes, endpoints are stored in normalized page space.
   * Keeping the endpoints prevents diagonal lines/arrows from collapsing
   * into a horizontal line when the selection bounds are resized.
   */
  readonly points?: readonly [
    StudioPoint,
    StudioPoint
  ];
}

export interface StudioDrawingStyle {
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly opacity: number;
}

export interface StudioDrawingData {
  readonly points: readonly StudioPoint[];
  readonly style: StudioDrawingStyle;
}

/** F7.2 — Persistent Studio comment/annotation payload. */

export interface StudioCommentData {
  readonly content: string;
  readonly author: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly resolved: boolean;
}

export interface StudioObject {
  readonly id: string;
  readonly pageNumber: number;
  readonly type: StudioObjectType;
  readonly bounds: StudioObjectBounds;

  readonly text?: string;
  readonly textStyle?: StudioTextStyle;

  readonly image?: StudioImageData;

  readonly shape?: StudioShapeData;

  readonly drawing?: StudioDrawingData;

  /**
   * F7.2 — Comment/annotation data.
   *
   * Present only when type === 'comment'.
   */
  readonly comment?: StudioCommentData;
}

export interface StudioSelection {
  readonly objectId: string;
  readonly pageNumber: number;
  readonly bounds: StudioObjectBounds;
  readonly type: StudioObjectType;
}

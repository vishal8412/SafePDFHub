import type { SigningAsset } from '../../../core/signing/models/signing.models';

export type StudioObjectType =
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'shape'
  | 'comment'
  | 'link'
  | 'signature';

export type StudioTextAlign =
  | 'left'
  | 'center'
  | 'right';

export type StudioTextFontWeight =
  | 400
  | 700
  | 900;

export type StudioTextFontStyle =
  | 'normal'
  | 'italic';

/** Browser-safe PDF font families available without external font embedding. */
export type StudioTextFontFamily =
  | 'Helvetica'
  | 'Times Roman'
  | 'Courier';

/**
 * Editor-side text appearance for user-created Studio text and the visual
 * preview of an existing PDF text object.
 *
 * Existing PDF typography is authoritative in StudioPdfTextSource; the
 * fontSize field here is only a normalized UI value and must not be treated
 * as the original PDF font size during export.
 */
export interface StudioPdfTextSource {
  /** Original text extracted from the uploaded PDF. */
  readonly originalText: string;
  readonly fontName: string;
  /** Raw PDF.js transform retained for future higher-fidelity replacement. */
  readonly transform: readonly [number, number, number, number, number, number];
  /** True only after the user changes the original PDF text. */
  readonly edited: boolean;
  /** Detected text size as a fraction of page display height. */
  readonly detectedFontSize?: number;
  /** Detected source rotation in display degrees. */
  readonly rotation?: number;
  /** Estimated underlying PDF background used to cover the original text. */
  readonly backgroundColor?: string;
  /** Estimated original text color used for the replacement. */
  readonly textColor?: string;
  /** Source line-height ratio when known. */
  readonly lineHeight?: number;
  /** Human-readable family recovered from the actual embedded PDF font program. */
  readonly sourceFontFamily?: string | null;
  /**
   * Exact PDF.js-loaded font face used to render the source glyphs in the
   * browser. When available, this is the authoritative live-editor family.
   */
  readonly sourceFontCssFamily?: string | null;
  readonly sourceFontWeight?: StudioTextFontWeight;
  readonly sourceFontStyle?: StudioTextFontStyle;
  /** Legacy PDF.js normalized font metrics; do not use as PDF-point values. */
  readonly ascent?: number | null;
  readonly descent?: number | null;
  /** Phase 2 — authoritative PDF-space font metrics. */
  readonly ascentPdf?: number | null;
  readonly descentPdf?: number | null;
  /** Phase 2 — immutable PDF-space source metrics captured at extraction time. */
  readonly pageWidthPdf?: number;
  readonly pageHeightPdf?: number;
  readonly fontSizePdf?: number;
  readonly textWidthPdf?: number;
  readonly textHeightPdf?: number;
  readonly lineHeightPdf?: number;
  readonly transformScaleX?: number;
  readonly transformScaleY?: number;
  readonly baselineXPdf?: number;
  readonly baselineYPdf?: number;
  /** Original PDF.js run boundaries retained for source-position-faithful line replacement. */
  readonly sourceRuns?: readonly {
    readonly text: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly baselineXPdf: number;
    readonly widthPdf: number;
  }[];
  /** Extra cover around replaced source glyphs, in PDF points. */
  readonly coverPadding?: number;
  /** Auto-fit keeps replacement paragraphs inside the selected source box. */
  readonly fitMode?: 'original' | 'auto';
  /**
   * Horizontal glyph-metric calibration captured against the original PDF text.
   * This is a stable source-font correction, not an auto-fit for edited text.
   */
  readonly metricScaleX?: number;
  /** Existing PDF text keeps source typography unless an explicit future override is added. */
  readonly typographyLocked?: boolean;
}

export interface StudioTextStyle {
  readonly fontSize: number;
  readonly fontWeight: StudioTextFontWeight;
  readonly fontStyle: StudioTextFontStyle;
  readonly textAlign: StudioTextAlign;
  /**
   * Exportable standard PDF font family.
   * Optional for backward compatibility with documents created before
   * font-family controls were introduced. The editor normalizes missing
   * values to Helvetica when reading or updating text.
   */
  readonly fontFamily?: StudioTextFontFamily;
  /** Line-height multiplier (for example 1.2). */
  readonly lineHeight: number;
  /** Character tracking in em units; 0 keeps natural glyph spacing. */
  readonly letterSpacing: number;
  /** Explicit text color for new Studio text; existing PDF text can override it. */
  readonly color: string;
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

export type StudioLinkKind = 'url' | 'page';

export interface StudioLinkData {
  readonly kind: StudioLinkKind;
  readonly url: string;
  readonly targetPage: number;
}

export interface StudioCommentData {
  readonly content: string;
  readonly author: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly resolved: boolean;
}


export interface StudioPdfImageSource {
  readonly sourceName: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly rotation: number;
  readonly replaced: boolean;
  readonly fitMode: 'fit' | 'fill' | 'stretch';
  /** Phase 5C.4 — how the source-image box is reconstructed before replacement artwork is painted. */
  readonly backgroundMode?: 'auto' | 'solid' | 'white' | 'pixel' | 'layered';
  /** Edge-aware sampled background colour, captured from the replacement image. */
  readonly backgroundColor?: string;
  /** Optional confidence for the edge reconstruction. */
  readonly backgroundConfidence?: 'high' | 'medium' | 'low';
  /** Phase 5C.5 — pixel-level edge extension raster used for textured/gradient fit margins. */
  readonly pixelReconstructionDataUrl?: string;
  /** Confidence that the generated edge extension will blend cleanly at the replacement seam. */
  readonly pixelReconstructionConfidence?: 'high' | 'medium' | 'low';
  /** Phase 5C.6 — multi-layer base reconstruction for complex gradients/textures. */
  readonly layeredReconstructionDataUrl?: string;
  /** Transparent seam overlay painted after the replacement artwork. */
  readonly seamBlendDataUrl?: string;
  /** Width of the directional seam blend in source-raster pixels. */
  readonly seamBlendWidth?: number;
  /** Confidence that directional edge continuation will blend cleanly. */
  readonly seamBlendConfidence?: 'high' | 'medium' | 'low';
}


export type StudioPdfTextFitMode =
  | 'original'
  | 'auto';

/** Common immutable identity and geometry shared by every Studio object. */
export interface StudioObjectBase {
  readonly id: string;
  readonly pageNumber: number;
  readonly bounds: StudioObjectBounds;

  /** Compatibility view for generic renderer/selection code. */
  readonly text?: string;
  readonly textStyle?: StudioTextStyle;
  readonly pdfText?: StudioPdfTextSource;
  readonly image?: StudioImageData;
  readonly pdfImage?: StudioPdfImageSource;
  readonly shape?: StudioShapeData;
  readonly drawing?: StudioDrawingData;
  readonly comment?: StudioCommentData;
  readonly link?: StudioLinkData;
}

/** User-created text. It has no PDF source metadata. */
export interface StudioTextObject extends StudioObjectBase {
  readonly type: 'text';
  readonly text: string;
  readonly textStyle: StudioTextStyle;
  readonly pdfText?: never;
}

/** Existing text extracted from the uploaded PDF. Source metadata is required. */
export interface StudioPdfTextObject extends StudioObjectBase {
  readonly type: 'text';
  readonly text: string;
  readonly textStyle: StudioTextStyle;
  readonly pdfText: StudioPdfTextSource;
}

/** User-inserted image. */
export interface StudioImageObject extends StudioObjectBase {
  readonly type: 'image';
  readonly image: StudioImageData;
  readonly pdfImage?: never;
}

/** Existing image detected in the uploaded PDF. Replacement artwork is optional until replaced. */
export interface StudioPdfImageObject extends StudioObjectBase {
  readonly type: 'image';
  readonly image?: StudioImageData;
  readonly pdfImage: StudioPdfImageSource;
}

export interface StudioDrawObject extends StudioObjectBase {
  readonly type: 'draw';
  readonly drawing: StudioDrawingData;
}

export interface StudioHighlightObject extends StudioObjectBase {
  readonly type: 'highlight';
  readonly drawing: StudioDrawingData;
}

export interface StudioShapeObject extends StudioObjectBase {
  readonly type: 'shape';
  readonly shape: StudioShapeData;
}

export interface StudioCommentObject extends StudioObjectBase {
  readonly type: 'comment';
  readonly comment: StudioCommentData;
}

export interface StudioLinkObject extends StudioObjectBase {
  readonly type: 'link';
  readonly link: StudioLinkData;
}

export interface StudioSignatureObject extends StudioObjectBase {
  readonly type: 'signature';
  readonly signing: {
    readonly kind: 'signature' | 'initials' | 'text' | 'date' | 'checkbox';
    readonly asset?: SigningAsset;
    /** Lightweight reference used by bulk-applied fields to avoid duplicating large data URLs. */
    readonly assetId?: string;
    readonly value?: string;
    readonly fontFamily?: string;
    readonly fontSize?: number;
    readonly fontStyle?: 'normal' | 'italic';
    readonly color?: string;
    readonly checked?: boolean;
    readonly opacity: number;
    readonly bulkGroupId?: string;
  };
}

/**
 * Complete Studio object union.
 *
 * Text and image objects are intentionally split into normal Studio objects
 * and objects representing original PDF content. This prevents future PDF
 * editing code from accidentally treating source PDF metadata as optional
 * editor styling.
 */
export type StudioObject =
  | StudioTextObject
  | StudioPdfTextObject
  | StudioImageObject
  | StudioPdfImageObject
  | StudioDrawObject
  | StudioHighlightObject
  | StudioShapeObject
  | StudioCommentObject
  | StudioLinkObject
  | StudioSignatureObject;

/** True when the object is a user-created text object. */
export function isStudioTextObject(
  object: StudioObject
): object is StudioTextObject {
  return object.type === 'text' && !object.pdfText;
}

/** True when the object represents original PDF text. */
export function isStudioPdfTextObject(
  object: StudioObject
): object is StudioPdfTextObject {
  return object.type === 'text' && !!object.pdfText;
}

/** True when the object is a user-inserted image. */
export function isStudioImageObject(
  object: StudioObject
): object is StudioImageObject {
  return object.type === 'image' && !object.pdfImage;
}

/** True when the object represents an original PDF image. */
export function isStudioPdfImageObject(
  object: StudioObject
): object is StudioPdfImageObject {
  return object.type === 'image' && !!object.pdfImage;
}

export interface StudioSelection {
  readonly objectId: string;
  readonly pageNumber: number;
  readonly bounds: StudioObjectBounds;
  readonly type: StudioObjectType;
}

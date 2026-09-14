/**
 * Phase 5A — Read-only map of content already present in an uploaded PDF.
 * Coordinates are normalized to 0..1 and are used as the bridge between
 * PDF.js extraction and future editable-object overlays.
 */
export type PdfTextTransform = readonly [number, number, number, number, number, number];
export type PdfSourceFontWeight = 400 | 700 | 900;

/** Exact source PDF.js text-run placement retained when several runs are grouped into one visual edit line. */
export interface PdfSourceTextRun {
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly baselineXPdf: number;
  readonly widthPdf: number;
}

export interface PdfExistingTextBlock {
  readonly id: string;
  readonly pageNumber: number;
  readonly text: string;
  readonly fontName: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly transform: PdfTextTransform;
  readonly detectedFontSize: number;
  readonly rotation: number;
  readonly lineHeight: number;
  /** PDF.js style family when exposed; useful only as a human-readable fallback. */
  readonly fontFamily: string | null;
  /** Human-readable family recovered from the actual embedded PDF font program. */
  readonly sourceFontFamily: string | null;
  /**
   * Exact PDF.js loaded font family used by the browser renderer.
   * This is intentionally separate from fontFamily: PDF.js can expose a
   * generic/fallback family even when the PDF has an embedded subset font.
   */
  readonly sourceFontCssFamily: string | null;
  readonly fontWeight: PdfSourceFontWeight;
  readonly fontStyle: 'normal' | 'italic';
  /** Exact source fill color resolved from the PDF graphics state when available. */
  readonly textColor: string | null;
  /** PDF.js font metrics are normalized ratios; retained for backward compatibility. */
  readonly ascent: number | null;
  readonly descent: number | null;
  /** PDF-space ascent/descent derived once from the source font size. */
  readonly ascentPdf: number | null;
  readonly descentPdf: number | null;

  /** Phase 2 — authoritative PDF-space typography snapshot. */
  readonly pageWidthPdf: number;
  readonly pageHeightPdf: number;
  readonly fontSizePdf: number;
  readonly textWidthPdf: number;
  readonly textHeightPdf: number;
  readonly lineHeightPdf: number;
  readonly transformScaleX: number;
  readonly transformScaleY: number;
  readonly baselineXPdf: number;
  readonly baselineYPdf: number;
  /** Original PDF.js run boundaries used to preserve inter-run spacing during replacement. */
  readonly sourceRuns?: readonly PdfSourceTextRun[];
}

export interface PdfExistingImageBlock {
  readonly id: string;
  readonly pageNumber: number;
  /** Best-effort normalized bounds from the PDF graphics transform. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceName: string | null;
  readonly rotation: number;
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface PdfPageContentAnalysis {
  readonly pageNumber: number;
  readonly textBlocks: readonly PdfExistingTextBlock[];
  readonly imageBlocks: readonly PdfExistingImageBlock[];
  readonly imagePaintCount: number;
  readonly analyzedAt: number;
}

export interface PdfDocumentContentAnalysis {
  readonly documentId: string;
  readonly pageCount: number;
  readonly analyzedPages: number;
  readonly totalTextBlocks: number;
  readonly totalImagePaints: number;
  readonly pages: Readonly<Record<number, PdfPageContentAnalysis>>;
  readonly status: 'idle' | 'analyzing' | 'ready' | 'error';
  readonly error: string | null;
}

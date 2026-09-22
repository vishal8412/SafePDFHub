export type SigningAssetSource = 'drawn' | 'typed' | 'uploaded';
export type SigningAssetKind = 'signature' | 'initials';
export type SigningFieldKind = 'signature' | 'initials' | 'text' | 'date' | 'checkbox';

export interface SigningAsset {
  readonly id: string;
  readonly kind: SigningAssetKind;
  readonly source: SigningAssetSource;
  readonly dataUrl: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly createdAt: number;
  readonly label?: string;
}

export interface SigningBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SigningField {
  readonly id: string;
  readonly pageNumber: number;
  readonly kind: SigningFieldKind;
  readonly bounds: SigningBounds;
  readonly value?: string;
  readonly asset?: SigningAsset;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly checked?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
  /** Fields created together by Apply to pages share this group id. */
  readonly bulkGroupId?: string;
  readonly fontStyle?: 'normal' | 'italic';
}

export interface SigningPageInfo {
  readonly pageNumber: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly width: number;
  readonly height: number;
}

export const SIGNATURE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const MAX_SIGNATURE_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Maximum decoded pixel count for uploaded signature artwork. */
export const MAX_SIGNATURE_IMAGE_PIXELS = 12_000_000;
/** Maximum decoded width or height for uploaded signature artwork. */
export const MAX_SIGNATURE_IMAGE_DIMENSION = 8_000;
/** Browser-side safety ceiling for a single PDF loaded by the Sign PDF workflow. */
export const MAX_SIGNING_PDF_BYTES = 100 * 1024 * 1024;
/** Browser-side safety ceiling for page count in the interactive Sign PDF workflow. */
export const MAX_SIGNING_PDF_PAGES = 500;
/** Maximum preview canvas pixel count before the renderer scales down automatically. */
export const MAX_SIGNING_PREVIEW_PIXELS = 16_000_000;

export function isSigningFieldKind(value: string): value is SigningFieldKind {
  return ['signature', 'initials', 'text', 'date', 'checkbox'].includes(value);
}

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

export function isSigningFieldKind(value: string): value is SigningFieldKind {
  return ['signature', 'initials', 'text', 'date', 'checkbox'].includes(value);
}

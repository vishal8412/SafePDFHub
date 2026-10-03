export type PdfStructuralValidationReason =
  | 'PARSE_FAILED'
  | 'PAGE_COUNT_MISMATCH'
  | 'PAGE_GEOMETRY_MISMATCH'
  | 'PAGE_ROTATION_MISMATCH';

export interface PdfStructuralValidationResult {
  valid: boolean;
  reason: PdfStructuralValidationReason | null;
}

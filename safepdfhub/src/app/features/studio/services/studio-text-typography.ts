import type { StudioObject, StudioPdfTextSource } from '../models/studio-selection.model';

export function pdfFontSize(source: StudioPdfTextSource | undefined): number | undefined {
  return source?.replacementFontSizePdf ?? source?.fontSizePdf;
}
export function textFontWeight(object: StudioObject): 400 | 700 | 900 {
  return object.pdfText?.replacementFontWeight ?? object.pdfText?.sourceFontWeight ?? object.textStyle?.fontWeight ?? 400;
}
export function textFontStyle(object: StudioObject): 'normal' | 'italic' {
  return object.pdfText?.replacementFontStyle ?? object.pdfText?.sourceFontStyle ?? object.textStyle?.fontStyle ?? 'normal';
}
/** An embedded regular face cannot become bold by changing its font label. */
export function pdfFontFaceChanged(object: StudioObject): boolean {
  const source = object.pdfText;
  return !!source && (textFontWeight(object) !== (source.sourceFontWeight ?? 400)
    || textFontStyle(object) !== (source.sourceFontStyle ?? 'normal'));
}

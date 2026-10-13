import { validateWordSelection, wordPdfName, WORD_INPUT_BYTES, paperSizeLabel } from './word-to-pdf.service';
describe('Word upload validation', () => {
  it('accepts DOCX including uppercase extension', () =>
    expect(validateWordSelection(new File(['PK'], 'Draft.DOCX'))).toBeNull());
  it('rejects legacy DOC with actionable guidance', () =>
    expect(validateWordSelection(new File(['x'], 'draft.doc'))).toContain('Save As'));
  it('rejects empty files', () =>
    expect(validateWordSelection(new File([], 'draft.docx'))).toContain('non-empty'));
  it('enforces the exact byte boundary', () => {
    expect(validateWordSelection({ name: 'x.docx', size: WORD_INPUT_BYTES } as File)).toBeNull();
    expect(validateWordSelection({ name: 'x.docx', size: WORD_INPUT_BYTES + 1 } as File)).toContain(
      '200 MB',
    );
  });
  it('produces a safe PDF name', () =>
    expect(wordPdfName('report:name.DOCX')).toBe('report_name.pdf'));
});

describe('Word paper size guidance', () => {
  it('recognizes Word A4 dimensions in twips', () => expect(paperSizeLabel(595.5,842)).toBe('A4'));
  it('distinguishes Letter and landscape', () => expect(paperSizeLabel(792,612)).toBe('Letter landscape'));
});

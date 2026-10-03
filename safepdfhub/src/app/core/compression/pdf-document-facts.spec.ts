import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentFacts, rememberSourceFacts, sourceFactsFor } from './pdf-document-facts';

describe('Worker source facts', () => {
  it('keeps every page and metadata field and never reuses facts by filename or size', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([612, 792]); pdf.addPage([300, 500]); pdf.setTitle('Original');
    pdf.setCreationDate(new Date('2020-01-01T00:00:00Z'));
    const facts = captureDocumentFacts(pdf);
    const first = new File(['abc'], 'same.pdf'), different = new File(['xyz'], 'same.pdf');
    rememberSourceFacts(first, facts);
    expect(sourceFactsFor(first)?.pages).toHaveLength(2);
    expect(sourceFactsFor(first)?.metadata).toContain('2020-01-01T00:00:00.000Z');
    expect(sourceFactsFor(different)).toBeUndefined();
    pdf.setTitle('Changed');
    expect(facts.metadata[0]).toBe('Original');
  });
});

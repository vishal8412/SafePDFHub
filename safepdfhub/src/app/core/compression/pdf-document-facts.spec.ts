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

it('retains empty scanner dates without throwing during validation', async () => {
  const pdf = await PDFDocument.create({updateMetadata:false});
  pdf.addPage();
  pdf.setTitle('Scanned pages');
  const {PDFDict, PDFName, PDFString} = await import('pdf-lib');
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) throw Error('Missing test Info dictionary');
  info.set(PDFName.of('ModDate'), PDFString.of(''));
  info.set(PDFName.of('CreationDate'), PDFString.of('not-a-date'));
  const source = captureDocumentFacts(pdf);
  const parsed = await PDFDocument.load(await pdf.save(), {updateMetadata:false});
  expect(captureDocumentFacts(parsed)).toEqual(source);
});

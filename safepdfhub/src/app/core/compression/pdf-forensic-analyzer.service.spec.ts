import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PdfForensicAnalyzerService } from './pdf-forensic-analyzer.service';

describe('PdfForensicAnalyzerService real PDF resources', () => {
  it('measures duplicate indirect streams and page-content duplication', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < 2; i++) {
      const ref = pdf.context.register(pdf.context.stream('q Q\n'));
      pdf.addPage().node.set(PDFName.of('Contents'), ref);
    }
    const file = new File([new Uint8Array(await pdf.save({ useObjectStreams: false }))], 'fixture.pdf');
    const result = await new PdfForensicAnalyzerService().analyzeDirect(file, { numPages: 0 });
    expect(result.pageCount).toBe(2);
    expect(result.duplicateStreamGroupCount).toBe(1);
    expect(result.duplicateStreamBytes).toBe(4);
    expect(result.pageContentStreamCount).toBe(2);
    expect(result.duplicatePageContentBytes).toBe(4);
  });
  it('returns empty resource metrics for a PDF without page resources', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage(); pdf.setTitle('Title');
    const file = new File([new Uint8Array(await pdf.save())], 'fixture.pdf');
    const result = await new PdfForensicAnalyzerService().analyzeDirect(file, { numPages: 0 });
    expect(result.pageCount).toBe(1);
    expect(result.imageResourceCount).toBe(0);
    expect(result.metadata.title).toBe('Title');
    expect(result.partial).toBe(false);
  });
});

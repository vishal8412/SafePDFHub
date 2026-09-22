import { PDFDocument } from 'pdf-lib';
import { SigningPdfTextService } from './signing-pdf-text.service';

describe('SigningPdfTextService', () => {
  it('draws native PDF text into the supplied page', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const service = new SigningPdfTextService();

    await service.drawText(
      pdf,
      page,
      'Signed by SafePDFHub',
      { x: 80, y: 680, width: 300, height: 40 },
      { fontFamily: 'Inter, Arial, sans-serif', fontSize: 16, color: '#121923', opacity: 1 },
    );

    const bytes = await pdf.save({ useObjectStreams: false });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const raw = new TextDecoder().decode(bytes);
    expect(raw).not.toContain('/Subtype /Image');

    const reopened = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
  });

  it('supports rotated native text and CSS-pixel font sizing', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const service = new SigningPdfTextService();

    await expect(
      service.drawText(
        pdf,
        page,
        '20/09/2026',
        { x: 120, y: 240, width: 160, height: 80 },
        { fontFamily: 'Segoe Script, cursive', fontSize: 16, fontStyle: 'italic', cssPixels: true },
        90,
      ),
    ).resolves.toBeUndefined();
  });
});

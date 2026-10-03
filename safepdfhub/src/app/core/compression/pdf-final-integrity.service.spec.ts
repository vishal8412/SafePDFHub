import { PDFDocument } from 'pdf-lib';
import { PdfVisualFidelityService } from './pdf-visual-fidelity.service';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PdfFinalIntegrityService } from './pdf-final-integrity.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';

describe('PdfFinalIntegrityService — V2.6', () => {
  let service: PdfFinalIntegrityService;
  let pdfJsLoader: { load: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    pdfJsLoader = { load: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        PdfFinalIntegrityService,
        { provide: PdfJsLoaderService, useValue: pdfJsLoader },
      ],
    });
    service = TestBed.inject(PdfFinalIntegrityService);
  });

  it('fails closed when PDF loading/certification cannot be completed', async () => {
    pdfJsLoader.load.mockRejectedValue(new Error('PDF.js unavailable'));

    const source = new File([new Uint8Array([1, 2, 3])], 'source.pdf', { type: 'application/pdf' });
    const candidate = new File([new Uint8Array([4, 5, 6])], 'candidate.pdf', { type: 'application/pdf' });

    const result = await service.certify(source, candidate);

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('Final integrity certification could not be completed');
  });

  it('does not expose a sampled-page limit in the V2.6 contract', () => {
    expect((service as unknown as { maxSamplePages?: number }).maxSamplePages).toBeUndefined();
  });
});


describe('Final integrity visual gate', () => {
  it('rejects changed appearance even when metadata, text and annotations match', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([612, 792]);
    const source = new File([new Uint8Array(await pdf.save({ useObjectStreams: false }))], 'source.pdf');
    const candidate = new File([new Uint8Array(await pdf.save())], 'candidate.pdf');
    const makeDocument = () => ({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [] }),
        getAnnotations: async () => [],
        cleanup: vi.fn(),
      }),
      destroy: async () => undefined,
    });
    const loader = { load: async () => ({ getDocument: () => ({
      promise: Promise.resolve(makeDocument()), destroy: async () => undefined,
    }) }) };
    const visual = { validateDocuments: vi.fn(async () => ({ status: 'rejected', reason: 'pixel mismatch' })) };
    const service = new PdfFinalIntegrityService(loader as never, visual as never);
    const result = await service.certify(source, candidate);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('Visual fidelity failed');
    expect(visual.validateDocuments).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'light', undefined);
  });
});

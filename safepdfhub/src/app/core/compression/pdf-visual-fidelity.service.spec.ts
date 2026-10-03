import { describe, expect, it, vi } from 'vitest';
import { PdfVisualFidelityService } from './pdf-visual-fidelity.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalysis } from './pdf-forensic.models';

function file(): File {
  return new File([new Uint8Array([1, 2, 3])], 'fixture.pdf', { type: 'application/pdf' });
}

function forensic(): PdfForensicAnalysis {
  return {
    version: 1, fileSize: 3, pdfHeader: '%PDF-1.7', pageCount: 3, sampledPageCount: 3,
    objectCount: 3, streamObjectCount: 2, streamBytes: 2, uniqueStreamCount: 2,
    duplicateStreamGroupCount: 0, duplicateStreamBytes: 0, pageContentStreamCount: 2,
    pageContentStreamBytes: 2, uniquePageContentStreamCount: 2, duplicatePageContentStreamGroupCount: 0,
    duplicatePageContentBytes: 0, imageResourceCount: 1, uniqueImageResourceCount: 1, imageBytes: 1,
    imageReferenceCount: 1, imageOperatorCount: 1, imagePages: 1, sampledImageAreaRatio: 0.4,
    fontResourceCount: 1, formXObjectCount: 0, patternResourceCount: 0, shadingResourceCount: 0,
    duplicateStreams: [], duplicatePageContentStreams: [], imageResources: [], sampledPages: [
      { pageNumber: 1, width: 612, height: 792, rotation: 0, contentStreamCount: 1, contentStreamBytes: 1, imageOperatorCount: 1, imageAreaRatio: 0.2, textItemCount: 4, vectorOperatorCount: 2 },
      { pageNumber: 2, width: 612, height: 792, rotation: 0, contentStreamCount: 1, contentStreamBytes: 1, imageOperatorCount: 1, imageAreaRatio: 0.4, textItemCount: 2, vectorOperatorCount: 1 },
      { pageNumber: 3, width: 612, height: 792, rotation: 0, contentStreamCount: 1, contentStreamBytes: 1, imageOperatorCount: 0, imageAreaRatio: 0, textItemCount: 8, vectorOperatorCount: 1 },
    ],
    metadata: { title: null, author: null, subject: null, creator: null, producer: null },
    partial: false,
  };
}

describe('PdfVisualFidelityService — V2.4', () => {
  it('rejects safely when browser rendering is unavailable', async () => {
    const loader = { load: vi.fn(async () => { throw new Error('browser unavailable'); }) } as unknown as PdfJsLoaderService;
    const service = new PdfVisualFidelityService(loader);
    const result = await service.validate(file(), file(), forensic(), 'recommended');
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('could not be completed');
  });

  it('skips when no forensic sample pages exist', async () => {
    const loader = { load: vi.fn() } as unknown as PdfJsLoaderService;
    const service = new PdfVisualFidelityService(loader);
    const result = await service.validate(file(), file(), { ...forensic(), sampledPages: [] }, 'recommended');
    expect(result.status).toBe('skipped');
    expect(loader.load).not.toHaveBeenCalled();
  });
});

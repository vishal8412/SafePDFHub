import { TestBed } from '@angular/core/testing';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { WordExportCheckService, matchesWordPaper } from './word-export-check.service';
import type { WordPreview } from './word-to-pdf.service';

describe('Saved Word PDF checks', () => {
  const source: WordPreview = { paperSizes: ['A4'], pageDimensions: [{ width: 595.5, height: 842 }], hasText: true, sections: 3, warnings: [], fonts: [], durationMs: 1, dispose() {} };
  const file = { name: 'saved.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(10) } as File;
  let service: WordExportCheckService;
  let loader: { load: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    loader = { load: vi.fn() };
    TestBed.configureTestingModule({ providers: [WordExportCheckService, { provide: PdfJsLoaderService, useValue: loader }] });
    service = TestBed.inject(WordExportCheckService);
  });
  it('accepts fractional printer rounding but rejects Letter and rotated A4', () => {
    expect(matchesWordPaper(595.92, 841.92, source.pageDimensions)).toBe(true);
    expect(matchesWordPaper(612, 792, source.pageDimensions)).toBe(false);
    expect(matchesWordPaper(842, 595.5, source.pageDimensions)).toBe(false);
  });
  it('accepts both source sizes in a mixed-orientation document', () => {
    expect(matchesWordPaper(842, 595.5, [...source.pageDimensions, { width: 842, height: 595.5 }])).toBe(true);
  });
  it('flags a raster Letter export and releases each page and worker', async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => {});
    loader.load.mockResolvedValue({ getDocument: () => ({ destroy, promise: Promise.resolve({ numPages: 4, getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }), getTextContent: async () => ({ items: [] }), cleanup }) }) }) });
    const progress = vi.fn();
    const result = await service.check(file, source, new AbortController().signal, progress);
    expect(result.wrongSizePages).toBe(4);
    expect(result.issues).toHaveLength(2);
    expect(result.hasSelectableText).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(4);
    expect(destroy).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });
  it('does not treat section count as the PDF page count', async () => {
    loader.load.mockResolvedValue({ getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 5, getPage: async () => ({ getViewport: () => ({ width: 595.92, height: 841.92 }), getTextContent: async () => ({ items: [{ str: 'Example document' }] }), cleanup() {} }) }) }) });
    const result = await service.check(file, source, new AbortController().signal, () => {});
    expect(result.pages).toBe(5);
    expect(result.issues).toEqual([]);
  });
  it('does not load a PDF after cancellation or for an empty file', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(service.check(file, source, abort.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
    await expect(service.check({ ...file, size: 0 } as File, source, new AbortController().signal, () => {})).rejects.toThrow('non-empty');
    expect(loader.load).not.toHaveBeenCalled();
  });
  it('releases the worker when parsing fails', async () => {
    const destroy = vi.fn(async () => {});
    loader.load.mockResolvedValue({ getDocument: () => ({ destroy, promise: Promise.reject(Error('Invalid PDF')) }) });
    await expect(service.check(file, source, new AbortController().signal, () => {})).rejects.toThrow('Invalid PDF');
    expect(destroy).toHaveBeenCalledOnce();
  });
});

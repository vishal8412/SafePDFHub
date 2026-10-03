import { describe, expect, it, vi } from 'vitest';
import { PdfSemanticIntegrityService } from './pdf-semantic-integrity.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalysis } from './pdf-forensic.models';

import { PDFDocument } from 'pdf-lib';

async function file(_size = 1000): Promise<File> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([612, 792]); pdf.addPage([612, 792]); pdf.setTitle('Test');
  pdf.setAuthor('Author'); pdf.setSubject('Subject'); pdf.setCreator('Creator');
  pdf.setProducer('Producer'); pdf.setKeywords(['pdf', 'test']);
  return new File([new Uint8Array(await pdf.save())], 'fixture.pdf', { type: 'application/pdf' });
}

function forensic(): PdfForensicAnalysis {
  return {
    version: 1,
    fileSize: 1000,
    pdfHeader: '%PDF-1.7',
    pageCount: 2,
    sampledPageCount: 2,
    objectCount: 2,
    streamObjectCount: 2,
    streamBytes: 100,
    uniqueStreamCount: 2,
    duplicateStreamGroupCount: 0,
    duplicateStreamBytes: 0,
    pageContentStreamCount: 2,
    pageContentStreamBytes: 100,
    uniquePageContentStreamCount: 2,
    duplicatePageContentStreamGroupCount: 0,
    duplicatePageContentBytes: 0,
    imageResourceCount: 0,
    uniqueImageResourceCount: 0,
    imageBytes: 0,
    imageReferenceCount: 0,
    imageOperatorCount: 0,
    imagePages: 0,
    sampledImageAreaRatio: 0,
    fontResourceCount: 1,
    formXObjectCount: 0,
    patternResourceCount: 0,
    shadingResourceCount: 0,
    duplicateStreams: [],
    duplicatePageContentStreams: [],
    imageResources: [],
    sampledPages: [
      { pageNumber: 1, width: 612, height: 792, rotation: 0, imageOperatorCount: 0, contentStreamCount: 1, contentStreamBytes: 100, imageAreaRatio: 0, textItemCount: 3, vectorOperatorCount: 0 },
      { pageNumber: 2, width: 612, height: 792, rotation: 0, imageOperatorCount: 0, contentStreamCount: 1, contentStreamBytes: 100, imageAreaRatio: 0, textItemCount: 3, vectorOperatorCount: 0 },
    ],
    metadata: { title: 'Test', author: 'Author', subject: 'Subject', creator: 'Creator', producer: 'Producer' },
    partial: false,
  };
}

function loader(text = 'Hello world') {
  const page = () => ({
    getTextContent: vi.fn(async () => ({ items: [{ str: text }] })),
    getAnnotations: vi.fn(async () => []),
    cleanup: vi.fn(),
  });
  return {
    load: vi.fn(async () => ({
      getDocument: vi.fn(({ data }: { data: Uint8Array }) => ({
        promise: Promise.resolve({
          getPage: vi.fn(async (_pageNumber: number) => page()),
          destroy: vi.fn(async () => undefined),
          numPages: 2,
        }),
      })),
    })),
  } as unknown as PdfJsLoaderService;
}

describe('PdfSemanticIntegrityService — V2.5', () => {
  it('passes when sampled text and annotations remain identical', async () => {
    const service = new PdfSemanticIntegrityService(loader());
    const result = await service.validate(await file(), await file(900), forensic());

    expect(result.status, result.reason ?? '').toBe('passed');
    expect(result.pageCountMatched).toBe(true);
    expect(result.pageGeometryMatched).toBe(true);
    expect(result.metadataMatched).toBe(true);
    expect(result.pages.every(page => page.passed)).toBe(true);
  });

  it('rejects when sampled text changes', async () => {
    let documentCalls = 0;
    const mismatchLoader = {
      load: vi.fn(async () => ({
        getDocument: vi.fn(() => {
          documentCalls += 1;
          const text = documentCalls === 1 ? 'Original text' : 'Changed text';
          const page = () => ({
            getTextContent: vi.fn(async () => ({ items: [{ str: text }] })),
            getAnnotations: vi.fn(async () => []),
            cleanup: vi.fn(),
          });
          return {
            promise: Promise.resolve({
              getPage: vi.fn(async () => page()),
              destroy: vi.fn(async () => undefined),
              numPages: 2,
            }),
          };
        }),
      })),
    } as unknown as PdfJsLoaderService;

    const service = new PdfSemanticIntegrityService(mismatchLoader);
    const result = await service.validate(await file(), await file(900), forensic());
    expect(result.status).toBe('rejected');
    expect(result.pages.some(page => !page.textMatched)).toBe(true);
  });

  it('falls back to the first page when forensic samples are unavailable', async () => {
    const service = new PdfSemanticIntegrityService(loader());
    const result = await service.validate(await file(), await file(900), undefined);

    expect(result.sampledPages).toEqual([1]);
    expect(result.status, result.reason ?? '').toBe('passed');
  });
});

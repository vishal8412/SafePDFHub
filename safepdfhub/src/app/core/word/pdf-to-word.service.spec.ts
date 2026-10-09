import { TestBed } from '@angular/core/testing';
import { PdfToWordService } from './pdf-to-word.service';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
describe('PDF to Word safety', () => {
  let capability: any, loader: { load: ReturnType<typeof vi.fn> }, service: PdfToWordService;
  beforeEach(() => {
    capability = {
      current: {
        formFactor: 'desktop',
        tier: 'high',
        memoryGiB: 8,
        budget: { maxFileBytes: 100_000_000 },
      },
    };
    loader = { load: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        PdfToWordService,
        { provide: PdfJsLoaderService, useValue: loader },
        { provide: LocalProcessingCapabilityService, useValue: capability },
      ],
    });
    service = TestBed.inject(PdfToWordService);
  });
  it('accepts 200 MB on desktop and phones while reducing render memory', () => {
    expect(service.limits.bytes).toBe(200_000_000);
    const desktopPixels = service.limits.ocrPixels;
    capability.current.formFactor = 'mobile';
    expect(service.limits.bytes).toBe(200_000_000);
    expect(service.limits.ocrPixels).toBeLessThan(desktopPixels);
    expect(service.limits).not.toHaveProperty('pages');
  });
  it('rejects empty and oversized files before parsing', async () => {
    for (const size of [0, 200_000_001])
      await expect(
        service.convert({ size } as File, 'editable', new AbortController().signal, () => {}),
      ).rejects.toThrow('non-empty PDF');
    expect(loader.load).not.toHaveBeenCalled();
  });
  it('rejects a renamed non-PDF before loading the engine', async () => {
    const file = {
      size: 4,
      slice: () => ({ arrayBuffer: async () => new TextEncoder().encode('text').buffer }),
    } as unknown as File;
    await expect(
      service.convert(file, 'editable', new AbortController().signal, () => {}),
    ).rejects.toThrow('valid PDF header');
    expect(loader.load).not.toHaveBeenCalled();
  });
  it('does not start a cancelled request', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.convert({ size: 10 } as File, 'editable', abort.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader.load).not.toHaveBeenCalled();
  });
  it('explains password protection and releases the PDF task', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const file = {
      size: bytes.length,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;
    const destroy = vi.fn(async () => {});
    loader.load.mockResolvedValue({
      PDFDataRangeTransport: class {
        abort() {}
      },
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('Password needed'), { name: 'PasswordException' }),
        ),
        destroy,
      }),
    });
    await expect(
      service.convert(file, 'editable', new AbortController().signal, () => {}),
    ).rejects.toThrow('Unlock');
    expect(destroy).toHaveBeenCalledOnce();
  });
});

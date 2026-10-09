import { pdfFileRange } from './pdf-file-range';
describe('PDF range input', () => {
  it('reads just the requested slice and ignores completions after abort', async () => {
    const sent = vi.fn(),
      fullRead = vi.fn(),
      slice = vi.fn(() => ({ arrayBuffer: async () => new Uint8Array([1, 2]).buffer }));
    const pdfjs = {
      PDFDataRangeTransport: class {
        onDataRange = sent;
      },
    } as any;
    const range = pdfFileRange(
      pdfjs,
      { size: 200_000_000, slice, arrayBuffer: fullRead } as any,
      vi.fn(),
    );
    range.requestDataRange(100, 102);
    await new Promise((r) => setTimeout(r, 0));
    expect(slice).toHaveBeenCalledWith(100, 102);
    expect(sent).toHaveBeenCalledWith(100, new Uint8Array([1, 2]));
    expect(fullRead).not.toHaveBeenCalled();
    range.requestDataRange(200, 202);
    range.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveBeenCalledOnce();
  });
  it('reports disk read failures instead of leaving PDF.js waiting forever', async () => {
    const failed = vi.fn();
    const error = new Error('Read failed');
    const range = pdfFileRange(
      { PDFDataRangeTransport: class {} } as any,
      { size: 200, slice: () => ({ arrayBuffer: () => Promise.reject(error) }) } as any,
      failed,
    );
    range.requestDataRange(0, 100);
    await new Promise((r) => setTimeout(r, 0));
    expect(failed).toHaveBeenCalledWith(error);
  });
});

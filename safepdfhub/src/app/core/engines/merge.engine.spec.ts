import { PDFDocument, StandardFonts } from 'pdf-lib';
import { MergeEngine } from './merge.engine';

describe('MergeEngine resource reuse', () => {
  it('copies each source document once so page batches cannot duplicate shared resources', async () => {
    const first = await PDFDocument.create();
    const font = await first.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < 30; index += 1) {
      const page = first.addPage([300 + index, 400]);
      page.drawText(`Page ${index + 1}`, { x: 20, y: 360, size: 12, font });
    }
    const second = await PDFDocument.create();
    second.addPage([612, 792]);
    second.addPage([420, 595]);

    const firstBytes = await first.save();
    const secondBytes = await second.save();
    const inputs = [
      new File([firstBytes.buffer as ArrayBuffer], 'first.pdf', { type: 'application/pdf' }),
      new File([secondBytes.buffer as ArrayBuffer], 'second.pdf', { type: 'application/pdf' }),
    ];
    const copyPages = vi.spyOn(PDFDocument.prototype, 'copyPages');
    const engine = new MergeEngine({
      budget: {
        maxFiles: 10,
        maxFileBytes: 20 * 1024 * 1024,
        maxTotalBytes: 40 * 1024 * 1024,
        maxPages: 100,
      },
    } as never);

    try {
      const merged = await engine.merge(inputs, undefined, [], { executionMode: 'main' });
      const reopened = await PDFDocument.load(await merged.arrayBuffer(), {
        updateMetadata: false,
      });

      expect(copyPages).toHaveBeenCalledTimes(2);
      expect(reopened.getPageCount()).toBe(32);
      expect(reopened.getPage(0).getWidth()).toBe(300);
      expect(reopened.getPage(29).getWidth()).toBe(329);
      expect(reopened.getPage(30).getWidth()).toBe(612);
      expect(reopened.getPage(31).getHeight()).toBe(595);
    } finally {
      copyPages.mockRestore();
    }
  });
});

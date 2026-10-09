import { WordArchive } from './word-archive';
import { documentXml, WordPage } from './word-document';
import JSZip from 'jszip';
const read = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = reject;
    r.readAsArrayBuffer(blob);
  });
describe('Streaming Word archive', () => {
  const page: WordPage = {
    width: 612,
    height: 792,
    visual: false,
    images: [],
    lines: [
      {
        x: 40,
        y: 60,
        width: 200,
        height: 12,
        runs: [{ text: 'Editable हिन्दी & English', font: 'Arial', size: 12 }],
      },
    ],
  };
  beforeAll(() => {
    if (!Blob.prototype.arrayBuffer)
      Blob.prototype.arrayBuffer = function () {
        return read(this);
      };
  });
  it('keeps page XML, Unicode and image relationships across incremental export', async () => {
    const archive = new WordArchive(new AbortController().signal);
    const second = {
      ...page,
      visual: true,
      lines: [],
      images: [
        { id: 1, bytes: new Uint8Array([255, 216, 255, 217]), x: 0, y: 0, width: 100, height: 100 },
      ],
    };
    await archive.addPage(page);
    await archive.addPage(second);
    const blob = await archive.finish(() => {});
    const zip = await JSZip.loadAsync(await read(blob));
    expect(await zip.file('word/document.xml')!.async('string')).toBe(documentXml([page, second]));
    expect(await zip.file('word/media/image1.jpg')!.async('uint8array')).toEqual(
      second.images[0].bytes,
    );
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('img1');
    archive.dispose();
  });
  it('rejects cancellation during final export', async () => {
    const signal = new AbortController();
    const archive = new WordArchive(signal.signal);
    await archive.addPage(page);
    signal.abort();
    await expect(archive.finish(() => {})).rejects.toMatchObject({ name: 'AbortError' });
  });
});

import { documentXml, packWord, WordPage, xml } from './word-document';
import { groupText, safeWordName } from './word-layout';
import JSZip from 'jszip';
describe('Word export', () => {
  const page: WordPage = {
    width: 612,
    height: 792,
    visual: false,
    images: [],
    lines: [
      {
        x: 36,
        y: 36,
        width: 120,
        height: 12,
        runs: [{ text: 'A & B <test> हिन्दी', font: 'Arial', size: 12 }],
      },
    ],
  };
  it('escapes XML and rejects control characters without losing Unicode', () => {
    const doc = new DOMParser().parseFromString(documentXml([page]), 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.getElementsByTagName('w:t')[0].textContent).toBe('A & B <test> हिन्दी');
    expect(xml('a\u0000b')).toBe('ab');
  });
  it('writes separate page sections and landscape geometry', () => {
    const doc = new DOMParser().parseFromString(
      documentXml([page, { ...page, width: 792, height: 612 }]),
      'application/xml',
    );
    expect(doc.getElementsByTagName('w:sectPr').length).toBe(2);
    expect(doc.getElementsByTagName('w:pgSz')[1].getAttribute('w:orient')).toBe('landscape');
  });
  it('packages real Word relationships and embedded images', async () => {
    const blob = await packWord([
      {
        ...page,
        images: [
          {
            id: 1,
            bytes: new Uint8Array([255, 216, 255, 217]),
            x: 0,
            y: 50,
            width: 100,
            height: 50,
          },
        ],
      },
    ]);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('r:embed="img1"');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain(
      'media/image1.jpg',
    );
    expect(zip.file('word/media/image1.jpg')).toBeTruthy();
    expect(Object.keys(zip.files).some((p) => p.includes('vba'))).toBe(false);
  });
  it('joins glyph fragments without joining distant columns', () => {
    const lines = groupText([
      { text: 'Hello', x: 40, y: 50, width: 25, size: 12 },
      { text: 'world', x: 69, y: 50, width: 30, size: 12 },
      { text: 'Column', x: 300, y: 50, width: 40, size: 12 },
    ]);
    expect(lines.length).toBe(2);
    expect(lines[0].runs.map((r) => r.text).join('')).toBe('Hello world');
  });
  it('uses a safe DOCX filename', () => {
    expect(safeWordName('report.PDF')).toBe('report.docx');
    expect(safeWordName('../bad:name.pdf')).toBe('.._bad_name.docx');
  });
});

import JSZip from 'jszip';
import { inspectArchive } from './docx-preflight';
async function fixture() {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<Types/>');
  z.file('word/document.xml', '<document/>');
  return z.generateAsync({ type: 'arraybuffer' });
}
describe('Browser DOCX archive preflight', () => {
  it('accepts a normal document archive', async () =>
    expect(
      (await inspectArchive(new Blob([await fixture()]))).some(
        (e) => e.name === 'word/document.xml',
      ),
    ).toBe(true));
  it('rejects damaged archives', async () =>
    await expect(inspectArchive(new Blob(['broken']))).rejects.toThrow('valid DOCX'));
  it('enforces expanded memory before inflation', async () =>
    await expect(inspectArchive(new Blob([await fixture()]), 1)).rejects.toThrow('memory budget'));
  it('rejects macros', async () => {
    const z = new JSZip();
    z.file('[Content_Types].xml', 'x');
    z.file('word/document.xml', 'x');
    z.file('word/vbaProject.bin', 'x');
    await expect(
      inspectArchive(new Blob([await z.generateAsync({ type: 'arraybuffer' })])),
    ).rejects.toThrow('Macros');
  });
});

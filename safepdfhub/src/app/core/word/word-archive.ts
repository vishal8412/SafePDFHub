import { Zip, ZipPassThrough, ZipDeflate, strToU8 } from 'fflate';
import { documentXml, DOCX_MIME, WordPage } from './word-document';
import { cancelled } from './word-ocr';

/** Encode one page at a time. Finished media and ZIP chunks are held as browser Blobs,
 * not a second document-sized array of decoded pixels/Uint8Arrays. */
export class WordArchive {
  private chunks: Blob[] = [];
  private xmlParts: Blob[] = [];
  private relationships: string[] = [];
  private lastSection = '';
  private failure: Error | null = null;
  private ended = false;
  private outputBytes = 0;
  private entries = 0;
  private zip: Zip;
  private readonly abort = () => this.dispose();
  constructor(private signal: AbortSignal) {
    this.zip = new Zip((error, data, final) => {
      if (error) {
        this.failure = error;
        return;
      }
      this.outputBytes += data.byteLength;
      if (this.outputBytes >= 0xffffffff) {
        this.failure = new Error(
          'The Word output exceeds the ZIP format size supported by this browser exporter. Convert smaller parts.',
        );
        return;
      }
      if (data.length) this.chunks.push(new Blob([data as Uint8Array<ArrayBuffer>]));
      this.ended = final;
    });
    signal.addEventListener('abort', this.abort, { once: true });
  }
  private check() {
    if (this.signal.aborted) throw cancelled();
    if (this.failure) throw this.failure;
  }
  private entry(name: string, bytes: Uint8Array, compress = false) {
    this.check();
    const item = compress ? new ZipDeflate(name, { level: 1 }) : new ZipPassThrough(name);
    this.checkEntryCount();
    this.zip.add(item);
    item.push(bytes, true);
    this.check();
  }
  async addPage(page: WordPage) {
    this.check();
    const xml = documentXml([page]);
    const start = xml.indexOf('<w:body>') + '<w:body>'.length;
    const section = xml.lastIndexOf('<w:sectPr>');
    if (!this.xmlParts.length) this.xmlParts.push(new Blob([xml.slice(0, start)]));
    if (this.lastSection)
      this.xmlParts.push(
        new Blob([
          `<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/>${this.lastSection}</w:pPr></w:p>`,
        ]),
      );
    this.xmlParts.push(new Blob([xml.slice(start, section)]));
    this.lastSection = xml.slice(section, xml.indexOf('</w:body>'));
    for (const image of page.images) {
      this.entry(`word/media/image${image.id}.${image.format ?? 'jpg'}`, image.bytes);
      this.relationships.push(
        `<Relationship Id="img${image.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${image.id}.${image.format ?? 'jpg'}"/>`,
      );
    }
  }
  async finish(progress: (percent: number) => void): Promise<Blob> {
    this.check();
    this.entry(
      '[Content_Types].xml',
      strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      true,
    );
    this.entry(
      '_rels/.rels',
      strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      true,
    );
    const rels = new Blob([
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...this.relationships,
      '</Relationships>',
    ]);
    this.relationships = [];
    await this.blobEntry('word/_rels/document.xml.rels', rels, () => {});
    const document = new Blob([...this.xmlParts, this.lastSection, '</w:body></w:document>']);
    this.xmlParts = [];
    this.lastSection = '';
    await this.blobEntry('word/document.xml', document, progress);
    this.zip.end();
    this.check();
    if (!this.ended) throw new Error('The Word document could not be finalized.');
    const result = new Blob(this.chunks, { type: DOCX_MIME });
    this.chunks = [];
    this.signal.removeEventListener('abort', this.abort);
    return result;
  }
  private async blobEntry(name: string, blob: Blob, progress: (percent: number) => void) {
    const entry = new ZipDeflate(name, { level: 1 });
    this.checkEntryCount();
    this.zip.add(entry);
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      this.check();
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      this.check();
      entry.push(bytes, offset + chunkSize >= blob.size);
      progress(Math.min(100, (100 * (offset + bytes.length)) / blob.size));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!blob.size) entry.push(new Uint8Array(), true);
  }
  private checkEntryCount() {
    if (++this.entries >= 65535)
      throw new Error(
        'The Word output has too many embedded files for ZIP32. Convert smaller parts.',
      );
  }
  dispose() {
    this.signal.removeEventListener('abort', this.abort);
    this.zip.terminate();
    this.chunks = [];
    this.xmlParts = [];
    this.relationships = [];
  }
}

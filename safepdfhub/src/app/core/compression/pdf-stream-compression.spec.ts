import { describe, it, expect, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { zlibSync, unzlibSync } from 'fflate';
import { recompressFlateStreams, inflateBounded } from './pdf-stream-compression';

describe('Lossless stream recompression', () => {
  it('preserves decoded font, image predictor, page and attachment bytes and dictionaries', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const pdf = await PDFDocument.create();
      const raw = new TextEncoder().encode('Exact content, font program, palette or attachment bytes\n'.repeat(1000));
      const fixtures = [
        {}, { Length1: raw.length }, { Type: 'EmbeddedFile' },
        { Subtype: 'Image', DecodeParms: { Predictor: 12, Columns: 3 }, ColorSpace: 'DeviceGray' },
      ].map(extra => {
        const original = PDFRawStream.of(pdf.context.obj({ ...extra, Filter: ['FlateDecode'] }), zlibSync(raw, { level: 0 }));
        return { ref: pdf.context.register(original), original };
      });
      expect(await recompressFlateStreams(pdf)).toBe(4);
      for (const { ref, original } of fixtures) {
        const result = pdf.context.lookup(ref) as PDFRawStream;
        expect(Array.from(unzlibSync(result.getContents()))).toEqual(Array.from(raw));
        expect(result.getContents().length).toBeLessThan(original.getContents().length);
        for (const [key, value] of original.dict.entries()) if (key !== PDFName.of('Length')) expect(result.dict.get(key)).toBe(value);
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('caps expansion and leaves over-budget streams unchanged', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const raw = new Uint8Array(10000).fill(65);
      expect(await inflateBounded(zlibSync(raw), 100)).toBeNull();
      const pdf = await PDFDocument.create();
      const stream = PDFRawStream.of(pdf.context.obj({ Filter: 'FlateDecode' }), zlibSync(raw, { level: 0 }));
      const ref = pdf.context.register(stream);
      expect(await recompressFlateStreams(pdf, 100)).toBe(0);
      expect(pdf.context.lookup(ref)).toBe(stream);
    } finally { vi.unstubAllGlobals(); }
  });
});

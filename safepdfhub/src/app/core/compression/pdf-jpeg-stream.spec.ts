import { describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { extractJpegBytes } from './pdf-jpeg-stream';

const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 255, 217]);
async function fixture(filter: any, params: any, wrapped = false) {
  const pdf = await PDFDocument.create();
  const bytes = wrapped ? pdf.context.flateStream(jpeg).getContents() : jpeg;
  const dict = pdf.context.obj({ Filter: filter, ...(params === undefined ? {} : { DecodeParms: params }) });
  return { pdf, stream: PDFRawStream.of(dict, bytes) };
}
describe('JPEG filter chains', () => {
  it('reads scalar and single-element JPEG filters', async () => {
    for (const filter of ['DCTDecode', ['DCTDecode']]) {
      const f = await fixture(filter, undefined);
      expect(await extractJpegBytes(f.pdf, f.stream)).toEqual(jpeg);
    }
  });
  it('unwraps the scanner Flate/JPEG chain with null and Quality parameters', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const f = await fixture(['FlateDecode', 'DCTDecode'], [null, { Quality: 65 }], true);
      expect(await extractJpegBytes(f.pdf, f.stream)).toEqual(jpeg);
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects unsupported predictors, color transforms and filter orders', async () => {
    for (const [filter, params] of [
      [['FlateDecode', 'DCTDecode'], [{ Predictor: 12 }, null]],
      ['DCTDecode', { ColorTransform: 0 }],
      [['DCTDecode', 'FlateDecode'], undefined],
      [['FlateDecode', 'DCTDecode'], [null]],
    ]) {
      const f = await fixture(filter, params);
      expect(await extractJpegBytes(f.pdf, f.stream)).toBeNull();
    }
  });
  it('bounds expansion before handing image bytes to the browser decoder', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const pdf = await PDFDocument.create();
      const bytes = pdf.context.flateStream(new Uint8Array(10000).fill(65)).getContents();
      const stream = PDFRawStream.of(pdf.context.obj({ Filter: ['FlateDecode', 'DCTDecode'] }), bytes);
      expect(await extractJpegBytes(pdf, stream, 100)).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});

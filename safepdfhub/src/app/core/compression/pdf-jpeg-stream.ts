import { PDFArray, PDFDocument, PDFDict, PDFName, PDFNull, PDFRawStream } from 'pdf-lib';

/** The budget planner and decoder must accept exactly the same JPEG chains. */
export function supportedJpegFilterCount(pdf: PDFDocument, stream: PDFRawStream): number {
  const lookup = (value: any) => pdf.context.lookup(value);
  const filter = lookup(stream.dict.get(PDFName.of('Filter')));
  const filters = filter instanceof PDFArray ? filter.asArray().map(lookup) : [filter];
  if (filters.at(-1) !== PDFName.of('DCTDecode') || filters.length > 2 ||
      (filters.length === 2 && filters[0] !== PDFName.of('FlateDecode'))) return 0;
  const params = lookup(stream.dict.get(PDFName.of('DecodeParms')));
  const entries = params instanceof PDFArray ? params.asArray().map(lookup) : filters.map((_, i) => i === 0 ? params : undefined);
  if (params instanceof PDFArray && entries.length !== filters.length) return 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry === PDFNull) continue;
    // Quality is an encoder hint. ColorTransform and Flate predictors affect
    // decoding, so leave those images untouched rather than guess their colors.
    if (!(entry instanceof PDFDict) || entry.keys().some(key =>
      filters[i] !== PDFName.of('DCTDecode') || key !== PDFName.of('Quality'))) return 0;
  }
  return filters.length;
}

/** Extract supported JPEG filter chains without interpreting image pixels. */
export async function extractJpegBytes(pdf: PDFDocument, stream: PDFRawStream, limit = 32_000_000): Promise<Uint8Array | null> {
  const filterCount = supportedJpegFilterCount(pdf, stream);
  if (!filterCount) return null;
  let bytes = stream.getContents();
  if (bytes.length > limit) return null;
  if (filterCount === 2) {
    const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  }
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

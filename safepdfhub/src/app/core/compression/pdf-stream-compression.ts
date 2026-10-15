import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { zlibSync } from 'fflate';

/** Re-encode compressed bytes only; never interpret fonts, predictors or pixels. */
export async function recompressFlateStreams(pdf: PDFDocument, totalLimit = 128_000_000): Promise<number> {
  let remaining = totalLimit, changed = 0;
  for (const [ref, stream] of pdf.context.enumerateIndirectObjects()) {
    if (!(stream instanceof PDFRawStream) || stream.dict.has(PDFName.of('F')) || remaining <= 0) continue;
    let filter = pdf.context.lookup(stream.dict.get(PDFName.of('Filter')));
    if (filter instanceof PDFArray && filter.size() === 1) filter = pdf.context.lookup(filter.get(0));
    if (filter !== PDFName.of('FlateDecode')) continue;
    const original = stream.getContents();
    if (original.length < 128 || original.length > 8_000_000) continue;
    const cap = Math.min(8_000_000, remaining);
    try {
      const decoded = await inflateBounded(original, cap);
      // A capped stream has consumed its allowed work even when rejected.
      remaining -= decoded?.length ?? cap;
      if (!decoded) continue;
      const compressed = zlibSync(decoded, { level: 9 });
      if (compressed.length + 32 >= original.length) continue;
      const dict = stream.dict.clone(pdf.context);
      dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
      pdf.context.assign(ref, PDFRawStream.of(dict, compressed));
      changed++;
    } catch { remaining -= cap; /* Preserve malformed/unsupported streams verbatim. */ }
  }
  return changed;
}

export async function inflateBounded(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
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
  const output = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

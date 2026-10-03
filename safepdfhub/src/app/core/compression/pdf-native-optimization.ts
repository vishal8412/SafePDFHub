import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStreamWriter, decodePDFRawStream } from 'pdf-lib';
import { captureDocumentFacts, PdfDocumentFacts } from './pdf-document-facts';
import { CompressionLevel } from './compression.types';

export interface NativeOptimizationOptions { level?: CompressionLevel; targetBytes?: number; retainOnlyBest?: boolean; }

/** Each candidate still requires final semantic and visual certification. */
export async function optimizeNativeCandidates(bytes: Uint8Array, options: NativeOptimizationOptions = {}, onSourceFacts?: (facts: PdfDocumentFacts) => void): Promise<Uint8Array[]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: Infinity });
  if (pdf.isEncrypted) return [];
  onSourceFacts?.(captureDocumentFacts(pdf));
  const entries = pdf.context.enumerateIndirectObjects();
  if (entries.some(([, object]) => object instanceof PDFDict && (
    object.get(PDFName.of('Type')) === PDFName.of('Sig') ||
    object.get(PDFName.of('FT')) === PDFName.of('Sig') || object.has(PDFName.of('ByteRange'))
  ))) return [];

  // The parser retains obsolete incremental-update objects. Keep everything
  // reachable from all trailer roots, including forms, attachments and metadata.
  const reachable = new Set<PDFRef>();
  const visited = new Set<PDFObject>();
  const pending: PDFObject[] = Object.values(pdf.context.trailerInfo).filter((v): v is PDFObject => !!v);
  while (pending.length) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFRef) {
      reachable.add(object);
      const resolved = pdf.context.lookup(object);
      if (resolved) pending.push(resolved);
    } else if (object instanceof PDFRawStream) pending.push(object.dict);
    else if (object instanceof PDFDict) pending.push(...object.values());
    else if (object instanceof PDFArray) pending.push(...object.asArray());
  }
  for (const [ref] of entries) if (!reachable.has(ref)) pdf.context.delete(ref);

  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(PDFName.of('Filter')) ||
        object.dict.has(PDFName.of('DecodeParms')) || object.dict.has(PDFName.of('F'))) continue;
    const raw = object.getContents();
    if (raw.length < 256 || raw.length > 8 * 1024 * 1024) continue;
    const dictionary: Record<string, any> = {};
    for (const [key, value] of object.dict.entries()) if (key !== PDFName.of('Length')) dictionary[key.decodeText()] = value;
    const compressed = pdf.context.flateStream(raw, dictionary);
    if (compressed.getContents().length + 32 < raw.length) pdf.context.assign(ref, compressed);
  }
  // Share only byte-identical streams with identical dictionaries. Resolve
  // every reference to the canonical stream before deleting its duplicate.
  const canonical = new Map<string, PDFRef>();
  const aliases = new Map<PDFRef, PDFRef>();
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.getContents().length > 16_000_000) continue;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(object.getContents())));
    const key = object.dict.toString() + ':' + Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
    const prior = canonical.get(key);
    if (prior) aliases.set(ref, prior); else canonical.set(key, ref);
  }
  if (aliases.size) {
    const seen = new Set<PDFObject>();
    const queue = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
    while (queue.length) {
      const object = queue.pop()!;
      if (seen.has(object)) continue;
      seen.add(object);
      if (object instanceof PDFRawStream) queue.push(object.dict);
      else if (object instanceof PDFDict) {
        for (const [key, value] of object.entries()) {
          if (value instanceof PDFRef && aliases.has(value)) object.set(key, aliases.get(value)!);
          else if (!(value instanceof PDFRef)) queue.push(value);
        }
      } else if (object instanceof PDFArray) {
        object.asArray().forEach((value, index) => {
          if (value instanceof PDFRef && aliases.has(value)) object.set(index, aliases.get(value)!);
          else if (!(value instanceof PDFRef)) queue.push(value);
        });
      }
    }
    for (const [ref] of aliases) pdf.context.delete(ref);
  }
  // This function runs in a terminable worker. Avoid thousands of timer yields
  // and tiny object streams; retain every object, including accessibility tags.
  const save = async () => {
    await pdf.flush();
    return PDFStreamWriter.forContext(pdf.context, Infinity, true, 1500).serializeToBuffer();
  };
  const lossless = await save();
  const candidates = lossless.length < bytes.length ? [lossless] : [];
  const target = options.targetBytes;
  const level = options.level ?? 'light';
  if (level === 'light' || (target && lossless.length <= target) || typeof OffscreenCanvas === 'undefined') return candidates;

  // Decode one supported image at a time, never rasterize pages or their text.
  const images = pdf.context.enumerateIndirectObjects().filter((entry): entry is [PDFRef, PDFRawStream] =>
    entry[1] instanceof PDFRawStream && entry[1].dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  const imageBytes = images.reduce((sum, [, image]) => sum + image.getContents().length, 0);
  const qualities = target ? targetQualityLadder(lossless.length, imageBytes, target)
    : [level === 'recommended' ? 0.82 : 0.55];
  let best = lossless;
  for (const quality of qualities) {
    for (const [ref, original] of images) {
      try {
        const replacement = await recompressImage(pdf, original, quality);
        // Every pass starts from the original image, avoiding generational loss.
        pdf.context.assign(ref, replacement ?? original);
      } catch { pdf.context.assign(ref, original); }
    }
    const candidate = await save();
    if (candidate.length < best.length) {
      best = candidate;
      if (best.length < bytes.length) {
        if (options.retainOnlyBest) candidates.length = 0;
        candidates.unshift(best);
      }
    }
    if (target && best.length <= target) break;
  }
  return candidates;
}

export async function optimizeNativePdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  return (await optimizeNativeCandidates(bytes))[0] ?? null;
}

async function recompressImage(pdf: PDFDocument, stream: PDFRawStream, quality: number): Promise<PDFRawStream | null> {
  const dict = stream.dict;
  const get = (key: string) => pdf.context.lookup(dict.get(PDFName.of(key)));
  // Preserve masks, color conversion, unusual codecs and tiny line-art exactly.
  if (['Decode', 'DecodeParms', 'ImageMask', 'Mask', 'F', 'SMaskInData'].some(key => dict.has(PDFName.of(key)))) return null;
  if (get('ColorSpace') !== PDFName.of('DeviceRGB') || (get('BitsPerComponent') as PDFNumber)?.asNumber?.() !== 8) return null;
  const width = (get('Width') as PDFNumber)?.asNumber?.() ?? 0;
  const height = (get('Height') as PDFNumber)?.asNumber?.() ?? 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 8_000_000 || width * height < 65_536) return null;
  const filter = get('Filter');
  if (filter && filter !== PDFName.of('DCTDecode') && filter !== PDFName.of('FlateDecode')) return null;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    if (filter === PDFName.of('DCTDecode')) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(stream.getContents())], { type: 'image/jpeg' }));
      try {
        if (bitmap.width !== width || bitmap.height !== height) return null;
        context.drawImage(bitmap, 0, 0);
      } finally { bitmap.close(); }
    } else {
      const rgb = decodePDFRawStream(stream).getBytes(width * height * 3 + 1);
      if (rgb.length !== width * height * 3) return null;
      const pixels = context.createImageData(width, height);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        pixels.data[j] = rgb[i]; pixels.data[j + 1] = rgb[i + 1]; pixels.data[j + 2] = rgb[i + 2]; pixels.data[j + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
    }
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (jpeg.type !== 'image/jpeg' || jpeg.size + 32 >= stream.getContents().length) return null;
    const dictionary = dict.clone(pdf.context);
    dictionary.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    dictionary.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
    return PDFRawStream.of(dictionary, bytes);
  } finally { canvas.width = canvas.height = 1; }
}

/** A starting-point heuristic only. Actual serialized bytes and certification decide success. */
export function targetQualityLadder(losslessBytes: number, imageBytes: number, targetBytes: number): number[] {
  if (targetBytes >= losslessBytes || imageBytes <= 0) return [];
  const requiredImageReduction = (losslessBytes - targetBytes) / imageBytes;
  // Avoid serializing the full document at settings unlikely to close a large
  // gap. Every image is still encoded from its original bytes and validated.
  if (requiredImageReduction >= 0.40) return [0.45];
  if (requiredImageReduction >= 0.20) return [0.65, 0.45];
  return [0.82, 0.65, 0.45];
}

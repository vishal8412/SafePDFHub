import { CompressionActivity, CompressionActivityObserver } from './compression-activity';
import { recompressFlateStreams } from './pdf-stream-compression';
import { extractJpegBytes, supportedJpegFilterCount } from './pdf-jpeg-stream';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStreamWriter, decodePDFRawStream } from 'pdf-lib';
import { captureDocumentFacts, PdfDocumentFacts } from './pdf-document-facts';
import { allocateImageBudgets, encodeJpegWithinBudget } from './target-image-budget';
import { CompressionLevel } from './compression.types';

export interface NativeOptimizationOptions { level?: CompressionLevel; targetBytes?: number; retainOnlyBest?: boolean; maxImagePixels?: number; allowGrayscale?: boolean; sizePriority?: boolean; }

/** Each candidate still requires final semantic and visual certification. */
export async function optimizeNativeCandidates(bytes: Uint8Array, options: NativeOptimizationOptions = {}, onSourceFacts?: (facts: PdfDocumentFacts) => void, onActivity?: CompressionActivityObserver): Promise<Uint8Array[]> {
  let lastActivityAt = -Infinity;
  const report = (activity: CompressionActivity) => {
    if (!onActivity) return;
    const now = performance.now();
    // Keep tiny/unsupported image inventories from flooding the UI thread.
    if (activity.current === undefined || activity.current === 0 || activity.current === activity.total || now - lastActivityAt >= 80) {
      lastActivityAt = now;
      onActivity(activity);
    }
  };
  report({ stage: 'reading' });
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: Infinity });
  if (pdf.isEncrypted) return [];
  onSourceFacts?.(captureDocumentFacts(pdf));
  const entries = pdf.context.enumerateIndirectObjects();
  if (entries.some(([, object]) => object instanceof PDFDict && (
    object.get(PDFName.of('Type')) === PDFName.of('Sig') ||
    object.get(PDFName.of('FT')) === PDFName.of('Sig') || object.has(PDFName.of('ByteRange'))
  ))) return [];

  report({ stage: 'optimizing' });
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
      // Reserve unresolved references too: serialization must not reuse their
      // numbers for new object streams and accidentally make them point there.
      pdf.context.largestObjectNumber = Math.max(pdf.context.largestObjectNumber, object.objectNumber);
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
  await recompressFlateStreams(pdf);
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
  report({ stage: 'writing' });
  const lossless = await save();
  const candidates = lossless.length < bytes.length ? [lossless] : [];
  let target = options.targetBytes;
  const level = options.level ?? 'light';
  if ((level === 'light' && !target) || (target && lossless.length <= target) || typeof OffscreenCanvas === 'undefined') return candidates;

  // Decode one supported image at a time, never rasterize pages or their text.
  const images = pdf.context.enumerateIndirectObjects().filter((entry): entry is [PDFRef, PDFRawStream] =>
    entry[1] instanceof PDFRawStream && entry[1].dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  const imageBytes = images.reduce((sum, [, image]) => sum + image.getContents().length, 0);
  // Large scan-heavy PDFs need a byte-budget search even when the user has
  // not enabled a custom target. A fixed JPEG quality alone can leave tens of
  // megabytes of photographic paper texture. Never apply this to High Quality.
  const largeImages = images.filter(([, image]) => {
    const width = pdf.context.lookup(image.dict.get(PDFName.of('Width')));
    const height = pdf.context.lookup(image.dict.get(PDFName.of('Height')));
    return width instanceof PDFNumber && height instanceof PDFNumber && width.asNumber() * height.asNumber() >= 1_000_000;
  }).length;
  target ??= automaticScanTarget(level, lossless.length, imageBytes, largeImages, pdf.getPageCount());
  const qualities = target ? (options.targetBytes === undefined && level === 'strong' ? [0.55, 0.40] : [0.65, 0.48])
    : [level === 'recommended' ? 0.82 : 0.55];
  const maxPixels = Math.min(32_000_000, options.maxImagePixels ?? 8_000_000);
  const sizePriority = options.targetBytes !== undefined && options.sizePriority === true;
  const minimumEdge = sizePriority ? 320 : 1000;
  let maxEdge = target ? Math.max(minimumEdge, Math.min(2400, Math.round(3200 * Math.cbrt(target / Math.max(lossless.length, 1)))))
    : level === 'recommended' ? 2400 : 1600;
  if (target) {
    const edges = images.map(([, image]) => {
      const width = pdf.context.lookup(image.dict.get(PDFName.of('Width')));
      const height = pdf.context.lookup(image.dict.get(PDFName.of('Height')));
      return width instanceof PDFNumber && height instanceof PDFNumber && width.asNumber() * height.asNumber() >= 1_000_000
        ? Math.max(width.asNumber(), height.asNumber()) : 0;
    }).filter(edge => edge > 0);
    maxEdge = capTargetEdge(maxEdge, edges);
  }
  const budgetable = images.filter(([, image]) => {
    const get = (key: string) => pdf.context.lookup(image.dict.get(PDFName.of(key)));
    const width = (get('Width') as PDFNumber)?.asNumber?.() ?? 0;
    const height = (get('Height') as PDFNumber)?.asNumber?.() ?? 0;
    let filter = get('Filter');
    if (filter instanceof PDFArray && filter.size() === 1) filter = pdf.context.lookup(filter.get(0));
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
      width * height >= 65_536 && width * height <= maxPixels &&
      [PDFName.of('DeviceRGB'), PDFName.of('DeviceGray')].includes(get('ColorSpace') as PDFName) &&
      (get('BitsPerComponent') as PDFNumber)?.asNumber?.() === 8 &&
      !['Decode', 'ImageMask', 'Mask', 'SMask', 'F', 'SMaskInData'].some(key => image.dict.has(PDFName.of(key))) &&
      (supportedJpegFilterCount(pdf, image) > 0 || ((!filter || filter === PDFName.of('FlateDecode')) && !image.dict.has(PDFName.of('DecodeParms'))));
  });
  const budgets = target ? allocateImageBudgets(target, lossless.length, budgetable.map(([, image]) => image.getContents().length)) : null;
  const imageBudgets = new Map(budgetable.map(([ref], i) => [ref, budgets?.[i]]));
  const budgetableRefs = new Set(budgetable.map(([ref]) => ref));
  let best = lossless;
  for (const [passIndex, quality] of qualities.entries()) {
    let checked = 0;
    report({ stage: 'optimizing', current: 0, total: images.length, pass: passIndex + 1, passes: qualities.length });
    for (const [ref, original] of images) {
      try {
        const replacement = await recompressImage(pdf, original, quality, maxEdge, maxPixels, imageBudgets.get(ref) ?? (sizePriority && budgetableRefs.has(ref) ? 512 : undefined), !!options.allowGrayscale && options.targetBytes !== undefined, minimumEdge, sizePriority ? 0.05 : 0.10);
        // Every pass starts from the original image, avoiding generational loss.
        pdf.context.assign(ref, replacement ?? original);
      } catch { pdf.context.assign(ref, original); }
      checked++;
      report({ stage: 'optimizing', current: checked, total: images.length, pass: passIndex + 1, passes: qualities.length });
    }
    report({ stage: 'writing' });
    const candidate = await save();
    if (candidate.length < best.length) {
      best = candidate;
      if (best.length < bytes.length) {
        if (options.retainOnlyBest) candidates.length = 0;
        candidates.unshift(best);
      }
    }
    if (target && best.length <= target) break;
    // Retained PDF content already exhausts the budget; the minimum image
    // settings have been tried, so repeating the same pass cannot help.
    if (sizePriority && !budgets) break;
    if (target) maxEdge = Math.max(minimumEdge, Math.floor(maxEdge * Math.min(0.95, Math.sqrt(target / best.length * 0.95))));
  }
  return candidates;
}

export async function optimizeNativePdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  return (await optimizeNativeCandidates(bytes))[0] ?? null;
}

async function recompressImage(pdf: PDFDocument, stream: PDFRawStream, quality: number, maxEdge: number, maxPixels: number, byteBudget?: number, grayscale = false, minimumEdge = 1000, minimumQuality = 0.10): Promise<PDFRawStream | null> {
  const dict = stream.dict;
  const get = (key: string) => pdf.context.lookup(dict.get(PDFName.of(key)));
  // Preserve masks, color conversion, unusual codecs and tiny line-art exactly.
  if (['Decode', 'ImageMask', 'Mask', 'SMask', 'F', 'SMaskInData'].some(key => dict.has(PDFName.of(key)))) return null;
  if (![PDFName.of('DeviceRGB'), PDFName.of('DeviceGray')].includes(get('ColorSpace') as PDFName) || (get('BitsPerComponent') as PDFNumber)?.asNumber?.() !== 8) return null;
  const width = (get('Width') as PDFNumber)?.asNumber?.() ?? 0;
  const height = (get('Height') as PDFNumber)?.asNumber?.() ?? 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > maxPixels || width * height < 65_536) return null;
  let filter = get('Filter');
  // A one-element Filter array is semantically identical to a single name.
  if (filter instanceof PDFArray && filter.size() === 1) filter = pdf.context.lookup(filter.get(0));
  const jpegBytes = await extractJpegBytes(pdf, stream);
  if (!jpegBytes && (dict.has(PDFName.of('DecodeParms')) || (filter && filter !== PDFName.of('FlateDecode')))) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    if (jpegBytes) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(jpegBytes)], { type: 'image/jpeg' }));
      try {
        if (bitmap.width !== width || bitmap.height !== height) return null;
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
      } finally { bitmap.close(); }
    } else {
      const channels = get('ColorSpace') === PDFName.of('DeviceGray') ? 1 : 3;
      const rgb = decodePDFRawStream(stream).getBytes(width * height * channels + 1);
      if (rgb.length !== width * height * channels) return null;
      const pixels = context.createImageData(width, height);
      for (let i = 0, j = 0; i < rgb.length; i += channels, j += 4) {
        pixels.data[j] = rgb[i]; pixels.data[j + 1] = rgb[i + (channels === 1 ? 0 : 1)]; pixels.data[j + 2] = rgb[i + (channels === 1 ? 0 : 2)]; pixels.data[j + 3] = 255;
      }
      if (scale === 1) context.putImageData(pixels, 0, 0);
      else {
        const staging = new OffscreenCanvas(width, height);
        try {
          const stagingContext = staging.getContext('2d');
          if (!stagingContext) return null;
          stagingContext.putImageData(pixels, 0, 0);
          context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
          context.drawImage(staging, 0, 0, outputWidth, outputHeight);
        } finally { staging.width = staging.height = 1; }
      }
    }
    if (grayscale) {
      const pixels = context.getImageData(0, 0, outputWidth, outputHeight);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = Math.round(0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = luminance;
      }
      context.putImageData(pixels, 0, 0);
    }
    const encode = (q: number) => canvas.convertToBlob({ type: 'image/jpeg', quality: q });
    let jpeg = byteBudget === undefined ? await encode(quality) : await encodeJpegWithinBudget(encode, byteBudget, 0.85, minimumQuality);
    if (byteBudget !== undefined && jpeg.size > byteBudget && Math.max(canvas.width, canvas.height) > minimumEdge) {
      // Keep a bounded snapshot of the decoded pixels, not an encoded JPEG.
      // Resize only images that cannot fit at the quality floor, instead of
      // decoding and serializing the entire PDF at several fixed settings.
      const pixels = await createImageBitmap(canvas);
      try {
        for (let attempt = 0; attempt < 4 && jpeg.size > byteBudget; attempt++) {
          const edge = Math.max(minimumEdge, Math.floor(Math.max(canvas.width, canvas.height) *
            Math.min(0.9, Math.sqrt(byteBudget / jpeg.size) * 0.96)));
          const scale = Math.min(1, edge / Math.max(pixels.width, pixels.height));
          canvas.width = Math.max(1, Math.round(pixels.width * scale));
          canvas.height = Math.max(1, Math.round(pixels.height * scale));
          context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
          context.drawImage(pixels, 0, 0, canvas.width, canvas.height);
          jpeg = await encodeJpegWithinBudget(encode, byteBudget, 0.85, minimumQuality);
          if (edge <= minimumEdge) break;
        }
      } finally { pixels.close(); }
    }
    if (jpeg.type !== 'image/jpeg' || jpeg.size + 32 >= stream.getContents().length) return null;
    const dictionary = dict.clone(pdf.context);
    dictionary.set(PDFName.of('Width'), PDFNumber.of(canvas.width));
    dictionary.set(PDFName.of('Height'), PDFNumber.of(canvas.height));
    dictionary.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    dictionary.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    dictionary.delete(PDFName.of('DecodeParms'));
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

/** Best-effort scan budgets; custom limits always take precedence at the caller. */
export function automaticScanTarget(level: CompressionLevel, bytes: number, imageBytes: number, largeImages: number, pages: number): number | undefined {
  if (level === 'light' || bytes <= 20_000_000 || pages <= 0 || imageBytes < bytes * 0.9 || largeImages < pages * 0.8) return undefined;
  return level === 'strong' ? 10_000_000 : 20_000_000;
}

/** Adapt from actual source resolution, not a larger theoretical canvas. */
export function capTargetEdge(proposed: number, sourceEdges: number[]): number {
  if (!sourceEdges.length) return proposed;
  const sorted = [...sourceEdges].sort((a, b) => a - b);
  return Math.min(proposed, Math.max(1000, sorted[Math.floor(sorted.length / 2)]));
}

import { PDFDocument, PDFName } from 'pdf-lib';
import { throwIfCompressionCancelled } from './compression-cancellation';
import {
  PdfForensicAnalysis,
  PdfForensicDuplicateGroup,
  PdfForensicImageResource,
  PdfForensicPageObservation,
  PdfForensicPageSummary,
} from './pdf-forensic.models';

interface RawObjectRecord {
  key: string;
  object: any;
  streamBytes: number;
}

export class PdfForensicAnalyzerCore {
  private readonly maxSamplePages = 8;

  async analyzeDirect(
    file: File,
    pdfJsDocument: any,
    sourceBytes?: Uint8Array,
    sampledPageObservations: PdfForensicPageObservation[] = [],
    signal?: AbortSignal,
  ): Promise<PdfForensicAnalysis> {
    throwIfCompressionCancelled(signal);
    const bytes = sourceBytes ?? new Uint8Array(await file.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: typeof document === 'undefined' ? Infinity : 1500,
    });

    try {
      return await this.analyzeDocument(file.size, bytes, pdf, pdfJsDocument, sampledPageObservations, signal);
    } finally {
      pdf.flush?.();
    }
  }

  private async analyzeDocument(
    fileSize: number,
    sourceBytes: Uint8Array,
    pdf: PDFDocument,
    pdfJsDocument: any,
    sampledPageObservations: PdfForensicPageObservation[],
    signal?: AbortSignal,
  ): Promise<PdfForensicAnalysis> {
    let partial = false;

    const rawObjects = this.collectRawObjects(pdf);
    const streamObjects = rawObjects.filter((record) => record.streamBytes > 0);
    const streamBytes = streamObjects.reduce((sum, record) => sum + record.streamBytes, 0);

    const pageContentKeys = this.collectPageContentKeys(pdf);
    const streamFingerprints = await this.groupStreams(streamObjects, signal);
    const pageContentStreams = streamObjects.filter((record) => pageContentKeys.has(record.key));
    const pageContentFingerprints = await this.groupStreams(pageContentStreams, signal);

    throwIfCompressionCancelled(signal);
    const resources = this.collectResources(pdf);
    const pageContentMetrics = this.collectPageContentMetrics(pdf, rawObjects);
    const sampledPages: PdfForensicPageSummary[] = [];

    if (sampledPageObservations.length > 0) {
      for (const observation of sampledPageObservations.slice(0, this.maxSamplePages)) {
        throwIfCompressionCancelled(signal);
        const content = pageContentMetrics.get(observation.pageNumber);
        sampledPages.push({
          ...observation,
          contentStreamCount: content?.count ?? 0,
          contentStreamBytes: content?.bytes ?? 0,
        });
      }
    } else {
      try {
        const pageCount = Math.min(pdfJsDocument?.numPages ?? pdf.getPageCount(), this.maxSamplePages);
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          throwIfCompressionCancelled(signal);
          try {
            const page = await pdfJsDocument.getPage(pageNumber);
            const summary = await this.inspectPdfJsPage(page, pageNumber);
            const content = pageContentMetrics.get(pageNumber);
            if (content) {
              summary.contentStreamCount = content.count;
              summary.contentStreamBytes = content.bytes;
            }
            sampledPages.push(summary);
            try { page.cleanup?.(); } catch { /* best effort */ }
          } catch {
            partial = true;
          }
        }
      } catch {
        partial = true;
      }
    }

    const imageOperatorCount = sampledPages.reduce((sum, page) => sum + page.imageOperatorCount, 0);
    const imagePages = sampledPages.filter((page) => page.imageOperatorCount > 0).length;
    const sampledImageAreaRatio = sampledPages.length > 0
      ? sampledPages.reduce((sum, page) => sum + page.imageAreaRatio, 0) / sampledPages.length
      : 0;

    const metadata = {
      title: this.nullIfEmpty(pdf.getTitle()),
      author: this.nullIfEmpty(pdf.getAuthor()),
      subject: this.nullIfEmpty(pdf.getSubject()),
      creator: this.nullIfEmpty(pdf.getCreator()),
      producer: this.nullIfEmpty(pdf.getProducer()),
    };

    return {
      version: 1,
      fileSize,
      pdfHeader: this.readPdfHeader(sourceBytes),
      pageCount: pdf.getPageCount(),
      sampledPageCount: sampledPages.length,
      objectCount: rawObjects.length,
      streamObjectCount: streamObjects.length,
      streamBytes,
      uniqueStreamCount: streamFingerprints.uniqueCount,
      duplicateStreamGroupCount: streamFingerprints.groups.length,
      duplicateStreamBytes: streamFingerprints.duplicateBytes,
      pageContentStreamCount: pageContentStreams.length,
      pageContentStreamBytes: pageContentStreams.reduce((sum, record) => sum + record.streamBytes, 0),
      uniquePageContentStreamCount: pageContentFingerprints.uniqueCount,
      duplicatePageContentStreamGroupCount: pageContentFingerprints.groups.length,
      duplicatePageContentBytes: pageContentFingerprints.duplicateBytes,
      imageResourceCount: resources.imageReferenceCount,
      uniqueImageResourceCount: resources.images.length,
      imageBytes: resources.images.reduce((sum, image) => sum + image.bytes, 0),
      imageReferenceCount: resources.imageReferenceCount,
      imageOperatorCount,
      imagePages,
      sampledImageAreaRatio,
      fontResourceCount: resources.fontResourceCount,
      formXObjectCount: resources.formXObjectCount,
      patternResourceCount: resources.patternResourceCount,
      shadingResourceCount: resources.shadingResourceCount,
      duplicateStreams: streamFingerprints.groups,
      duplicatePageContentStreams: pageContentFingerprints.groups,
      imageResources: resources.images,
      sampledPages,
      metadata,
      partial,
    };
  }

  private collectRawObjects(pdf: PDFDocument): RawObjectRecord[] {
    const context = (pdf as any).context;
    const entries: Array<[any, any]> = context?.enumerateIndirectObjects?.() ?? [];

    return entries.map(([ref, object]) => {
      const key = this.refKey(ref);
      const contents = this.extractStreamContents(object);
      return {
        key,
        object,
        streamBytes: contents?.byteLength ?? 0,
      };
    });
  }

  private collectPageContentKeys(pdf: PDFDocument): Set<string> {
    const keys = new Set<string>();
    const context = (pdf as any).context;
    const contentsName = PDFName.of('Contents');

    for (const page of pdf.getPages()) {
      try {
        const entry = (page as any).node?.get?.(contentsName);
        this.collectRefKeys(entry, keys);
      } catch {
        // A malformed/inherited page entry should not abort forensic analysis.
      }
    }

    // Direct content streams are not represented by an indirect reference and
    // therefore cannot participate in object-level deduplication. They remain
    // intentionally outside this exact duplicate-stream metric.
    void context;
    return keys;
  }

  private collectRefKeys(value: any, keys: Set<string>): void {
    if (!value) return;

    if (this.isRef(value)) {
      keys.add(this.refKey(value));
      return;
    }

    if (typeof value.asArray === 'function') {
      for (const item of value.asArray()) this.collectRefKeys(item, keys);
    }
  }

  private collectPageContentMetrics(
    pdf: PDFDocument,
    rawObjects: RawObjectRecord[],
  ): Map<number, { count: number; bytes: number }> {
    const context = (pdf as any).context;
    const contentsName = PDFName.of('Contents');
    const rawByKey = new Map(rawObjects.map((record) => [record.key, record]));
    const result = new Map<number, { count: number; bytes: number }>();

    pdf.getPages().forEach((page, index) => {
      let count = 0;
      let bytes = 0;
      try {
        const entry = (page as any).node?.get?.(contentsName);
        const refs: any[] = [];
        this.collectRefs(entry, refs);
        for (const ref of refs) {
          const record = rawByKey.get(this.refKey(ref));
          if (record && record.streamBytes > 0) {
            count += 1;
            bytes += record.streamBytes;
          }
        }

        // A direct stream is legal PDF and is not part of the indirect-object
        // table. Count it for page-level telemetry but do not use it in the
        // duplicate indirect-stream metric.
        if (refs.length === 0) {
          const direct = this.lookup(context, entry);
          if (this.extractStreamContents(direct)) {
            count = 1;
            bytes = this.extractStreamContents(direct)?.byteLength ?? 0;
          }
        }
      } catch {
        // Best-effort metric only.
      }
      result.set(index + 1, { count, bytes });
    });

    return result;
  }

  private collectRefs(value: any, refs: any[]): void {
    if (!value) return;
    if (this.isRef(value)) {
      refs.push(value);
      return;
    }
    if (typeof value.asArray === 'function') {
      for (const item of value.asArray()) this.collectRefs(item, refs);
    }
  }

  private collectResources(pdf: PDFDocument): {
    imageReferenceCount: number;
    images: PdfForensicImageResource[];
    fontResourceCount: number;
    formXObjectCount: number;
    patternResourceCount: number;
    shadingResourceCount: number;
  } {
    const context = (pdf as any).context;
    const resourcesByKey = new Map<string, PdfForensicImageResource>();
    let imageReferenceCount = 0;
    let fontResourceCount = 0;
    let formXObjectCount = 0;
    let patternResourceCount = 0;
    let shadingResourceCount = 0;

    for (const page of pdf.getPages()) {
      try {
        const resources = (page as any).node?.get?.(PDFName.of('Resources'));
        const resourceDict = this.lookup(context, resources);
        if (!resourceDict) continue;

        const xObjectDict = this.lookup(context, resourceDict.get?.(PDFName.of('XObject')));
        if (xObjectDict) {
          for (const key of xObjectDict.keys?.() ?? []) {
            const object = this.lookup(context, xObjectDict.get?.(key));
            const subtype = this.nameValue(object?.dict?.get?.(PDFName.of('Subtype')) ?? object?.get?.(PDFName.of('Subtype')));
            const ref = xObjectDict.get?.(key);
            const refKey = this.isRef(ref) ? this.refKey(ref) : `direct:${String(key)}`;

            if (subtype === 'Image') {
              imageReferenceCount += 1;
              const existing = resourcesByKey.get(refKey);
              if (existing) {
                existing.references += 1;
                continue;
              }

              const streamContents = this.extractStreamContents(object);
              resourcesByKey.set(refKey, {
                key: refKey,
                width: this.numberValue(object?.dict?.get?.(PDFName.of('Width')) ?? object?.get?.(PDFName.of('Width'))),
                height: this.numberValue(object?.dict?.get?.(PDFName.of('Height')) ?? object?.get?.(PDFName.of('Height'))),
                filter: this.filterValue(object?.dict?.get?.(PDFName.of('Filter')) ?? object?.get?.(PDFName.of('Filter'))),
                bytes: streamContents?.byteLength ?? 0,
                references: 1,
                sampled: false,
              });
            } else if (subtype === 'Form') {
              formXObjectCount += 1;
            }
          }
        }

        const fonts = this.lookup(context, resourceDict.get?.(PDFName.of('Font')));
        fontResourceCount += fonts?.keys?.().length ?? 0;

        const patterns = this.lookup(context, resourceDict.get?.(PDFName.of('Pattern')));
        patternResourceCount += patterns?.keys?.().length ?? 0;

        const shadings = this.lookup(context, resourceDict.get?.(PDFName.of('Shading')));
        shadingResourceCount += shadings?.keys?.().length ?? 0;
      } catch {
        // Resource dictionaries are optional and can be malformed in PDFs that
        // PDF.js can still recover. Keep the successful observations.
      }
    }

    return {
      imageReferenceCount,
      images: [...resourcesByKey.values()],
      fontResourceCount,
      formXObjectCount,
      patternResourceCount,
      shadingResourceCount,
    };
  }

  private async inspectPdfJsPage(page: any, pageNumber: number): Promise<PdfForensicPageSummary> {
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const [text, operatorList] = await Promise.all([
      page.getTextContent(),
      page.getOperatorList(),
    ]);

    const fnArray: number[] = operatorList?.fnArray ?? [];
    const argsArray: unknown[][] = operatorList?.argsArray ?? [];
    const pdfjs = await import('pdfjs-dist');
    const ops = pdfjs.OPS as any;
    const imageOps = new Set<number>([
      ops.paintImageMaskXObject,
      ops.paintImageMaskXObjectRepeat,
      ops.paintImageXObject,
      ops.paintImageXObjectRepeat,
      ops.paintInlineImageXObject,
      ops.paintInlineImageXObjectGroup,
      ops.paintJpegXObject,
      ops.paintSolidColorImageMask,
    ].filter((value): value is number => typeof value === 'number'));

    let imageOperatorCount = 0;
    let imageArea = 0;
    let vectorOperatorCount = 0;
    let transform: [number, number, number, number, number, number] | null = null;

    for (let index = 0; index < fnArray.length; index += 1) {
      const fn = fnArray[index];
      const args = argsArray[index];
      if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
        transform = args.slice(0, 6).map(Number) as [number, number, number, number, number, number];
        continue;
      }
      if (imageOps.has(fn)) {
        imageOperatorCount += 1;
        if (transform) {
          imageArea += Math.abs(Math.hypot(transform[0], transform[1]) * Math.hypot(transform[2], transform[3]));
        }
      } else if (fn !== ops.save && fn !== ops.restore && fn !== ops.transform) {
        vectorOperatorCount += 1;
      }
    }

    const pageArea = Math.max(1, viewport.width * viewport.height);
    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: Number(page.rotate ?? 0),
      contentStreamCount: 0,
      contentStreamBytes: 0,
      imageOperatorCount,
      imageAreaRatio: Math.min(1, imageArea / pageArea),
      textItemCount: text.items?.length ?? 0,
      vectorOperatorCount,
    };
  }

  private async groupStreams(records: RawObjectRecord[], signal?: AbortSignal): Promise<{
    uniqueCount: number;
    groups: PdfForensicDuplicateGroup[];
    duplicateBytes: number;
  }> {
    const fingerprints = new Map<string, { count: number; bytes: number }>();

    for (const record of records) {
      throwIfCompressionCancelled(signal);
      const contents = this.extractStreamContents(record.object);
      if (!contents) continue;
      const fingerprint = await this.fingerprint(contents);
      // `contents` is intentionally scoped to this iteration. Large stream
      // payloads are not retained in the raw-object index.
      void contents;
      const current = fingerprints.get(fingerprint) ?? { count: 0, bytes: 0 };
      current.count += 1;
      current.bytes += record.streamBytes;
      fingerprints.set(fingerprint, current);
    }

    const groups = [...fingerprints.entries()]
      .filter(([, value]) => value.count > 1)
      .map(([fingerprint, value]) => ({
        fingerprint,
        objectCount: value.count,
        totalBytes: value.bytes,
        duplicateBytes: value.bytes - value.bytes / value.count,
      }));

    return {
      uniqueCount: fingerprints.size,
      groups,
      duplicateBytes: groups.reduce((sum, group) => sum + group.duplicateBytes, 0),
    };
  }

  private extractStreamContents(object: any): Uint8Array | null {
    const contents = object?.contents;
    if (contents instanceof Uint8Array) return contents;
    if (contents instanceof ArrayBuffer) return new Uint8Array(contents);
    if (ArrayBuffer.isView(contents)) return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
    return null;
  }

  private lookup(context: any, value: any): any {
    if (!value) return null;
    if (this.isRef(value)) {
      return context?.lookup?.(value) ?? null;
    }
    return value;
  }

  private isRef(value: any): boolean {
    return Boolean(value && Number.isInteger(value.objectNumber));
  }

  private refKey(ref: any): string {
    return `${ref.objectNumber} ${ref.generationNumber ?? 0}`;
  }

  private nameValue(value: any): string | null {
    if (!value) return null;
    if (typeof value.decodeText === 'function') return value.decodeText();
    const text = String(value);
    return text.startsWith('/') ? text.slice(1) : text;
  }

  private numberValue(value: any): number | null {
    if (!value) return null;
    if (typeof value.asNumber === 'function') {
      const number = value.asNumber();
      return Number.isFinite(number) ? number : null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private filterValue(value: any): string | null {
    if (!value) return null;
    if (typeof value.asArray === 'function') {
      return value.asArray().map((item: any) => this.nameValue(item)).filter(Boolean).join(',') || null;
    }
    return this.nameValue(value);
  }

  private nullIfEmpty(value: string | undefined): string | null {
    return value && value.trim() ? value : null;
  }

  private readPdfHeader(bytes: Uint8Array): string | null {
    const limit = Math.min(bytes.length, 32);
    let header = '';
    for (let index = 0; index < limit; index += 1) {
      const code = bytes[index];
      if (code === 10 || code === 13) break;
      header += String.fromCharCode(code);
    }
    return /^%PDF-\d(?:\.\d+)?/.test(header) ? header : null;
  }

  private async fingerprint(bytes: Uint8Array): Promise<string> {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle) {
      // TypeScript 5.9+ correctly models Uint8Array as potentially backed by
      // SharedArrayBuffer (ArrayBufferLike), while SubtleCrypto.digest()
      // requires a BufferSource backed by a concrete ArrayBuffer. Create an
      // owned ArrayBuffer copy so the browser/runtime contract is explicit.
      const digestInput = new Uint8Array(bytes.byteLength);
      digestInput.set(bytes);
      const digest = await cryptoApi.subtle.digest('SHA-256', digestInput.buffer);
      return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    }

    // Browser targets used by SafePDFHub provide SubtleCrypto. This fallback
    // keeps forensic analysis deterministic in constrained test environments.
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${bytes.byteLength}`;
  }
}

import { Injectable, inject } from '@angular/core';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import { DOCX_MIME, WordPage, WordImage } from './word-document';
import { groupText, safeWordName, TextFragment } from './word-layout';
import { assessOcr, containsRuledTable } from './ocr-quality';
import { WordArchive } from './word-archive';
import { WordOcr, DEFAULT_OCR, OcrOptions, ocrLines, abortable } from './word-ocr';
import { pdfFileRange } from './pdf-file-range';
import type { PDFPageProxy } from 'pdfjs-dist';
type SourceImageBox = Omit<WordImage, 'id' | 'bytes'> & { sourceDpi?: number };
export type WordMode = 'editable' | 'appearance';
export interface WordResult {
  file: File;
  pages: number;
  imagePages: number[];
  ocrPages: number[];
  preservedPages: { page: number; reason: string; confidence?: number }[];
  reviewPages: number[];
  durationMs: number;
  mode: WordMode;
}
export interface WordProgress {
  percent: number;
  message: string;
  page?: number;
  totalPages?: number;
}
@Injectable({ providedIn: 'root' })
export class PdfToWordService {
  private readonly loader = inject(PdfJsLoaderService);
  private readonly capability = inject(LocalProcessingCapabilityService);
  get limits() {
    const c = this.capability.current;
    const small =
      c.formFactor === 'mobile' ||
      c.formFactor === 'tablet' ||
      c.tier === 'conservative' ||
      (c.memoryGiB !== null && c.memoryGiB <= 4);
    return {
      bytes: 200_000_000,
      pixels: small ? 1_500_000 : 3_000_000,
      ocrPixels: small ? 2_500_000 : 5_000_000,
      small,
    };
  }
  async convert(
    file: File,
    mode: WordMode,
    signal: AbortSignal,
    progress: (p: WordProgress) => void,
    ocrOptions: OcrOptions = DEFAULT_OCR,
  ): Promise<WordResult> {
    const started = performance.now(),
      limits = this.limits;
    const check = () => {
      if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    };
    check();
    if (!file.size || file.size > limits.bytes)
      throw new Error(
        `Choose a non-empty PDF up to ${limits.bytes / 1_000_000} MB on this device.`,
      );
    const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-'))
      throw new Error('This file does not contain a valid PDF header. Choose another PDF.');
    const pdfjs = await this.loader.load();
    check();
    let failRange!: (error: unknown) => void;
    const rangeFailure = new Promise<never>((_, reject) => {
      failRange = reject;
    });
    // Attach a handler immediately, including failures occurring between page requests.
    void rangeFailure.catch(() => {});
    const range = pdfFileRange(pdfjs, file, failRange);
    const wait = <T>(work: Promise<T>) => abortable(Promise.race([work, rangeFailure]), signal);
    const asset = (folder: string) =>
      new URL(`/assets/pdfjs/${folder}/`, document.baseURI).toString();
    const task = pdfjs.getDocument({
      range,
      length: file.size,
      rangeChunkSize: 1_048_576,
      disableAutoFetch: true,
      disableStream: true,
      canvasMaxAreaInBytes: limits.small ? 16_000_000 : 32_000_000,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: true,
      cMapUrl: asset('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: asset('standard_fonts'),
      wasmUrl: asset('wasm'),
    });
    const abort = () => {
      range.abort();
      void task.destroy().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    const archive = new WordArchive(signal);
    const imagePages: number[] = [],
      ocrPages: number[] = [],
      reviewPages: number[] = [];
    const preservedPages: WordResult['preservedPages'] = [];
    const ocr = new WordOcr(ocrOptions.language, signal);
    let pageCount = 0,
      imageId = 0;
    try {
      progress({ percent: 2, message: 'Reading your PDF…' });
      const doc = await wait(task.promise);
      check();
      const permissions = await wait(doc.getPermissions());
      if (permissions && !permissions.includes(pdfjs.PermissionFlag.COPY))
        throw new Error('This PDF restricts copying. Use a PDF that allows text extraction.');
      for (let n = 1; n <= doc.numPages; n++) {
        check();
        progress({
          percent: Math.round(5 + (80 * (n - 1)) / doc.numPages),
          message: `Converting page ${n} of ${doc.numPages}…`,
          page: n,
          totalPages: doc.numPages,
        });
        const page = await wait(doc.getPage(n)),
          viewport = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(viewport.width + viewport.height) ||
          viewport.width <= 0 ||
          viewport.height <= 0 ||
          viewport.width > 1584 ||
          viewport.height > 1584
        )
          throw new Error(
            `Page ${n} exceeds Word’s supported page dimensions. Resize this PDF first.`,
          );
        try {
          const content = mode === 'editable' ? await wait(page.getTextContent()) : null;
          check();
          const imageBoxes =
            mode === 'editable'
              ? await wait(this.imageBoxes(page, pdfjs.OPS, viewport.transform))
              : [];
          check();
          const fragments: TextFragment[] = [];
          let rotated = false;
          for (const item of content?.items ?? []) {
            if (!('str' in item) || !item.str.trim()) continue;
            const t = pdfjs.Util.transform(viewport.transform, item.transform);
            const size = Math.hypot(t[2], t[3]);
            if (Math.abs(t[1]) > 0.1 * Math.max(1, Math.abs(t[0]))) rotated = true;
            const style = content!.styles[item.fontName];
            const font = page.commonObjs.has(item.fontName)
              ? page.commonObjs.get(item.fontName)
              : null;
            fragments.push({
              text: item.str,
              x: t[4],
              y: t[5] - size,
              width: Math.abs(item.width),
              size,
              font: font?.name ?? item.fontName,
              family: style?.fontFamily,
              rtl: item.dir === 'rtl',
            });
          }
          const backgroundImage = imageBoxes.some(
            (b) => b.width * b.height > viewport.width * viewport.height * 0.7,
          );
          const textLength = fragments.reduce((sum, item) => sum + item.text.trim().length, 0);
          // Outlined/vector text has no text layer or image XObjects. Preserve it and
          // allow OCR instead of accidentally exporting a blank page.
          const hasGraphics =
            imageBoxes.length > 0 ||
            (!fragments.length && (await wait(page.getOperatorList())).fnArray.length > 0);
          const needsOcr =
            mode === 'editable' &&
            (ocrOptions.mode === 'always' ||
              (ocrOptions.mode === 'auto' &&
                hasGraphics &&
                (textLength === 0 || (backgroundImage && textLength < 40))));
          if (needsOcr && !ocrOptions.language)
            throw new Error(
              'Choose the document language before converting scanned pages. For Marathi documents, select Marathi or Marathi + English.',
            );
          const lowResolutionScan = imageBoxes.some(
            (box) =>
              box.width * box.height >= viewport.width * viewport.height * 0.7 &&
              box.sourceDpi !== undefined &&
              box.sourceDpi < 150,
          );
          const preserveLowResolution = needsOcr && lowResolutionScan;
          const output: WordPage = {
            width: viewport.width,
            height: viewport.height,
            visual:
              mode === 'appearance' ||
              rotated ||
              backgroundImage ||
              (!fragments.length && hasGraphics),
            lines: groupText(fragments),
            images: [],
          };
          const addImage = (image: WordImage) => output.images.push(image);
          let canvas: HTMLCanvasElement | undefined;
          try {
            if (needsOcr || output.visual || imageBoxes.length)
              canvas = await wait(
                this.render(
                  page,
                  needsOcr && !preserveLowResolution ? limits.ocrPixels : limits.pixels,
                  signal,
                  preserveLowResolution
                    ? Math.min(
                        2,
                        Math.max(1, ...imageBoxes.map((box) => (box.sourceDpi ?? 72) / 72)),
                      )
                    : needsOcr
                      ? 3
                      : 2,
                ),
              );
            if (preserveLowResolution) {
              output.visual = true;
              reviewPages.push(n);
              preservedPages.push({
                page: n,
                reason:
                  'Low-resolution scan (below 150 DPI) preserved to avoid incorrect OCR text. Use a clearer source for editable conversion.',
              });
            } else if (needsOcr && canvas && containsRuledTable(canvas)) {
              // Preserve cell associations, numbers, ticks, stamps and handwriting.
              output.visual = true;
              reviewPages.push(n);
              preservedPages.push({
                page: n,
                reason:
                  'Table layout preserved as an image; editable table reconstruction is not supported.',
              });
            } else if (needsOcr && canvas) {
              const data = await ocr.recognize(canvas, (fraction, status) =>
                progress({
                  percent: Math.round(
                    5 + (80 * (n - 1 + Math.min(1, Math.max(0, fraction)) * 0.9)) / doc.numPages,
                  ),
                  message: `${status} Page ${n} of ${doc.numPages}`,
                  page: n,
                  totalPages: doc.numPages,
                }),
              );
              check();
              const recognized = ocrLines(
                data,
                canvas.width / viewport.width,
                canvas.height / viewport.height,
              );
              const assessment = assessOcr(data);
              if (recognized.length && assessment.accepted) {
                output.lines = recognized;
                output.visual = false;
                output.readingOrder = true;
                ocrPages.push(n);
                reviewPages.push(n);
              } else {
                preservedPages.push({
                  page: n,
                  reason: assessment.reason,
                  confidence: assessment.confidence,
                });
                // Never replace original content with unreliable guesses.
                output.visual = true;
                reviewPages.push(n);
              }
            }
            if (output.visual) {
              output.lines = [];
              imagePages.push(n);
            }
            if (output.visual && canvas) {
              addImage({
                id: ++imageId,
                bytes: await this.png(canvas),
                format: 'png',
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height,
              });
            } else if (canvas && !needsOcr) {
              if (imageBoxes.length > 150)
                throw new Error(`Page ${n} has too many images. Try Keep page appearance mode.`);
              const scaleX = canvas.width / viewport.width,
                scaleY = canvas.height / viewport.height;
              for (const box of imageBoxes) {
                check();
                const x = Math.max(0, box.x),
                  y = Math.max(0, box.y),
                  w = Math.min(viewport.width, box.x + box.width) - x,
                  h = Math.min(viewport.height, box.y + box.height) - y;
                if (w < 2 || h < 2) continue;
                const crop = document.createElement('canvas');
                crop.width = Math.max(1, Math.ceil(w * scaleX));
                crop.height = Math.max(1, Math.ceil(h * scaleY));
                try {
                  crop
                    .getContext('2d')!
                    .drawImage(
                      canvas,
                      x * scaleX,
                      y * scaleY,
                      w * scaleX,
                      h * scaleY,
                      0,
                      0,
                      crop.width,
                      crop.height,
                    );
                  addImage({
                    id: ++imageId,
                    bytes: await this.jpeg(crop),
                    x,
                    y,
                    width: w,
                    height: h,
                  });
                } finally {
                  crop.width = crop.height = 0;
                }
              }
            }
          } finally {
            if (canvas) canvas.width = canvas.height = 0;
          }
          await archive.addPage(output);
          pageCount++;
        } finally {
          page.cleanup();
        }
        if (n % 20 === 0) await wait(doc.cleanup());
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      check();
      progress({ percent: 86, message: 'Building your Word document…' });
      const blob = await archive.finish((p) =>
        progress({ percent: Math.round(86 + p * 0.13), message: 'Building your Word document…' }),
      );
      check();
      progress({ percent: 100, message: 'Word document ready' });
      return {
        file: new File([blob], safeWordName(file.name), { type: DOCX_MIME }),
        pages: pageCount,
        ocrPages,
        preservedPages,
        reviewPages,
        imagePages,
        durationMs: performance.now() - started,
        mode,
      };
    } catch (error) {
      if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
      if ((error as Error)?.name === 'PasswordException')
        throw new Error(
          'This PDF requires a password. Unlock it with your password using Unlock PDF, then convert it.',
        );
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      archive.dispose();
      await ocr.close();
      range.abort();
      await task.destroy();
    }
  }
  private async render(
    page: PDFPageProxy,
    maxPixels: number,
    signal: AbortSignal,
    preferredScale = 2,
  ): Promise<HTMLCanvasElement> {
    const unit = page.getViewport({ scale: 1 });
    const scale = Math.min(preferredScale, Math.sqrt(maxPixels / (unit.width * unit.height)));
    const viewport = page.getViewport({ scale }),
      canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Your browser could not allocate an image canvas. Try fewer pages.');
    const task = page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' });
    const abort = () => task.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) task.cancel();
      await task.promise;
      return canvas;
    } catch (e) {
      canvas.width = canvas.height = 0;
      throw e;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  private png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Unable to preserve the source page image.'));
          return;
        }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      }, 'image/png'),
    );
  }
  private jpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Unable to encode a PDF image.'));
            return;
          }
          blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
        },
        'image/jpeg',
        0.9,
      ),
    );
  }
  private async imageBoxes(
    page: PDFPageProxy,
    ops: typeof import('pdfjs-dist').OPS,
    viewport: number[],
  ): Promise<Array<SourceImageBox>> {
    const { fnArray, argsArray } = await page.getOperatorList();
    let m = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [],
      boxes: Array<SourceImageBox> = [];
    const mul = (a: number[], b: number[]) => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const add = (sourceWidth?: number, sourceHeight?: number) => {
      const t = mul(viewport, m),
        points = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]),
        xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const width = Math.max(...xs) - Math.min(...xs),
        height = Math.max(...ys) - Math.min(...ys);
      boxes.push({
        sourceDpi:
          sourceWidth && sourceHeight && width > 0 && height > 0
            ? Math.min(sourceWidth / width, sourceHeight / height) * 72
            : undefined,
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      });
    };
    for (let i = 0; i < fnArray.length; i++) {
      const op = fnArray[i],
        args = argsArray[i];
      if (op === ops.save) stack.push([...m]);
      else if (op === ops.restore) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (op === ops.transform) m = mul(m, args);
      else if (op === ops.paintFormXObjectBegin) {
        stack.push([...m]);
        if (args[0]) m = mul(m, args[0]);
      } else if (op === ops.paintFormXObjectEnd) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (
        op === ops.paintImageXObject ||
        op === ops.paintInlineImageXObject ||
        op === ops.paintImageMaskXObject
      )
        add(
          op === ops.paintImageXObject ? args[1] : args[0]?.width,
          op === ops.paintImageXObject ? args[2] : args[0]?.height,
        );
    }
    return boxes;
  }
}

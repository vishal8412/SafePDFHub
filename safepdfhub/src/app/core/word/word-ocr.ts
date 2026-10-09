import type { Worker as OcrWorker, Page } from 'tesseract.js';
import type { WordLine } from './word-document';

export type OcrLanguage = '' | 'eng' | 'hin' | 'eng+hin' | 'mar' | 'mar+eng';
export type OcrMode = 'auto' | 'always' | 'off';
export interface OcrOptions {
  mode: OcrMode;
  language: OcrLanguage;
}
export const DEFAULT_OCR: OcrOptions = { mode: 'auto', language: '' };
/** Keep deployment errors actionable without exposing worker internals to users. */
export function ocrStartupError(error: unknown): Error {
  const details = String(error);
  if (/traineddata|fetch|network|404|failed to load|importscripts/i.test(details))
    return new Error(
      'The OCR language files could not be loaded. Reload this page and try again. If the problem continues, contact the site owner or choose Keep page appearance to convert without OCR.',
    );
  return new Error('OCR could not start. Please try again, or choose Keep page appearance to convert without OCR.');
}
export const cancelled = () => new DOMException('Conversion cancelled.', 'AbortError');

/** Races worker work against cancellation: terminating Tesseract does not reject its pending jobs. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    if (signal.aborted) {
      work.catch(() => {});
      reject(cancelled());
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One lazily loaded worker per conversion; reused sequentially and always disposed. */
export class WordOcr {
  private worker?: OcrWorker;
  private closed = false;
  private channel?: BroadcastChannel;
  private report: (fraction: number, status: string) => void = () => {};
  private readonly abort = () => {
    void this.close();
  };
  constructor(
    private language: OcrLanguage,
    private signal: AbortSignal,
  ) {
    signal.addEventListener('abort', this.abort, { once: true });
  }
  async recognize(canvas: HTMLCanvasElement, report: typeof this.report): Promise<Page> {
    if (this.closed || this.signal.aborted) throw cancelled();
    if (!['eng', 'hin', 'eng+hin', 'mar', 'mar+eng'].includes(this.language))
      throw new Error(
        'Choose the document language before recognizing scanned pages. For Marathi documents, select Marathi or Marathi + English.',
      );
    this.report = report;
    if (!this.worker) {
      report(0, 'Loading OCR language…');
      const { createWorker, OEM, PSM } = await abortable(import('tesseract.js'), this.signal);
      if (this.closed) throw cancelled();
      const asset = (path: string) => new URL(`assets/ocr/${path}`, document.baseURI).href;
      const session = `safepdfhub-ocr-${crypto.randomUUID()}`;
      if (typeof BroadcastChannel !== 'undefined') this.channel = new BroadcastChannel(session);
      let fail!: (error: Error) => void;
      const failure = new Promise<never>((_, reject) => {
        fail = reject;
      });
      const timeout = setTimeout(
        () => fail(new Error('OCR could not load. Check your connection and try again.')),
        90_000,
      );
      const initializing = createWorker(this.language, OEM.LSTM_ONLY, {
        workerPath: asset(`worker-bootstrap.js?session=${encodeURIComponent(session)}`),
        corePath: asset('core'),
        langPath: asset('lang'),
        workerBlobURL: false,
        logger: (m) => {
          if (!this.closed)
            this.report(
              m.status === 'recognizing text' ? m.progress : 0,
              m.status === 'recognizing text' ? 'Reading scanned text…' : 'Preparing OCR…',
            );
        },
        errorHandler: (error) =>
          fail(ocrStartupError(error)),
      }).then(async (worker) => {
        if (this.closed || this.signal.aborted) {
          await worker.terminate();
          throw cancelled();
        }
        this.worker = worker;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
        });
        return worker;
      });
      // If cancelled during initialization, its eventual worker is terminated above.
      try {
        await abortable(Promise.race([initializing, failure]), this.signal);
      } catch (error) {
        await this.close();
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    const result = await abortable(
      this.worker!.recognize(canvas, {}, { text: true, blocks: true }),
      this.signal,
    );
    return result.data;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.channel?.postMessage('cancel');
    this.channel?.close();
    this.channel = undefined;
    this.signal.removeEventListener('abort', this.abort);
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
  }
}

/** Keep OCR reading order; do not re-sort different columns by their baseline. */
export function ocrLines(data: Page, scaleX: number, scaleY: number): WordLine[] {
  const lines: WordLine[] = [];
  for (const block of data.blocks ?? [])
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = line.text?.trim();
        if (!text) continue;
        const b = line.bbox;
        const height = Math.max(4, (b.y1 - b.y0) / scaleY);
        lines.push({
          x: b.x0 / scaleX,
          y: b.y0 / scaleY,
          width: (b.x1 - b.x0) / scaleX,
          height,
          runs: [
            {
              text,
              size: Math.max(6, Math.min(72, height)),
              font: 'Arial',
              rtl: paragraph.is_ltr === false,
            },
          ],
        });
      }
    }
  // Preserve recognized words even if the engine cannot supply layout blocks.
  if (!lines.length && data.text.trim())
    for (const text of data.text.trim().split(/\r?\n/).filter(Boolean)) {
      lines.push({
        x: 36,
        y: 36 + lines.length * 14,
        width: 400,
        height: 12,
        runs: [{ text, size: 12, font: 'Arial' }],
      });
    }
  return lines;
}

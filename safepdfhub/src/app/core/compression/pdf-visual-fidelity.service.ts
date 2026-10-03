import { throwIfCompressionCancelled } from './compression-cancellation';
import { Injectable } from '@angular/core';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalysis, PdfForensicPageSummary } from './pdf-forensic.models';
import { PdfVisualFidelityResult, PdfVisualFidelityPageResult } from './pdf-visual-fidelity.models';

/**
 * V2.4 visual-fidelity guard for lossy image candidates.
 *
 * It renders a small deterministic sample of the source and candidate PDFs
 * through PDF.js and compares pixels at a bounded resolution. The guard is
 * deliberately conservative: if rendering/comparison cannot be completed,
 * a lossy candidate is rejected rather than silently accepted.
 */
@Injectable({ providedIn: 'root' })
export class PdfVisualFidelityService {
  private readonly maxSamplePages = 6;
  private readonly maxRenderPixels = 700_000;
  private readonly sourceSampleCache = new WeakMap<File, { key: string; promise: Promise<RenderedSample[]> }>();

  constructor(private readonly pdfJsLoader: PdfJsLoaderService) {}

  async validate(
    source: File,
    candidate: File,
    forensic: PdfForensicAnalysis | undefined,
    level: 'light' | 'recommended' | 'strong',
    signal?: AbortSignal,
    pageCount?: number,
  ): Promise<PdfVisualFidelityResult> {
    const thresholds = this.thresholds(level);
    throwIfCompressionCancelled(signal);
    const sampledPages = pageCount && pageCount > 0
      ? [...new Set(Array.from({ length: Math.min(this.maxSamplePages, pageCount) }, (_, i) =>
          1 + Math.round(i * (pageCount - 1) / Math.max(1, Math.min(this.maxSamplePages, pageCount) - 1))))]
      : this.selectSamplePages(forensic);

    if (sampledPages.length === 0) {
      return {
        status: 'skipped',
        sampledPages: [],
        pages: [],
        maxMeanAbsoluteError: 0,
        maxChangedPixelRatio: 0,
        meanAbsoluteError: 0,
        thresholdMeanAbsoluteError: thresholds.meanAbsoluteError,
        thresholdChangedPixelRatio: thresholds.changedPixelRatio,
        reason: 'No suitable forensic sample pages were available for visual validation.',
      };
    }

    try {
      const sourceSamples = await this.getSourceSamples(source, sampledPages, signal);
      const pdfjs = await this.pdfJsLoader.load();
      const candidateBuffer = await candidate.arrayBuffer();
      throwIfCompressionCancelled(signal);
      const task = pdfjs.getDocument({ data: new Uint8Array(candidateBuffer) });
      const onAbort = () => { void task.destroy().catch(() => undefined); };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
      const candidatePdf = await task.promise;

      try {
        if (candidatePdf.numPages !== (forensic?.pageCount ?? candidatePdf.numPages)) {
          return this.rejected(sampledPages, thresholds, 'Candidate page count differs from the forensic source.');
        }

        const pages: PdfVisualFidelityPageResult[] = [];
        for (const sample of sourceSamples) {
          throwIfCompressionCancelled(signal);
          pages.push(await this.compareRenderedSample(candidatePdf, sample, thresholds, signal));
        }

        const maxMeanAbsoluteError = Math.max(...pages.map(page => page.meanAbsoluteError), 0);
        const maxChangedPixelRatio = Math.max(...pages.map(page => page.changedPixelRatio), 0);
        const meanAbsoluteError = pages.length > 0
          ? pages.reduce((sum, page) => sum + page.meanAbsoluteError, 0) / pages.length
          : 0;

        const passed = pages.every(page => page.passed);
        return {
          status: passed ? 'passed' : 'rejected',
          sampledPages,
          pages,
          maxMeanAbsoluteError,
          maxChangedPixelRatio,
          meanAbsoluteError,
          thresholdMeanAbsoluteError: thresholds.meanAbsoluteError,
          thresholdChangedPixelRatio: thresholds.changedPixelRatio,
          reason: passed ? null : 'Rendered visual difference exceeded the configured fidelity threshold.',
        };
      } finally {
        try { await candidatePdf.destroy?.(); } catch { /* best effort */ }
      }
      } finally { signal?.removeEventListener('abort', onAbort); await task.destroy().catch(() => undefined); }
    } catch (error) {
      throwIfCompressionCancelled(signal);
      return this.rejected(
        sampledPages,
        thresholds,
        `Visual validation could not be completed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Reuse documents owned by final certification; do not reload or destroy them. */
  async validateDocuments(
    source: any, candidate: any, level: 'light' | 'recommended' | 'strong', signal?: AbortSignal,
  ): Promise<PdfVisualFidelityResult> {
    const thresholds = this.thresholds(level);
    const count = Math.min(this.maxSamplePages, source.numPages);
    const sampledPages = [...new Set(Array.from({ length: count }, (_, i) =>
      1 + Math.round(i * (source.numPages - 1) / Math.max(1, count - 1))))];
    if (!count || source.numPages !== candidate.numPages) {
      return this.rejected(sampledPages, thresholds, 'Candidate page count differs from the source.');
    }
    try {
      const pages: PdfVisualFidelityPageResult[] = [];
      for (const pageNumber of sampledPages) {
        throwIfCompressionCancelled(signal);
        const page = await source.getPage(pageNumber);
        try {
          const base = page.getViewport({ scale: 1, rotation: 0 });
          const viewport = page.getViewport({ scale: this.sampleScale(base.width, base.height), rotation: 0 });
          const canvas = this.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          try {
            await this.render(page, canvas, viewport, signal);
            const sample = { pageNumber, width: canvas.width, height: canvas.height,
              imageData: new Uint8ClampedArray(canvas.context.getImageData(0, 0, canvas.width, canvas.height).data) };
            pages.push(await this.compareRenderedSample(candidate, sample, thresholds, signal));
          } finally { canvas.cleanup(); }
        } finally { try { page.cleanup?.(); } catch { /* best effort */ } }
      }
      const passed = pages.every(page => page.passed);
      return {
        status: passed ? 'passed' : 'rejected', sampledPages, pages,
        maxMeanAbsoluteError: Math.max(...pages.map(page => page.meanAbsoluteError), 0),
        maxChangedPixelRatio: Math.max(...pages.map(page => page.changedPixelRatio), 0),
        meanAbsoluteError: pages.reduce((sum, page) => sum + page.meanAbsoluteError, 0) / pages.length,
        thresholdMeanAbsoluteError: thresholds.meanAbsoluteError,
        thresholdChangedPixelRatio: thresholds.changedPixelRatio,
        reason: passed ? null : 'Rendered visual difference exceeded the configured fidelity threshold.',
      };
    } catch (error) {
      throwIfCompressionCancelled(signal);
      return this.rejected(sampledPages, thresholds,
        `Visual validation could not be completed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async getSourceSamples(source: File, sampledPages: number[], signal?: AbortSignal): Promise<RenderedSample[]> {
    const cached = this.sourceSampleCache.get(source);
    const key = sampledPages.join(',');
    if (cached?.key === key) return cached.promise;

    const promise = this.renderSourceSamples(source, sampledPages, signal);
    this.sourceSampleCache.set(source, { key, promise });
    try {
      return await promise;
    } catch (error) {
      this.sourceSampleCache.delete(source);
      throw error;
    }
  }

  private async renderSourceSamples(source: File, sampledPages: number[], signal?: AbortSignal): Promise<RenderedSample[]> {
    const pdfjs = await this.pdfJsLoader.load();
    const buffer = await source.arrayBuffer();
    throwIfCompressionCancelled(signal);
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const onAbort = () => { void task.destroy().catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const samples: RenderedSample[] = [];

    try {
      const pdf = await task.promise;
      for (const pageNumber of sampledPages) {
        throwIfCompressionCancelled(signal);
        const page = await pdf.getPage(pageNumber);
        try {
          const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
          const scale = this.sampleScale(baseViewport.width, baseViewport.height);
          const viewport = page.getViewport({ scale, rotation: 0 });
          const canvas = this.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          try {
            await this.render(page, canvas, viewport, signal);
            const imageData = canvas.context.getImageData(0, 0, canvas.width, canvas.height).data;
            samples.push({ pageNumber, width: canvas.width, height: canvas.height, imageData: new Uint8ClampedArray(imageData) });
          } finally {
            canvas.cleanup();
          }
        } finally {
          try { page.cleanup?.(); } catch { /* best effort */ }
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try { await task.destroy(); } catch { /* best effort */ }
    }

    return samples;
  }

  private async compareRenderedSample(
    candidatePdf: any,
    sourceSample: RenderedSample,
    thresholds: { meanAbsoluteError: number; changedPixelRatio: number },
    signal?: AbortSignal,
  ): Promise<PdfVisualFidelityPageResult> {
    const page = await candidatePdf.getPage(sourceSample.pageNumber);
    try {
      const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
      const scale = this.sampleScale(baseViewport.width, baseViewport.height);
      const viewport = page.getViewport({ scale, rotation: 0 });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      if (width !== sourceSample.width || height !== sourceSample.height) {
        throw new Error(`Rendered dimensions differ on page ${sourceSample.pageNumber}.`);
      }

      const canvas = this.createCanvas(width, height);
      try {
        await this.render(page, canvas, viewport, signal);
        const candidateData = canvas.context.getImageData(0, 0, width, height).data;
        const metrics = this.comparePixels(sourceSample.imageData, candidateData);
        return {
          pageNumber: sourceSample.pageNumber,
          meanAbsoluteError: metrics.meanAbsoluteError,
          changedPixelRatio: metrics.changedPixelRatio,
          passed:
            metrics.meanAbsoluteError <= thresholds.meanAbsoluteError &&
            metrics.changedPixelRatio <= thresholds.changedPixelRatio,
        };
      } finally {
        canvas.cleanup();
      }
    } finally {
      try { page.cleanup?.(); } catch { /* best effort */ }
    }
  }

  private async render(page: any, canvas: CanvasTarget, viewport: any, signal?: AbortSignal): Promise<void> {
    throwIfCompressionCancelled(signal);
    const task = page.render({ canvasContext: canvas.context as any, viewport, intent: 'display' });
    const onAbort = () => task.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try { await task.promise; throwIfCompressionCancelled(signal); }
    finally { signal?.removeEventListener('abort', onAbort); }
  }

  private createCanvas(width: number, height: number): CanvasTarget {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas context is unavailable.');
      return {
        width,
        height,
        context,
        cleanup: () => { canvas.width = 1; canvas.height = 1; },
      };
    }

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas context is unavailable.');
      return {
        width,
        height,
        context,
        cleanup: () => { canvas.width = 1; canvas.height = 1; },
      };
    }

    throw new Error('Canvas rendering is unavailable in this environment.');
  }

  private comparePixels(source: Uint8ClampedArray, candidate: Uint8ClampedArray): {
    meanAbsoluteError: number;
    changedPixelRatio: number;
  } {
    if (source.length !== candidate.length || source.length === 0) {
      throw new Error('Rendered candidate dimensions differ from the source.');
    }

    let totalDifference = 0;
    let changedPixels = 0;
    const pixelCount = source.length / 4;
    const changedThreshold = 12 / 255;

    for (let index = 0; index < source.length; index += 4) {
      const r = Math.abs(source[index] - candidate[index]) / 255;
      const g = Math.abs(source[index + 1] - candidate[index + 1]) / 255;
      const b = Math.abs(source[index + 2] - candidate[index + 2]) / 255;
      const difference = (r + g + b) / 3;
      totalDifference += difference;
      if (difference > changedThreshold) changedPixels += 1;
    }

    return {
      meanAbsoluteError: totalDifference / pixelCount,
      changedPixelRatio: changedPixels / pixelCount,
    };
  }

  private sampleScale(width: number, height: number): number {
    const pixels = Math.max(1, width * height);
    return Math.min(1, Math.sqrt(this.maxRenderPixels / pixels));
  }

  private selectSamplePages(forensic: PdfForensicAnalysis | undefined): number[] {
    const pages = forensic?.sampledPages ?? [];
    if (pages.length === 0) return [];

    const ranked = [...pages].sort((a, b) => {
      const scoreA = this.pageScore(a);
      const scoreB = this.pageScore(b);
      return scoreB - scoreA || a.pageNumber - b.pageNumber;
    });

    const selected: number[] = [];
    const add = (pageNumber: number) => {
      if (selected.length >= this.maxSamplePages || selected.includes(pageNumber)) return;
      selected.push(pageNumber);
    };

    add(pages[0].pageNumber);
    add(pages[Math.floor(pages.length / 2)].pageNumber);
    add(pages[pages.length - 1].pageNumber);
    for (const page of ranked) add(page.pageNumber);

    return selected.slice(0, this.maxSamplePages).sort((a, b) => a - b);
  }

  private pageScore(page: PdfForensicPageSummary): number {
    return (page.imageAreaRatio * 100) + Math.min(page.imageOperatorCount, 20) + (page.textItemCount > 0 ? 1 : 0);
  }

  private thresholds(level: 'light' | 'recommended' | 'strong') {
    switch (level) {
      case 'light':
        return { meanAbsoluteError: 0.012, changedPixelRatio: 0.08 };
      case 'recommended':
        return { meanAbsoluteError: 0.025, changedPixelRatio: 0.15 };
      case 'strong':
        return { meanAbsoluteError: 0.050, changedPixelRatio: 0.25 };
    }
  }

  private rejected(
    sampledPages: number[],
    thresholds: { meanAbsoluteError: number; changedPixelRatio: number },
    reason: string,
  ): PdfVisualFidelityResult {
    return {
      status: 'rejected',
      sampledPages,
      pages: [],
      maxMeanAbsoluteError: Number.POSITIVE_INFINITY,
      maxChangedPixelRatio: Number.POSITIVE_INFINITY,
      meanAbsoluteError: Number.POSITIVE_INFINITY,
      thresholdMeanAbsoluteError: thresholds.meanAbsoluteError,
      thresholdChangedPixelRatio: thresholds.changedPixelRatio,
      reason,
    };
  }
}

type CanvasTarget = {
  width: number;
  height: number;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cleanup: () => void;
};

interface RenderedSample {
  pageNumber: number;
  width: number;
  height: number;
  imageData: Uint8ClampedArray;
}

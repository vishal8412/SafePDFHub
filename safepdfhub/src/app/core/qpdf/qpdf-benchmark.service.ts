import { Injectable } from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { PDFDocument } from 'pdf-lib';
import { QpdfWasmPrototypeService } from './qpdf-wasm-prototype.service';
import type {
  QpdfBenchmarkComplexity,
  QpdfBenchmarkResult,
  QpdfBenchmarkRun,
  QpdfFidelityInspection,
  QpdfBenchmarkPageGeometry,
  QpdfBenchmarkMemoryTelemetry
} from './qpdf-benchmark.types';
import { MergeEngine } from '../engines/merge.engine';

interface PdfJsAnnotationSummary {
  annotationCount: number;
  linkAnnotationCount: number;
  widgetAnnotationCount: number;
  outlineItemCount: number;
  fieldObjectCount: number;
  firstPageRenderSignature: string | null;
}

@Injectable({ providedIn: 'root' })
export class QpdfBenchmarkService {
  private cancelRequested = false;

  constructor(
    private readonly qpdfService: QpdfWasmPrototypeService,
    private readonly mergeEngine: MergeEngine
  ) {}

  async run(
    files: readonly File[],
    complexity: QpdfBenchmarkComplexity = 'unknown',
    onProgress?: (progress: number, message: string) => void
  ): Promise<QpdfBenchmarkResult> {
    if (files.length < 2) {
      throw new Error('Select at least 2 PDF files for the qpdf benchmark.');
    }

    this.cancelRequested = false;

    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
    const inputInspection = await this.inspectInputPages(files);

    onProgress?.(3, 'Preparing qpdf WASM benchmark...');
    const inputFidelity = await this.inspectInputFidelity(files);
    const qpdf = await this.runQpdf(
      files,
      inputInspection.pageCount,
      inputBytes,
      progress =>
        onProgress?.(
          5 + Math.round(progress * 0.42),
          'Running qpdf WASM benchmark...'
        )
    );

    if (this.cancelRequested) {
      return this.createCancelledResult(
        complexity,
        files.length,
        inputBytes,
        inputInspection,
        qpdf
      );
    }

    onProgress?.(50, 'Inspecting qpdf output fidelity...');
    const qpdfFidelity = qpdf.success && qpdf.outputFile
      ? await this.inspectOutput(qpdf.outputFile)
      : null;
    qpdf.fidelity = qpdfFidelity;

    onProgress?.(60, 'Running pdf-lib Worker benchmark...');
    const pdfLibWorker = await this.runPdfLibWorker(
      files,
      inputInspection.pageCount,
      inputInspection.pageCounts,
      inputBytes,
      progress =>
        onProgress?.(
          60 + Math.round(progress * 0.25),
          'Running pdf-lib Worker benchmark...'
        )
    );

    if (this.cancelRequested) {
      return this.createCancelledResult(
        complexity,
        files.length,
        inputBytes,
        inputInspection,
        qpdf,
        pdfLibWorker
      );
    }

    onProgress?.(87, 'Inspecting pdf-lib output fidelity...');
    const pdfLibFidelity = pdfLibWorker.success && pdfLibWorker.outputFile
      ? await this.inspectOutput(pdfLibWorker.outputFile)
      : null;
    pdfLibWorker.fidelity = pdfLibFidelity;

    onProgress?.(95, 'Comparing benchmark and fidelity results...');

    const pageCountMatch = this.compareNullable(
      qpdfFidelity?.pageCount,
      pdfLibFidelity?.pageCount
    );
    const pageGeometryMatch = this.compareGeometry(
      qpdfFidelity?.pageGeometries,
      pdfLibFidelity?.pageGeometries
    );
    const annotationsMatch = this.compareNullable(
      qpdfFidelity?.annotationCount,
      pdfLibFidelity?.annotationCount
    );
    const linksMatch = this.compareNullable(
      qpdfFidelity?.linkAnnotationCount,
      pdfLibFidelity?.linkAnnotationCount
    );
    const widgetsMatch = this.compareNullable(
      qpdfFidelity?.widgetAnnotationCount,
      pdfLibFidelity?.widgetAnnotationCount
    );
    const outlinesMatch = this.compareNullable(
      qpdfFidelity?.outlineItemCount,
      pdfLibFidelity?.outlineItemCount
    );
    const fieldsMatch = this.compareNullable(
      qpdfFidelity?.fieldObjectCount,
      pdfLibFidelity?.fieldObjectCount
    );
    const firstPageRenderMatch = this.compareNullable(
      qpdfFidelity?.firstPageRenderSignature,
      pdfLibFidelity?.firstPageRenderSignature
    );
    const outputSizeMatch =
      qpdf.outputBytes !== null && pdfLibWorker.outputBytes !== null
        ? qpdf.outputBytes === pdfLibWorker.outputBytes
        : null;

    const qpdfSpeedup =
      qpdf.success && pdfLibWorker.success && qpdf.elapsedMs > 0
        ? pdfLibWorker.elapsedMs / qpdf.elapsedMs
        : null;

    const qpdfMainThreadGapReduction =
      qpdf.success &&
      pdfLibWorker.success &&
      pdfLibWorker.maxMainThreadGapMs > 0
        ? 1 - qpdf.maxMainThreadGapMs / pdfLibWorker.maxMainThreadGapMs
        : null;

    onProgress?.(100, 'qpdf benchmark complete.');

    return {
      status: 'completed',
      complexity,
      inputFidelity,
      inputFileCount: files.length,
      inputBytes,
      inputPages: inputInspection.pageCount,
      inputPageCountError: inputInspection.errorMessage,
      qpdf: this.publicRun(qpdf),
      pdfLibWorker: this.publicRun(pdfLibWorker),
      qpdfPageCountPreserved: this.compareAgainstInput(
        inputInspection.pageCount,
        qpdfFidelity?.pageCount
      ),
      pdfLibPageCountPreserved: this.compareAgainstInput(
        inputInspection.pageCount,
        pdfLibFidelity?.pageCount
      ),
      qpdfPageGeometryPreserved: this.compareGeometryAgainstInput(
        inputFidelity?.pageGeometries,
        qpdfFidelity?.pageGeometries
      ),
      pdfLibPageGeometryPreserved: this.compareGeometryAgainstInput(
        inputFidelity?.pageGeometries,
        pdfLibFidelity?.pageGeometries
      ),
      qpdfAnnotationsPreserved: this.compareNullable(
        inputFidelity?.annotationCount,
        qpdfFidelity?.annotationCount
      ),
      pdfLibAnnotationsPreserved: this.compareNullable(
        inputFidelity?.annotationCount,
        pdfLibFidelity?.annotationCount
      ),
      qpdfLinksPreserved: this.compareNullable(
        inputFidelity?.linkAnnotationCount,
        qpdfFidelity?.linkAnnotationCount
      ),
      pdfLibLinksPreserved: this.compareNullable(
        inputFidelity?.linkAnnotationCount,
        pdfLibFidelity?.linkAnnotationCount
      ),
      qpdfWidgetsPreserved: this.compareNullable(
        inputFidelity?.widgetAnnotationCount,
        qpdfFidelity?.widgetAnnotationCount
      ),
      pdfLibWidgetsPreserved: this.compareNullable(
        inputFidelity?.widgetAnnotationCount,
        pdfLibFidelity?.widgetAnnotationCount
      ),
      qpdfOutlinesPreserved: this.compareNullable(
        inputFidelity?.outlineItemCount,
        qpdfFidelity?.outlineItemCount
      ),
      pdfLibOutlinesPreserved: this.compareNullable(
        inputFidelity?.outlineItemCount,
        pdfLibFidelity?.outlineItemCount
      ),
      qpdfFieldsPreserved: this.compareNullable(
        inputFidelity?.fieldObjectCount,
        qpdfFidelity?.fieldObjectCount
      ),
      pdfLibFieldsPreserved: this.compareNullable(
        inputFidelity?.fieldObjectCount,
        pdfLibFidelity?.fieldObjectCount
      ),
      pageCountMatch,
      pageGeometryMatch,
      annotationsMatch,
      linksMatch,
      widgetsMatch,
      outlinesMatch,
      fieldsMatch,
      firstPageRenderMatch,
      outputSizeMatch,
      qpdfSpeedup,
      qpdfMainThreadGapReduction,
      errorMessage:
        qpdf.success && pdfLibWorker.success
          ? undefined
          : 'One or both engines failed. Treat this case as evidence for the benchmark review; it does not change production engine selection.'
    };
  }

  cancel(): void {
    this.cancelRequested = true;
    void this.qpdfService.cancel();
    this.mergeEngine.cancel();
  }

  private createCancelledResult(
    complexity: QpdfBenchmarkComplexity,
    inputFileCount: number,
    inputBytes: number,
    inputInspection: { pageCount: number | null; pageCounts: number[] | null; errorMessage?: string },
    qpdf: QpdfBenchmarkRun & { outputFile?: File },
    pdfLibWorker?: QpdfBenchmarkRun & { outputFile?: File }
  ): QpdfBenchmarkResult {
    const cancelledRun: QpdfBenchmarkRun = pdfLibWorker
      ? this.publicRun(pdfLibWorker)
      : {
          engine: 'pdf-lib-worker',
          success: false,
          elapsedMs: 0,
          throughputMiBPerSecond: 0,
          pagesPerSecond: null,
          maxMainThreadGapMs: 0,
          memory: {
            supported: false,
            beforeBytes: null,
            peakBytes: null,
            afterBytes: null,
            deltaBytes: null
          },
          longTasks: {
            supported: false,
            count: 0,
            maxDurationMs: null
          },
          outputBytes: null,
          outputPages: null,
          fidelity: null,
          errorMessage: 'Benchmark cancelled before pdf-lib Worker execution.'
        };

    return {
      status: 'cancelled',
      complexity,
      inputFidelity: null,
      inputFileCount,
      inputBytes,
      inputPages: inputInspection.pageCount,
      inputPageCountError: inputInspection.errorMessage,
      qpdf: this.publicRun(qpdf),
      pdfLibWorker: cancelledRun,
      qpdfPageCountPreserved: null,
      pdfLibPageCountPreserved: null,
      qpdfPageGeometryPreserved: null,
      pdfLibPageGeometryPreserved: null,
      qpdfAnnotationsPreserved: null,
      pdfLibAnnotationsPreserved: null,
      qpdfLinksPreserved: null,
      pdfLibLinksPreserved: null,
      qpdfWidgetsPreserved: null,
      pdfLibWidgetsPreserved: null,
      qpdfOutlinesPreserved: null,
      pdfLibOutlinesPreserved: null,
      qpdfFieldsPreserved: null,
      pdfLibFieldsPreserved: null,
      pageCountMatch: null,
      pageGeometryMatch: null,
      annotationsMatch: null,
      linksMatch: null,
      widgetsMatch: null,
      outlinesMatch: null,
      fieldsMatch: null,
      firstPageRenderMatch: null,
      outputSizeMatch: null,
      qpdfSpeedup: null,
      qpdfMainThreadGapReduction: null,
      errorMessage: 'Benchmark cancelled. No engine or capacity decision was made.'
    };
  }

  private async runQpdf(
    files: readonly File[],
    inputPages: number | null,
    inputBytes: number,
    onProgress: (progress: number) => void
  ): Promise<QpdfBenchmarkRun & { outputFile?: File }> {
    return this.measureRun(
      'qpdf-wasm',
      inputBytes,
      inputPages,
      async () => this.qpdfService.merge(files, onProgress)
    );
  }

  private async runPdfLibWorker(
    files: readonly File[],
    inputPages: number | null,
    inputPageCounts: readonly number[] | null,
    inputBytes: number,
    onProgress: (progress: number) => void
  ): Promise<QpdfBenchmarkRun & { outputFile?: File }> {
    return this.measureRun(
      'pdf-lib-worker',
      inputBytes,
      inputPages,
      async () =>
        this.mergeEngine.merge(
          [...files],
          onProgress,
          inputPageCounts ?? [],
          { executionMode: 'worker' }
        )
    );
  }

  private async measureRun(
    engine: 'qpdf-wasm' | 'pdf-lib-worker',
    inputBytes: number,
    inputPages: number | null,
    operation: () => Promise<File>
  ): Promise<QpdfBenchmarkRun & { outputFile?: File }> {
    let heartbeatLast = performance.now();
    let maxMainThreadGapMs = 0;
    let heartbeatTimer: number | null = null;

    const memoryBefore = this.readMemorySnapshot();
    let memoryPeak = memoryBefore.usedJSHeapSize;
    let memoryTimer: number | null = null;

    let longTaskCount = 0;
    let maxLongTaskDurationMs: number | null = null;
    let longTaskObserver: PerformanceObserver | null = null;

    if (typeof window !== 'undefined') {
      heartbeatTimer = window.setInterval(() => {
        const now = performance.now();
        maxMainThreadGapMs = Math.max(
          maxMainThreadGapMs,
          now - heartbeatLast
        );
        heartbeatLast = now;
      }, 25);

      if (memoryBefore.usedJSHeapSize !== null) {
        memoryTimer = window.setInterval(() => {
          const snapshot = this.readMemorySnapshot();
          if (snapshot.usedJSHeapSize !== null) {
            memoryPeak = memoryPeak === null
              ? snapshot.usedJSHeapSize
              : Math.max(memoryPeak, snapshot.usedJSHeapSize);
          }
        }, 100);
      }

      if (
        typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes.includes('longtask')
      ) {
        try {
          longTaskObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              longTaskCount += 1;
              maxLongTaskDurationMs = maxLongTaskDurationMs === null
                ? entry.duration
                : Math.max(maxLongTaskDurationMs, entry.duration);
            }
          });
          longTaskObserver.observe({ type: 'longtask', buffered: false });
        } catch {
          longTaskObserver = null;
        }
      }
    }

    const started = performance.now();

    try {
      const outputFile = await operation();
      const elapsedMs = performance.now() - started;
      const outputBytes = outputFile.size;
      const outputPages = await this.readOutputPageCount(outputFile);
      const memoryAfter = this.readMemorySnapshot();

      return {
        engine,
        success: true,
        elapsedMs,
        throughputMiBPerSecond:
          elapsedMs > 0
            ? inputBytes / (1024 * 1024) / (elapsedMs / 1000)
            : 0,
        pagesPerSecond:
          inputPages !== null && elapsedMs > 0
            ? inputPages / (elapsedMs / 1000)
            : null,
        maxMainThreadGapMs,
        memory: this.createMemoryTelemetry(memoryBefore, memoryAfter, memoryPeak),
        longTasks: {
          supported: longTaskObserver !== null,
          count: longTaskCount,
          maxDurationMs: maxLongTaskDurationMs
        },
        outputBytes,
        outputPages,
        fidelity: null,
        outputFile
      };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      const memoryAfter = this.readMemorySnapshot();

      return {
        engine,
        success: false,
        elapsedMs,
        throughputMiBPerSecond: 0,
        pagesPerSecond: null,
        maxMainThreadGapMs,
        memory: this.createMemoryTelemetry(memoryBefore, memoryAfter, memoryPeak),
        longTasks: {
          supported: longTaskObserver !== null,
          count: longTaskCount,
          maxDurationMs: maxLongTaskDurationMs
        },
        outputBytes: null,
        outputPages: null,
        fidelity: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown benchmark failure.'
      };
    } finally {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      if (memoryTimer !== null) {
        window.clearInterval(memoryTimer);
      }
      longTaskObserver?.disconnect();
    }
  }

  private readMemorySnapshot(): {
    usedJSHeapSize: number | null;
    totalJSHeapSize: number | null;
    jsHeapSizeLimit: number | null;
  } {
    if (typeof performance === 'undefined') {
      return {
        usedJSHeapSize: null,
        totalJSHeapSize: null,
        jsHeapSizeLimit: null
      };
    }

    const performanceWithMemory = performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    const memory = performanceWithMemory.memory;

    if (!memory || !Number.isFinite(memory.usedJSHeapSize)) {
      return {
        usedJSHeapSize: null,
        totalJSHeapSize: null,
        jsHeapSizeLimit: null
      };
    }

    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: Number.isFinite(memory.totalJSHeapSize)
        ? memory.totalJSHeapSize
        : null,
      jsHeapSizeLimit: Number.isFinite(memory.jsHeapSizeLimit)
        ? memory.jsHeapSizeLimit
        : null
    };
  }

  private createMemoryTelemetry(
    before: { usedJSHeapSize: number | null },
    after: { usedJSHeapSize: number | null },
    peak: number | null
  ): QpdfBenchmarkMemoryTelemetry {
    const supported = before.usedJSHeapSize !== null || after.usedJSHeapSize !== null;
    const deltaBytes =
      before.usedJSHeapSize !== null && after.usedJSHeapSize !== null
        ? after.usedJSHeapSize - before.usedJSHeapSize
        : null;

    return {
      supported,
      beforeBytes: before.usedJSHeapSize,
      peakBytes: peak,
      afterBytes: after.usedJSHeapSize,
      deltaBytes
    };
  }

  private async inspectInputPages(
    files: readonly File[]
  ): Promise<{ pageCount: number | null; pageCounts: number[] | null; errorMessage?: string }> {
    try {
      const counts = await this.readIndividualPageCounts(files);
      return {
        pageCount: counts.reduce((sum, pages) => sum + pages, 0),
        pageCounts: counts
      };
    } catch (error) {
      return {
        pageCount: null,
        pageCounts: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Input PDF page count could not be read.'
      };
    }
  }

  private async inspectInputFidelity(
    files: readonly File[]
  ): Promise<QpdfFidelityInspection | null> {
    try {
      const inspections = await Promise.all(
        files.map(async file => {
          const bytes = await file.arrayBuffer();
          return this.inspectOutput(new File([bytes], file.name, { type: 'application/pdf' }));
        })
      );

      const successful = inspections.filter(
        (inspection): inspection is QpdfFidelityInspection => inspection.parseable
      );

      if (successful.length !== inspections.length || successful.length === 0) {
        return null;
      }

      const pageGeometries = successful.flatMap(inspection => inspection.pageGeometries);

      return {
        parseable: true,
        pageCount: successful.reduce(
          (sum, inspection) => sum + (inspection.pageCount ?? 0),
          0
        ),
        pageGeometries,
        annotationCount: successful.reduce(
          (sum, inspection) => sum + (inspection.annotationCount ?? 0),
          0
        ),
        linkAnnotationCount: successful.reduce(
          (sum, inspection) => sum + (inspection.linkAnnotationCount ?? 0),
          0
        ),
        widgetAnnotationCount: successful.reduce(
          (sum, inspection) => sum + (inspection.widgetAnnotationCount ?? 0),
          0
        ),
        outlineItemCount: successful.reduce(
          (sum, inspection) => sum + (inspection.outlineItemCount ?? 0),
          0
        ),
        fieldObjectCount: successful.reduce(
          (sum, inspection) => sum + (inspection.fieldObjectCount ?? 0),
          0
        ),
        firstPageRenderSignature: successful[0].firstPageRenderSignature
      };
    } catch {
      return null;
    }
  }

  private async readIndividualPageCounts(
    files: readonly File[]
  ): Promise<number[]> {
    const counts: number[] = [];

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const document = await PDFDocument.load(bytes, {
        updateMetadata: false
      });
      counts.push(document.getPageCount());
    }

    return counts;
  }

  private async readOutputPageCount(file: File): Promise<number> {
    const bytes = await file.arrayBuffer();
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false
    });
    return document.getPageCount();
  }

  private async inspectOutput(
    file: File
  ): Promise<QpdfFidelityInspection> {
    try {
      const bytes = await file.arrayBuffer();
      const document = await PDFDocument.load(bytes, {
        updateMetadata: false
      });
      const pageGeometries = document.getPages().map(page => {
        const size = page.getSize();
        return {
          width: this.roundGeometry(size.width),
          height: this.roundGeometry(size.height)
        } satisfies QpdfBenchmarkPageGeometry;
      });

      const pdfJsSummary = await this.inspectWithPdfJs(bytes);

      return {
        parseable: true,
        pageCount: document.getPageCount(),
        pageGeometries,
        annotationCount: pdfJsSummary.annotationCount,
        linkAnnotationCount: pdfJsSummary.linkAnnotationCount,
        widgetAnnotationCount: pdfJsSummary.widgetAnnotationCount,
        outlineItemCount: pdfJsSummary.outlineItemCount,
        fieldObjectCount: pdfJsSummary.fieldObjectCount,
        firstPageRenderSignature: pdfJsSummary.firstPageRenderSignature
      };
    } catch (error) {
      return {
        parseable: false,
        pageCount: null,
        pageGeometries: [],
        annotationCount: null,
        linkAnnotationCount: null,
        widgetAnnotationCount: null,
        outlineItemCount: null,
        fieldObjectCount: null,
        firstPageRenderSignature: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Output fidelity inspection failed.'
      };
    }
  }

  private async inspectWithPdfJs(
    bytes: ArrayBuffer
  ): Promise<PdfJsAnnotationSummary> {
    const pdfjs = await import('pdfjs-dist');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes)
    });
    const document = await loadingTask.promise;

    try {
      let annotationCount = 0;
      let linkAnnotationCount = 0;
      let widgetAnnotationCount = 0;

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const annotations = await page.getAnnotations({ intent: 'display' });

        annotationCount += annotations.length;
        linkAnnotationCount += annotations.filter(
          annotation => annotation.subtype === 'Link'
        ).length;
        widgetAnnotationCount += annotations.filter(
          annotation => annotation.subtype === 'Widget'
        ).length;
      }

      const outline = await document.getOutline();
      const outlineItemCount = this.countOutlineItems(outline);

      let fieldObjectCount = 0;
      const documentWithFields = document as PDFDocumentProxy & {
        getFieldObjects?: () => Promise<Record<string, unknown[]> | null>;
      };
      const fieldObjects = await documentWithFields.getFieldObjects?.();
      if (fieldObjects) {
        const fieldArrays: unknown[][] = Object.values(fieldObjects);
        fieldObjectCount = fieldArrays.reduce(
          (count, fields) => count + fields.length,
          0
        );
      }

      const firstPageRenderSignature =
        document.numPages > 0
          ? await this.renderFirstPageSignature(document)
          : null;

      return {
        annotationCount,
        linkAnnotationCount,
        widgetAnnotationCount,
        outlineItemCount,
        fieldObjectCount,
        firstPageRenderSignature
      };
    } finally {
      await document.destroy();
    }
  }

  private countOutlineItems(
    items: Array<{ items?: Array<unknown> }> | null
  ): number {
    if (!items) return 0;

    return items.reduce((count, item) => {
      const children = Array.isArray(item.items) ? item.items : [];
      return count + 1 + this.countOutlineItems(
        children as Array<{ items?: Array<unknown> }>
      );
    }, 0);
  }

  private async renderFirstPageSignature(
    document: PDFDocumentProxy
  ): Promise<string | null> {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = globalThis.document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) return null;

    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;

    let hash = 2166136261;
    const stride = Math.max(4, Math.floor(pixels.length / 4096));

    for (let index = 0; index < pixels.length; index += stride) {
      hash ^= pixels[index];
      hash = Math.imul(hash, 16777619);
    }

    return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
  }

  private compareAgainstInput(
    inputValue: number | null,
    outputValue: number | null | undefined
  ): boolean | null {
    if (inputValue === null || outputValue === null || outputValue === undefined) {
      return null;
    }
    return inputValue === outputValue;
  }

  private compareGeometryAgainstInput(
    input: readonly QpdfBenchmarkPageGeometry[] | null | undefined,
    output: readonly QpdfBenchmarkPageGeometry[] | null | undefined
  ): boolean | null {
    if (!input || !output) return null;
    return this.compareGeometry(input, output);
  }

  private compareNullable<T>(
    left: T | null | undefined,
    right: T | null | undefined
  ): boolean | null {
    if (left === null || left === undefined || right === null || right === undefined) {
      return null;
    }

    return left === right;
  }

  private compareGeometry(
    left: readonly QpdfBenchmarkPageGeometry[] | null | undefined,
    right: readonly QpdfBenchmarkPageGeometry[] | null | undefined
  ): boolean | null {
    if (!left || !right) return null;
    if (left.length !== right.length) return false;

    return left.every((geometry, index) => {
      const other = right[index];
      return geometry.width === other.width && geometry.height === other.height;
    });
  }

  private publicRun(
    run: QpdfBenchmarkRun & { outputFile?: File }
  ): QpdfBenchmarkRun {
    const { outputFile: _outputFile, ...publicRun } = run;
    return publicRun;
  }

  private roundGeometry(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}

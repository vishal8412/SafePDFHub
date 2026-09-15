import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import { MergeEngine, MergeCancelledError } from '../engines/merge.engine';
import { QpdfWasmPrototypeService, QpdfPrototypeCancelledError } from './qpdf-wasm-prototype.service';
import type { QpdfControlledFallbackPilotOptions, QpdfControlledFallbackPilotResult } from './qpdf-controlled-fallback-pilot.types';

interface PageGeometry {
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class QpdfControlledFallbackPilotService {
  private cancelled = false;

  constructor(
    private readonly qpdfService: QpdfWasmPrototypeService,
    private readonly mergeEngine: MergeEngine,
    private readonly capabilityService: LocalProcessingCapabilityService
  ) {}

  async run(
    files: readonly File[],
    options: QpdfControlledFallbackPilotOptions
  ): Promise<QpdfControlledFallbackPilotResult> {
    if (!options.enabled) {
      throw new Error('The controlled qpdf fallback pilot is disabled. Explicitly enable it for an internal test only.');
    }

    if (files.length < 2) {
      throw new Error('The controlled qpdf fallback pilot requires at least 2 PDFs.');
    }

    this.cancelled = false;
    const started = performance.now();
    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);

    const inputPageGeometries: PageGeometry[] = [];
    let inputPageCount = 0;
    await this.validateInputs(files, inputPageGeometries, pageCount => {
      inputPageCount = pageCount;
    });

    this.report(options, 5, 'Pilot enabled for this internal run. Validating qpdf path...');
    this.throwIfCancelled();

    let qpdfFailureReason: string | undefined;
    let qpdfOutput: File | null = null;

    try {
      qpdfOutput = await this.qpdfService.merge(
        files,
        progress => this.report(options, 5 + Math.round(progress * 0.65), 'Running qpdf WASM pilot path...')
      );

      this.throwIfCancelled();

      const validation = await this.validateOutput(qpdfOutput);
      if (!validation.parseable) {
        qpdfFailureReason = validation.errorMessage ?? 'qpdf output could not be parsed.';
      } else if (validation.pageCount !== inputPageCount) {
        qpdfFailureReason = `qpdf output page count ${validation.pageCount} does not match input page count ${inputPageCount}.`;
      } else if (!this.geometriesEqual(inputPageGeometries, validation.pageGeometries)) {
        qpdfFailureReason = 'qpdf output page geometry does not match the ordered input page geometry.';
      } else {
        this.report(options, 75, 'qpdf pilot output passed the hard fidelity gate.');
        return {
          outcome: 'qpdf-success',
          qpdfAttempted: true,
          qpdfSucceeded: true,
          fallbackUsed: false,
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          outputBytes: qpdfOutput.size,
          outputPageCount: validation.pageCount,
          hardFidelityPassed: true,
          elapsedMs: performance.now() - started
        };
      }
    } catch (error) {
      if (this.isCancellation(error)) {
        return {
          outcome: 'cancelled',
          qpdfAttempted: true,
          qpdfSucceeded: false,
          fallbackUsed: false,
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          outputBytes: null,
          outputPageCount: null,
          hardFidelityPassed: null,
          qpdfFailureReason: 'qpdf pilot was cancelled.',
          elapsedMs: performance.now() - started
        };
      }
      qpdfFailureReason = error instanceof Error ? error.message : 'qpdf pilot failed.';
    }

    if (options.usePdfLibWorkerFallback === false) {
      this.report(options, 100, 'qpdf pilot failed and Worker fallback is disabled for this test.');
      return {
        outcome: 'failed',
        qpdfAttempted: true,
        qpdfSucceeded: false,
        fallbackUsed: false,
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        outputBytes: null,
        outputPageCount: null,
        hardFidelityPassed: false,
        qpdfFailureReason,
        elapsedMs: performance.now() - started
      };
    }

    this.report(options, 78, `qpdf pilot did not pass: ${qpdfFailureReason ?? 'unknown failure'}`);
    this.report(options, 82, 'Falling back to the existing pdf-lib Worker engine...');
    this.throwIfCancelled();

    try {
      const fallback = await this.mergeEngine.merge(
        [...files],
        progress => this.report(options, 82 + Math.round(progress * 0.17), 'pdf-lib Worker fallback in progress...'),
        await this.readPageCounts(files),
        { executionMode: 'worker' }
      );

      this.throwIfCancelled();
      const validation = await this.validateOutput(fallback);
      const fidelityPassed = validation.parseable &&
        validation.pageCount === inputPageCount &&
        this.geometriesEqual(inputPageGeometries, validation.pageGeometries);

      if (!fidelityPassed) {
        const fallbackFailureReason = validation.errorMessage ??
          `pdf-lib Worker fallback did not pass the hard fidelity gate (page count: ${validation.pageCount ?? 'unavailable'}).`;
        return {
          outcome: 'failed',
          qpdfAttempted: true,
          qpdfSucceeded: false,
          fallbackUsed: true,
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          outputBytes: fallback.size,
          outputPageCount: validation.pageCount,
          hardFidelityPassed: false,
          qpdfFailureReason,
          fallbackFailureReason,
          elapsedMs: performance.now() - started
        };
      }

      this.report(options, 100, 'qpdf pilot failed safely; pdf-lib Worker fallback completed.');
      return {
        outcome: 'pdf-lib-fallback',
        qpdfAttempted: true,
        qpdfSucceeded: false,
        fallbackUsed: true,
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        outputBytes: fallback.size,
        outputPageCount: validation.pageCount,
        hardFidelityPassed: true,
        qpdfFailureReason,
        elapsedMs: performance.now() - started
      };
    } catch (error) {
      if (this.isCancellation(error)) {
        return {
          outcome: 'cancelled',
          qpdfAttempted: true,
          qpdfSucceeded: false,
          fallbackUsed: true,
          inputFileCount: files.length,
          inputBytes,
          inputPageCount,
          outputBytes: null,
          outputPageCount: null,
          hardFidelityPassed: null,
          qpdfFailureReason,
          fallbackFailureReason: 'pdf-lib Worker fallback was cancelled.',
          elapsedMs: performance.now() - started
        };
      }

      return {
        outcome: 'failed',
        qpdfAttempted: true,
        qpdfSucceeded: false,
        fallbackUsed: true,
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        outputBytes: null,
        outputPageCount: null,
        hardFidelityPassed: false,
        qpdfFailureReason,
        fallbackFailureReason: error instanceof Error ? error.message : 'pdf-lib Worker fallback failed.',
        elapsedMs: performance.now() - started
      };
    }
  }

  cancel(): void {
    this.cancelled = true;
    void this.qpdfService.cancel();
    this.mergeEngine.cancel();
  }

  private async validateInputs(
    files: readonly File[],
    geometries: PageGeometry[],
    onPageCount: (count: number) => void
  ): Promise<void> {
    const budget = this.capabilityService.budget;
    if (files.length > budget.maxFiles) {
      throw new Error(`Pilot input exceeds the local limit of ${budget.maxFiles} files.`);
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const largestFile = files.reduce((max, file) => Math.max(max, file.size), 0);
    if (largestFile > budget.maxFileBytes) {
      throw new Error(`A pilot input exceeds the local file limit of ${this.formatBytes(budget.maxFileBytes)}.`);
    }
    if (totalBytes > budget.maxTotalBytes) {
      throw new Error(`Pilot inputs exceed the local total-size limit of ${this.formatBytes(budget.maxTotalBytes)}.`);
    }

    const pageCounts = await Promise.all(files.map(async file => {
      const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      const count = document.getPageCount();
      if (count > budget.maxPages) {
        throw new Error(`${file.name} exceeds the local page limit of ${budget.maxPages.toLocaleString()}.`);
      }
      for (const page of document.getPages()) {
        const size = page.getSize();
        geometries.push({ width: this.round(size.width), height: this.round(size.height) });
      }
      return count;
    }));

    const totalPages = pageCounts.reduce((sum, count) => sum + count, 0);
    if (totalPages > budget.maxPages) {
      throw new Error(`Pilot inputs contain more than the local limit of ${budget.maxPages.toLocaleString()} pages.`);
    }
    onPageCount(totalPages);
  }

  private async readPageCounts(files: readonly File[]): Promise<number[]> {
    return Promise.all(files.map(async file => {
      const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      return document.getPageCount();
    }));
  }

  private async validateOutput(file: File): Promise<{
    parseable: boolean;
    pageCount: number | null;
    pageGeometries: PageGeometry[];
    errorMessage?: string;
  }> {
    try {
      const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      return {
        parseable: true,
        pageCount: document.getPageCount(),
        pageGeometries: document.getPages().map(page => {
          const size = page.getSize();
          return { width: this.round(size.width), height: this.round(size.height) };
        })
      };
    } catch (error) {
      return {
        parseable: false,
        pageCount: null,
        pageGeometries: [],
        errorMessage: error instanceof Error ? error.message : 'PDF output could not be parsed.'
      };
    }
  }

  private geometriesEqual(left: readonly PageGeometry[], right: readonly PageGeometry[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((geometry, index) => {
      const other = right[index];
      return geometry.width === other.width && geometry.height === other.height;
    });
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private report(options: QpdfControlledFallbackPilotOptions, progress: number, message: string): void {
    options.onProgress?.(Math.max(0, Math.min(100, progress)), message);
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new QpdfPrototypeCancelledError();
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof QpdfPrototypeCancelledError || error instanceof MergeCancelledError || this.cancelled;
  }

  private formatBytes(bytes: number): string {
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
    return `${Math.round(bytes / MB)} MB`;
  }
}

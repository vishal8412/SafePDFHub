import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { LocalProcessingCapabilityService } from '../capacity/local-processing-capability.service';
import type { ProcessingBudget } from '../capacity/local-processing-capability.model';
import {
  MergeWorkerBudget,
  MergeWorkerInputFile,
  MergeWorkerMainMessage,
  MergeWorkerMessage,
  MergeWorkerStage
} from '../workers/merge-worker.types';

export interface MergeOptions {
  onStage?: (stage: MergeWorkerStage, message: string) => void;
  /** Benchmark-only execution override. Production callers should use the default 'auto'. */
  executionMode?: 'auto' | 'worker' | 'main';
}

@Injectable({
  providedIn: 'root'
})
export class MergeEngine {
  private worker: Worker | null = null;
  private activeReject: ((reason?: unknown) => void) | null = null;
  private activeSettled = false;

  constructor(
    private readonly capabilityService: LocalProcessingCapabilityService
  ) {}

  async merge(
    files: File[],
    onProgress?: (p: number) => void,
    knownPageCounts: readonly number[] = [],
    options: MergeOptions = {}
  ): Promise<File> {
    const budget = this.capabilityService.budget;
    this.validateRequest(files, budget);

    if (options.executionMode === 'main' || (options.executionMode !== 'worker' && typeof Worker === 'undefined')) {
      return this.mergeOnMainThread(files, onProgress, knownPageCounts, options);
    }

    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not available in this browser.');
    }

    return this.mergeInWorker(files, budget, onProgress, knownPageCounts, options);
  }

  /**
   * Requests cancellation of the active worker operation. If pdf-lib is in a
   * synchronous section and cannot observe CANCEL yet, the worker is
   * terminated as a hard fallback so the UI is not left waiting indefinitely.
   */
  cancel(): void {
    const worker = this.worker;
    if (!worker || !this.activeReject || this.activeSettled) return;

    try {
      worker.postMessage({ type: 'CANCEL' } satisfies MergeWorkerMainMessage);
    } catch {
      // The worker may already be closing. Termination below is the fallback.
    }

    const reject = this.activeReject;
    setTimeout(() => {
      if (this.activeReject !== reject || this.activeSettled) return;
      this.terminateWorker();
      this.activeSettled = true;
      this.activeReject = null;
      reject(new MergeCancelledError());
    }, 100);
  }

  private validateRequest(
    files: File[],
    budget: ProcessingBudget
  ): void {
    if (files.length < 2) {
      throw new Error('Please add at least 2 PDFs to merge.');
    }
    if (files.length > budget.maxFiles) {
      throw new Error(`Too many PDFs for reliable local processing. Maximum ${budget.maxFiles} files.`);
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const largestFile = files.reduce((max, file) => Math.max(max, file.size), 0);

    if (largestFile > budget.maxFileBytes) {
      throw new Error(`A selected PDF exceeds the ${this.formatBytes(budget.maxFileBytes)} local file limit.`);
    }
    if (totalBytes > budget.maxTotalBytes) {
      throw new Error(`The selected PDFs exceed the ${this.formatBytes(budget.maxTotalBytes)} local processing limit.`);
    }
  }

  private async mergeInWorker(
    files: File[],
    budget: LocalProcessingCapabilityService['budget'],
    onProgress: ((p: number) => void) | undefined,
    knownPageCounts: readonly number[],
    options: MergeOptions
  ): Promise<File> {
    this.terminateWorker();
    const worker = new Worker(new URL('../workers/merge.worker', import.meta.url));
    this.worker = worker;
    this.activeSettled = false;

    const totalKnownPages = knownPageCounts.length === files.length && knownPageCounts.every(p => p > 0)
      ? knownPageCounts.reduce((sum, pages) => sum + pages, 0)
      : 0;

    const inputFiles: MergeWorkerInputFile[] = [];
    const transferables: Transferable[] = [];

    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        inputFiles.push({
          name: file.name,
          type: file.type || 'application/pdf',
          buffer
        });
        transferables.push(buffer);
      }
    } catch (error) {
      this.terminateWorker();
      throw error;
    }

    const workerBudget: MergeWorkerBudget = {
      maxFileBytes: budget.maxFileBytes,
      maxTotalBytes: budget.maxTotalBytes,
      maxFiles: budget.maxFiles,
      maxPages: budget.maxPages
    };

    return new Promise<File>((resolve, reject) => {
      this.activeReject = reject;

      const settle = (callback: () => void): void => {
        if (this.activeSettled) return;
        this.activeSettled = true;
        this.activeReject = null;
        callback();
      };

      worker.onmessage = (event: MessageEvent<MergeWorkerMessage>) => {
        const message = event.data;
        switch (message.type) {
          case 'PROGRESS':
            onProgress?.(Math.max(0, Math.min(100, message.progress)));
            break;
          case 'STAGE':
            options.onStage?.(message.stage, message.message);
            break;
          case 'COMPLETE': {
            settle(() => {
              this.worker = null;
              worker.terminate();
              onProgress?.(100);
              resolve(new File([message.buffer], message.name, { type: message.typeHint }));
            });
            break;
          }
          case 'CANCELLED':
            settle(() => {
              this.worker = null;
              worker.terminate();
              reject(new MergeCancelledError());
            });
            break;
          case 'ERROR':
            settle(() => {
              this.worker = null;
              worker.terminate();
              reject(new Error(message.message));
            });
            break;
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        settle(() => {
          this.worker = null;
          worker.terminate();
          reject(new Error(event.message || 'Merge worker failed. Please try again with a smaller workload.'));
        });
      };

      worker.onmessageerror = () => {
        settle(() => {
          this.worker = null;
          worker.terminate();
          reject(new Error('Merge worker communication failed. Please try again with a smaller workload.'));
        });
      };

      const startMessage: MergeWorkerMainMessage = {
        type: 'START',
        files: inputFiles,
        budget: workerBudget,
        totalKnownPages
      };

      try {
        worker.postMessage(startMessage, transferables);
      } catch (error) {
        settle(() => {
          this.worker = null;
          worker.terminate();
          reject(error);
        });
      }
    });
  }

  private async mergeOnMainThread(
    files: File[],
    onProgress?: (p: number) => void,
    knownPageCounts: readonly number[] = [],
    options: MergeOptions = {}
  ): Promise<File> {
    const budget = this.capabilityService.budget;
    const merged = await PDFDocument.create();
    let processedFiles = 0;
    let processedPages = 0;
    let knownPages = 0;
    const totalKnownPages = knownPageCounts.length === files.length && knownPageCounts.every(p => p > 0)
      ? knownPageCounts.reduce((sum, pages) => sum + pages, 0)
      : 0;

    for (const file of files) {
      options.onStage?.('reading', `Reading ${file.name}`);
      onProgress?.(Math.min(8, Math.round((processedFiles / files.length) * 8)));
      const buffer = await file.arrayBuffer();

      options.onStage?.('parsing', `Parsing ${file.name}`);
      onProgress?.(8 + Math.round((processedFiles / files.length) * 12));
      const src = await PDFDocument.load(new Uint8Array(buffer), { updateMetadata: false });
      const pageIndices = src.getPageIndices();
      const filePages = pageIndices.length;
      knownPages += filePages;

      if (filePages > budget.maxPages) {
        throw new Error(`${file.name} contains ${filePages.toLocaleString()} pages, which exceeds the ${budget.maxPages.toLocaleString()} page local limit.`);
      }
      if (knownPages > budget.maxPages) {
        throw new Error(`The selected PDFs contain more than ${budget.maxPages.toLocaleString()} pages and are too large for reliable local processing.`);
      }

      options.onStage?.('copying', `Copying pages from ${file.name}`);
      const chunkSize = 25;
      for (let i = 0; i < pageIndices.length; i += chunkSize) {
        const chunk = pageIndices.slice(i, i + chunkSize);
        const pages = await merged.copyPages(src, chunk);
        pages.forEach(page => merged.addPage(page));
        processedPages += pages.length;
        const denominator = totalKnownPages || knownPages || processedPages;
        onProgress?.(Math.min(79, 20 + Math.round((processedPages / Math.max(denominator, 1)) * 60)));
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      processedFiles += 1;
      if (processedPages === 0) onProgress?.(Math.round((processedFiles / files.length) * 100));
      // @ts-ignore pdf-lib exposes context internally but not in its public API.
      src.context = null;
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    options.onStage?.('serializing', 'Serializing merged PDF');
    onProgress?.(80);
    const bytes = await merged.save();
    onProgress?.(98);
    options.onStage?.('finalizing', 'Finalizing merged PDF');
    await new Promise(resolve => setTimeout(resolve, 0));
    onProgress?.(100);

    return new File([new Uint8Array(bytes)], 'merged.pdf', { type: 'application/pdf' });
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private formatBytes(bytes: number): string {
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
    return `${Math.round(bytes / MB)} MB`;
  }
}

export class MergeCancelledError extends Error {
  constructor() {
    super('Merge cancelled.');
    this.name = 'MergeCancelledError';
  }
}

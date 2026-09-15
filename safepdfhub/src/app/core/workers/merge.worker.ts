import { PDFDocument } from 'pdf-lib';
import {
  MergeWorkerBudget,
  MergeWorkerInputFile,
  MergeWorkerMainMessage,
  MergeWorkerMessage,
  MergeWorkerStage
} from './merge-worker.types';

let cancelled = false;
let running = false;

const post = (message: MergeWorkerMessage, transfer: Transferable[] = []): void => {
  self.postMessage(message, transfer);
};

const yieldToWorker = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const checkCancelled = (): void => {
  if (cancelled) {
    throw new MergeCancelledError();
  }
};

const stage = (name: MergeWorkerStage, message: string, progress: number): void => {
  post({ type: 'STAGE', stage: name, message });
  post({ type: 'PROGRESS', progress });
};

const capacityError = (message: string): MergeWorkerFailure =>
  new MergeWorkerFailure(message, 'CAPACITY');

interface ErrorWithCode {
  message: string;
  code: 'CAPACITY' | 'INVALID_PDF' | 'WORKER' | 'UNKNOWN';
}

class MergeCancelledError extends Error {
  constructor() {
    super('Merge cancelled.');
    this.name = 'MergeCancelledError';
  }
}

class MergeWorkerFailure extends Error {
  constructor(message: string, public readonly code: ErrorWithCode['code']) {
    super(message);
    this.name = 'MergeWorkerFailure';
  }
}

const formatBytes = (bytes: number): string => {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
};

const normalizeError = (error: unknown): ErrorWithCode => {
  if (error instanceof MergeCancelledError) {
    throw error;
  }
  if (error instanceof MergeWorkerFailure) {
    return { message: error.message, code: error.code };
  }

  const message = error instanceof Error && error.message
    ? error.message
    : 'Merge failed. Please try again with a smaller workload.';

  const lower = message.toLowerCase();
  if (lower.includes('encrypted') || lower.includes('password')) {
    return { message: 'This PDF is encrypted or password-protected and could not be merged locally.', code: 'INVALID_PDF' };
  }
  if (lower.includes('invalid pdf') || lower.includes('failed to parse') || lower.includes('missing pdf')) {
    return { message: 'One of the selected files is not a valid PDF or could not be parsed locally.', code: 'INVALID_PDF' };
  }

  return { message, code: 'UNKNOWN' };
};

const merge = async (
  files: MergeWorkerInputFile[],
  budget: MergeWorkerBudget,
  totalKnownPages: number
): Promise<void> => {
  if (files.length < 2) {
    throw new Error('Please add at least 2 PDFs to merge.');
  }
  if (files.length > budget.maxFiles) {
    throw capacityError(`Too many PDFs for reliable local processing. Maximum ${budget.maxFiles} files.`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
  const largestFile = files.reduce((max, file) => Math.max(max, file.buffer.byteLength), 0);

  if (largestFile > budget.maxFileBytes) {
    throw capacityError(`A selected PDF exceeds the ${formatBytes(budget.maxFileBytes)} local file limit.`);
  }
  if (totalBytes > budget.maxTotalBytes) {
    throw capacityError(`The selected PDFs exceed the ${formatBytes(budget.maxTotalBytes)} local processing limit.`);
  }

  const merged = await PDFDocument.create();
  let processedPages = 0;
  let discoveredPages = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    checkCancelled();
    const file = files[fileIndex];

    stage('reading', `Reading ${file.name}`, Math.min(8, Math.round((fileIndex / files.length) * 8)));
    await yieldToWorker();
    checkCancelled();

    stage('parsing', `Parsing ${file.name}`, 8 + Math.round((fileIndex / files.length) * 12));
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(new Uint8Array(file.buffer), {
        updateMetadata: false
      });
    } catch (error) {
      const normalized = normalizeError(error);
      throw new MergeWorkerFailure(normalized.message, normalized.code);
    }

    checkCancelled();
    const pageIndices = source.getPageIndices();
    const filePages = pageIndices.length;
    discoveredPages += filePages;

    if (filePages > budget.maxPages) {
      throw capacityError(`${file.name} contains ${filePages.toLocaleString()} pages, which exceeds the ${budget.maxPages.toLocaleString()} page local limit.`);
    }
    if (discoveredPages > budget.maxPages) {
      throw capacityError(`The selected PDFs contain more than ${budget.maxPages.toLocaleString()} pages and are too large for reliable local processing.`);
    }

    // Keep batches small enough to yield between copy operations. This is a
    // scheduling/progress boundary, not a streaming-memory optimization.
    const chunkSize = 25;
    for (let offset = 0; offset < pageIndices.length; offset += chunkSize) {
      checkCancelled();
      const chunk = pageIndices.slice(offset, offset + chunkSize);

      const copyBase = totalKnownPages > 0
        ? 20 + Math.round((processedPages / Math.max(totalKnownPages, 1)) * 60)
        : 20 + Math.round((fileIndex / files.length) * 20);
      stage('copying', `Copying pages from ${file.name}`, Math.min(79, copyBase));
      const pages = await merged.copyPages(source, chunk);
      pages.forEach(page => merged.addPage(page));
      processedPages += pages.length;

      const denominator = totalKnownPages > 0 ? totalKnownPages : Math.max(discoveredPages, processedPages);
      const copyProgress = Math.min(79, 20 + Math.round((processedPages / Math.max(denominator, 1)) * 60));
      post({ type: 'PROGRESS', progress: copyProgress });
      await yieldToWorker();
    }

    // Release the source graph as early as pdf-lib permits. This is an
    // internal pdf-lib property and intentionally stays isolated to the worker.
    // @ts-ignore pdf-lib does not expose context in its public API.
    source.context = null;
    await yieldToWorker();
  }

  checkCancelled();
  stage('serializing', 'Serializing merged PDF', 80);
  await yieldToWorker();
  checkCancelled();

  const bytes = await merged.save();
  checkCancelled();

  // The exact serialization percentage is not measurable from pdf-lib. We
  // therefore report a stage boundary rather than inventing byte-level progress.
  post({ type: 'PROGRESS', progress: 98 });
  stage('finalizing', 'Finalizing merged PDF', 99);
  await yieldToWorker();
  checkCancelled();

  const output = new Uint8Array(bytes);
  const buffer = output.buffer as ArrayBuffer;
  post({
    type: 'COMPLETE',
    name: 'merged.pdf',
    typeHint: 'application/pdf',
    buffer
  }, [buffer]);
};

self.onmessage = (event: MessageEvent<MergeWorkerMainMessage>): void => {
  const message = event.data;

  if (message.type === 'CANCEL') {
    cancelled = true;
    if (!running) {
      post({ type: 'CANCELLED' });
    }
    return;
  }

  if (message.type !== 'START' || running) return;

  cancelled = false;
  running = true;

  void merge(message.files, message.budget, message.totalKnownPages)
    .catch(error => {
      if (error instanceof MergeCancelledError) {
        post({ type: 'CANCELLED' });
        return;
      }

      const normalized = normalizeError(error);
      post({ type: 'ERROR', message: normalized.message, code: normalized.code });
    })
    .finally(() => {
      running = false;
    });
};

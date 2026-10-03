import { Injectable } from '@angular/core';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';
import { PdfForensicAnalysis, PdfForensicPageObservation } from './pdf-forensic.models';
import { PdfForensicAnalyzerCore } from './pdf-forensic-analyzer-core';

@Injectable({ providedIn: 'root' })
export class PdfForensicAnalyzerService extends PdfForensicAnalyzerCore {
  async analyze(
    file: File,
    pdfJsDocument: any,
    sourceBytes?: Uint8Array,
    sampledPageObservations: PdfForensicPageObservation[] = [],
    signal?: AbortSignal,
  ): Promise<PdfForensicAnalysis> {
    throwIfCompressionCancelled(signal);
    if (typeof document === 'undefined' || typeof Worker === 'undefined') {
      return this.analyzeDirect(file, pdfJsDocument, sourceBytes, sampledPageObservations, signal);
    }
    // A File is structured-cloned without an eager main-thread byte copy.
    // Terminating this worker interrupts pdf-lib parsing and stream hashing.
    const worker = new Worker(new URL('../workers/pdf-forensic.worker', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };
      const onAbort = () => { cleanup(); reject(new CompressionCancelledError()); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Forensic analysis deadline exceeded.')); }, 60_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<{ analysis?: PdfForensicAnalysis }>) => {
        cleanup();
        if (signal?.aborted) reject(new CompressionCancelledError());
        else if (data.analysis) resolve(data.analysis);
        else reject(new Error('Forensic analysis unavailable.'));
      };
      worker.onerror = worker.onmessageerror = () => { cleanup(); reject(new Error('Forensic worker unavailable.')); };
      try { worker.postMessage({ file, sampledPageObservations }); }
      catch (error) { cleanup(); reject(error); }
    });
  }

}

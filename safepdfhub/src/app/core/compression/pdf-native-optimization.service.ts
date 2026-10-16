import { CompressionActivity, CompressionActivityObserver } from './compression-activity';
import { PdfDocumentFacts, rememberSourceFacts } from './pdf-document-facts';
import { NativeOptimizationOptions } from './pdf-native-optimization';
import { Injectable } from '@angular/core';
import { CompressionCancelledError, throwIfCompressionCancelled } from './compression-cancellation';

@Injectable({ providedIn: 'root' })
export class PdfNativeOptimizationService {
  async optimize(file: File, signal?: AbortSignal): Promise<File | null> {
    return (await this.optimizeCandidates(file, signal))[0] ?? null;
  }

  optimizeCandidates(file: File, signal?: AbortSignal, options: NativeOptimizationOptions = {}, onActivity?: CompressionActivityObserver): Promise<File[]> {
    throwIfCompressionCancelled(signal);
    if (typeof Worker === 'undefined') return Promise.resolve([]);
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/pdf-native-optimization.worker', import.meta.url), { type: 'module' });
    } catch {
      return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };
      const onAbort = () => { cleanup(); reject(new CompressionCancelledError()); };
      const timeout = setTimeout(() => { cleanup(); resolve([]); }, 120_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<{ buffers: ArrayBuffer[]; facts?: PdfDocumentFacts; type?: string; activity?: CompressionActivity }>) => {
        if (data.type === 'activity') { if (!signal?.aborted && data.activity) onActivity?.(data.activity); return; }
        cleanup();
        if (signal?.aborted) { reject(new CompressionCancelledError()); return; }
        if (data.facts) rememberSourceFacts(file, data.facts);
        resolve(data.buffers.filter(bytes => bytes.byteLength < file.size).map(bytes =>
          new File([bytes], file.name.replace(/\.pdf$/i, '') + '-compressed.pdf', { type: 'application/pdf' })));
      };
      worker.onerror = () => { cleanup(); resolve([]); };
      worker.onmessageerror = () => { cleanup(); resolve([]); };
      const memory = (navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? 0;
      const pixelBudget = memory >= 8 ? 32_000_000 : memory >= 4 ? 16_000_000 : 8_000_000;
      const boundedOptions = { ...options, maxImagePixels: Math.min(options.maxImagePixels ?? pixelBudget, pixelBudget) };
      try { worker.postMessage({ file, options: boundedOptions }); } catch { cleanup(); resolve([]); }
    });
  }
}

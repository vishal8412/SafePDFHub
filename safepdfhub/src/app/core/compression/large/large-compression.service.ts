import { compressionBudget, nativeCompressionLimit, imageQualities, LOSSLESS_ONLY_THRESHOLD } from './large-compression-policy';
import { CompressionLevel } from '../compression.types';
import { Injectable } from '@angular/core';
import { LargeCompressionCapabilityService } from './large-compression-capability.service';
import { CompressionCancelledError, throwIfCompressionCancelled } from '../compression-cancellation';
@Injectable({ providedIn: 'root' })
export class LargeCompressionService {
  private stop: (() => void) | null = null;
  private outputDirectory: string | null = null;
  private running = false;
  private retainUntil = 0;
  private saving: Promise<void> | null = null;
  private releaseLease: (() => void) | null = null;
  constructor(readonly capability: LargeCompressionCapabilityService) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { this.cancel(); void this.release(); });
  }
  retainForDownload(): void { this.retainUntil = Date.now() + 300_000; }
  cancel(): void { this.stop?.(); }
  /** Stream directly to the chosen download file where the browser supports it. */
  async save(file: File): Promise<boolean> {
    const picker = (window as any).showSaveFilePicker;
    if (!picker) { this.retainUntil = Date.now() + 300_000; return false; }
    const handle = await picker.call(window, { suggestedName: file.name,
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }] });
    const pending = (async () => {
      const writable = await handle.createWritable();
      await file.stream().pipeTo(writable);
    })();
    this.saving = pending;
    try { await pending; return true; } finally { if (this.saving === pending) this.saving = null; }
  }
  async release(): Promise<void> {
    const name = this.outputDirectory, lease = this.releaseLease;
    const delay = Math.max(0, this.retainUntil - Date.now());
    const saving = this.saving;
    this.outputDirectory = null; this.releaseLease = null; this.retainUntil = 0;
    if (!name) return;
    const remove = async () => {
      try { await saving; } catch {}
      try { await this.removeTemporaryEntry(await navigator.storage.getDirectory(), name, true); } catch {}
      lease?.();
    };
    // Anchor downloads have no completion event: keep their backing file and lease
    // for five minutes instead of deleting it while a download may still read it.
    if (delay) setTimeout(() => { void remove(); }, delay);
    else await remove();
  }
  async compress(file: File, signal: AbortSignal, progress: (n: number) => void, options: { level?: CompressionLevel; targetBytes?: number } = {}): Promise<{file: File; pages: number; strategy: 'safe' | 'smart' | 'strong'; note: string}> {
    if (this.running) throw new Error('A large PDF is already being processed.');
    this.running = true;
    try {
      this.capability.assertFile(file);
      const level = options.level ?? 'light';
      const deadline = Date.now() + 300_000;
      const wantImages = file.size <= LOSSLESS_ONLY_THRESHOLD && (level !== 'light' || options.targetBytes !== undefined);
      return await navigator.locks.request('safepdfhub-large-compression', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another tab is compressing a large PDF. Wait for it to finish.');
        throwIfCompressionCancelled(signal);
        await this.release();
        // Reclaim abandoned jobs only. Live outputs keep a per-directory Web Lock.
        const cleanupRoot = await navigator.storage.getDirectory();
        const locks = await navigator.locks.query();
        const held = new Set(locks.held?.map(item => item.name));
        for await (const [entry] of (cleanupRoot as any).entries()) {
          if (/^safepdfhub-compress-[0-9a-f-]{36}$/.test(entry) && !held.has(entry)) {
            try { await cleanupRoot.removeEntry(entry, { recursive: true }); } catch {}
          }
        }
        await this.capability.checkStorage(file, wantImages);
        throwIfCompressionCancelled(signal);
        const root = await navigator.storage.getDirectory();
        const name = `safepdfhub-compress-${crypto.randomUUID()}`;
        await new Promise<void>(acquired => {
          void navigator.locks.request(name, () => new Promise<void>(released => {
            this.releaseLease = released; acquired();
          }));
        });
        let keep = false;
        try {
          const directory = await root.getDirectoryHandle(name, { create: true });
          let native = file.size <= nativeCompressionLimit(this.capability.budget ?? compressionBudget(null, 'desktop', true));
          const requestedQualities = native ? [] : imageQualities(file.size, level, file.size, options.targetBytes);
          let firstQuality = requestedQualities.shift();
          let firstFailed = false;
          let pages: number;
          try {
            pages = await this.runWorker(file, directory, signal, n => progress(Math.round(n * 0.4)),
              { outputName: 'output.pdf', nativeOptions: native ? options : undefined, quality: firstQuality, timeoutMs: Math.max(1, Math.min(native ? 180_000 : 300_000, deadline - Date.now())) });
          } catch (error) {
            throwIfCompressionCancelled(signal);
            if ((!native && firstQuality === undefined) || error instanceof CompressionCancelledError || Date.now() >= deadline) throw error;
            native = false; firstQuality = undefined; firstFailed = true;
            await this.removeTemporaryEntry(directory, 'output.pdf');
            pages = await this.runWorker(file, directory, signal, n => progress(Math.round(n * 0.4)),
              { outputName: 'output.pdf', timeoutMs: Math.max(1, deadline - Date.now()) });
          }
          throwIfCompressionCancelled(signal);
          let bestName = 'output.pdf';
          let stored = await (await directory.getFileHandle(bestName)).getFile();
          if (stored.size <= 0) throw new Error('Compression did not produce a valid output.');
          let selectedQuality = firstQuality, fallback = firstFailed ? ' The image optimization pass could not be validated; a lossless result was retained.' : '';
          const qualities = native || firstFailed || (options.targetBytes !== undefined && stored.size <= options.targetBytes) ? [] : requestedQualities;
          for (let i = 0; i < qualities.length; i++) {
            throwIfCompressionCancelled(signal);
            const candidateName = `output-${i}.pdf`;
            try {
              const candidatePages = await this.runWorker(file, directory, signal,
                n => progress(Math.min(95, Math.round(40 + i * 18 + n * 0.18))),
                { outputName: candidateName, quality: qualities[i], timeoutMs: Math.max(1, deadline - Date.now()) });
              throwIfCompressionCancelled(signal);
              const candidate = await (await directory.getFileHandle(candidateName)).getFile();
              if (candidatePages !== pages || candidate.size <= 0) throw new Error('Image candidate failed validation.');
              if (candidate.size < stored.size) {
                await directory.removeEntry(bestName);
                bestName = candidateName; stored = candidate; selectedQuality = qualities[i];
              } else await directory.removeEntry(candidateName);
              if (options.targetBytes !== undefined && Math.min(stored.size, file.size) <= options.targetBytes) break;
            } catch (error) {
              throwIfCompressionCancelled(signal);
              if (error instanceof CompressionCancelledError) throw error;
              try { await this.removeTemporaryEntry(directory, candidateName); } catch {}
              fallback = ' Further image compression stopped at a device resource or validation limit; the best validated result was retained.';
              break;
            }
          }
          throwIfCompressionCancelled(signal);
          const strategy = native ? (level === 'light' ? 'safe' : level === 'recommended' ? 'smart' : 'strong') : selectedQuality === undefined ? 'safe' : level === 'recommended' ? 'smart' : 'strong';
          const note = (native ? 'Duplicate PDF data was consolidated; image optimization followed the selected quality and target settings. Text, page geometry and metadata were retained.' : selectedQuality === undefined
            ? 'Disk-backed processing retained a lossless result.'
            : `Disk-backed image compression used JPEG quality ${selectedQuality}.`) +
            (file.size > LOSSLESS_ONLY_THRESHOLD ? ' Inputs above 200 MB use lossless compression only.' : '') + fallback;
          if (stored.size >= file.size) return { file, pages, strategy: 'safe' as const, note: 'The original PDF was retained because no smaller validated output was produced.' + fallback };
          const result = new File([stored], file.name.replace(/\.pdf$/i, '') + '-compressed.pdf', { type: 'application/pdf' });
          this.outputDirectory = name; keep = true;
          return { file: result, pages, strategy, note };
        } finally {
          if (!keep) {
            try { await this.removeTemporaryEntry(root, name, true); } catch {}
            this.releaseLease?.(); this.releaseLease = null;
          }
        }
      });
    } finally { this.running = false; }
  }
  // Terminating a worker does not synchronously release its OPFS access handles.
  // Retain the directory lease while retrying transient lock errors.
  private async removeTemporaryEntry(directory: FileSystemDirectoryHandle, name: string, recursive = false): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await directory.removeEntry(name, { recursive }); return; }
      catch (error) {
        const kind = (error as DOMException)?.name;
        if (kind === 'NotFoundError') return;
        if (attempt >= 7 || !['NoModificationAllowedError', 'InvalidStateError', 'UnknownError'].includes(kind)) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** attempt, 1000)));
      }
    }
  }
  private runWorker(file: File, directory: FileSystemDirectoryHandle, signal: AbortSignal, progress: (n: number) => void, pass: { outputName: string; quality?: number; nativeOptions?: { level?: CompressionLevel; targetBytes?: number }; timeoutMs: number } = { outputName: 'output.pdf', timeoutMs: 300_000 }): Promise<number> {
    throwIfCompressionCancelled(signal);
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./large-compression.worker', import.meta.url), { type: 'module' });
      let settled = false;
      const finish = (error?: Error, pages?: number) => {
        if (settled) return;
        settled = true; clearTimeout(timer); worker.terminate();
        signal.removeEventListener('abort', abort); this.stop = null;
        error ? reject(error) : resolve(pages!);
      };
      const abort = () => finish(new CompressionCancelledError());
      const timer = setTimeout(() => finish(new Error('This compression pass exceeded its time budget. Try a smaller PDF if fallback cannot complete.')), pass.timeoutMs);
      this.stop = abort;
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') progress(data.value);
        if (data.type === 'done') finish(undefined, data.pages);
        if (data.type === 'error') finish(new Error(data.message));
      };
      worker.onerror = () => finish(new Error('The large-file worker stopped. The document may exceed the memory budget; try a smaller PDF.'));
      worker.onmessageerror = () => finish(new Error('The large-file worker could not return its result.'));
      try {
        worker.postMessage({ file, directory, outputName: pass.outputName, quality: pass.quality, nativeOptions: pass.nativeOptions,
          budget: this.capability.budget ?? compressionBudget(null, 'desktop', true),
          jsUrl: new URL('assets/qpdf/qpdf-compression-bounded.js', document.baseURI).href,
          wasmUrl: new URL('assets/qpdf/qpdf-performance.wasm', document.baseURI).href });
      } catch (error) { finish(error instanceof Error ? error : new Error('Could not start large-file processing.')); }
    });
  }
}

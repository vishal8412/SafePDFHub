import { Injectable } from '@angular/core';
import type { PdfProtectOptions, PdfSecurityMode, PdfSecurityResult } from '../pdf-security.types';
import { PdfSecurityError } from '../pdf-security.types';
import { LargePdfSecurityCapabilityService } from './large-pdf-security-capability.service';
import type { LargePdfSecurityF3CryptoProvider, LargePdfSecurityF3RawAesBenchmarkResult, LargePdfSecurityPhaseTiming, LargePdfSecurityProgressPhase, LargePdfSecurityRuntimeInfo, LargePdfSecurityWorkerMessage, LargePdfSecurityWorkerResponse } from './large-pdf-security.protocol';
import {
  resolveLargePdfSecurityBits,
  selectLargePdfSecurityPerformanceProfile,
  selectLargePdfSecurityWasmRuntime
} from './large-pdf-security.performance.config';

type LargePdfSecurityProgressCallback = (
  progress: number,
  phase?: LargePdfSecurityProgressPhase,
  outputSize?: number,
  outputName?: string,
  outputHeaderValid?: boolean,
  phaseTimings?: readonly LargePdfSecurityPhaseTiming[],
  performanceProfile?: import('./large-pdf-security.performance.config').LargePdfSecurityPerformanceProfile,
  wasmRuntime?: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime,
  outputBytesWritten?: number,
  runtimeInfo?: LargePdfSecurityRuntimeInfo
) => void;

@Injectable({ providedIn: 'root' })
export class LargePdfSecurityEngine {
  private worker: Worker | null = null;
  private activeReject: ((reason?: unknown) => void) | null = null;
  private settled = false;
  private retainedOpfsPath: string | null = null;

  constructor(private readonly capability: LargePdfSecurityCapabilityService) {}

  get supported(): boolean {
    return this.capability.supported;
  }

  async protect(
    file: File,
    options: PdfProtectOptions,
    onProgress?: LargePdfSecurityProgressCallback
  ): Promise<PdfSecurityResult> {
    const outputName = this.outputName(file.name, 'protected');
    return this.run({
      type: 'RUN',
      file,
      outputName,
      mode: 'protect',
      userPassword: options.userPassword,
      ownerPassword: this.resolveOwnerPassword(options.userPassword, options.ownerPassword),
      permissions: options.permissions,
      bits: resolveLargePdfSecurityBits(file.size, options.bits, options.largeFilePerformance),
      performanceProfile: selectLargePdfSecurityPerformanceProfile(
        file.size,
        resolveLargePdfSecurityBits(file.size, options.bits, options.largeFilePerformance),
        options.largeFilePerformance
      ),
      wasmRuntime: selectLargePdfSecurityWasmRuntime(file.size, options.largeFilePerformance),
      enableF3Diagnostics: options.enableF3Diagnostics === true
    }, onProgress);
  }

  async unlock(
    file: File,
    password: string,
    onProgress?: LargePdfSecurityProgressCallback
  ): Promise<PdfSecurityResult> {
    return this.removePassword(file, password, onProgress, 'unlock');
  }

  async removePassword(
    file: File,
    password: string,
    onProgress?: LargePdfSecurityProgressCallback,
    mode: PdfSecurityMode = 'remove-password'
  ): Promise<PdfSecurityResult> {
    const outputName = this.outputName(file.name, mode === 'unlock' ? 'unlocked' : 'password-removed');
    return this.run({
      type: 'RUN',
      file,
      outputName,
      mode,
      password,
      performanceProfile: selectLargePdfSecurityPerformanceProfile(file.size),
      wasmRuntime: selectLargePdfSecurityWasmRuntime(file.size)
    }, onProgress);
  }

  async runF3RawAesBenchmark(options: {
    provider: LargePdfSecurityF3CryptoProvider;
    bits: 128 | 256;
    bufferBytes: number;
    totalMiB?: number;
    bulk: boolean;
  }): Promise<LargePdfSecurityF3RawAesBenchmarkResult> {
    if (!this.capability.supported) {
      throw new PdfSecurityError('The large-file browser security engine is not available in this browser.', 'ENGINE_FAILED');
    }
    const wasmUrl = typeof document !== 'undefined'
      ? new URL('assets/qpdf/qpdf-performance.wasm', document.baseURI).toString()
      : '';
    const qpdfJsUrl = typeof document !== 'undefined'
      ? new URL('assets/qpdf/qpdf-performance.js', document.baseURI).toString()
      : '';
    const worker = new Worker(new URL('./large-pdf-security.worker', import.meta.url));
    return new Promise((resolve, reject) => {
      const cleanup = (): void => worker.terminate();
      worker.onmessage = (event: MessageEvent<LargePdfSecurityWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'F3_RAW_AES_COMPLETE') {
          cleanup();
          resolve(message.result);
        } else if (message.type === 'ERROR') {
          cleanup();
          reject(new LargePdfSecurityEngineError(message.message, message.stderr, message.stdout, message.exitCode, message.phaseTimings ?? [], message.performanceProfile ?? null, message.wasmRuntime ?? null, message.runtimeInfo ?? null));
        }
      };
      worker.onerror = event => {
        cleanup();
        reject(new Error(event.message || 'F3 raw AES Worker failed.'));
      };
      worker.postMessage({
        type: 'RUN-F3-RAW-AES',
        provider: options.provider,
        bits: options.bits,
        bufferBytes: options.bufferBytes,
        totalMiB: options.totalMiB ?? 64,
        bulk: options.bulk,
        wasmUrl,
        qpdfJsUrl,
        wasmRuntime: 'performance'
      });
    });
  }

  cancel(): void {
    const worker = this.worker;
    const reject = this.activeReject;
    if (!worker || !reject || this.settled) return;

    try {
      worker.postMessage({ type: 'CANCEL' } satisfies LargePdfSecurityWorkerMessage);
    } catch {
      // Worker may already be terminating.
    }

    setTimeout(() => {
      if (this.activeReject !== reject || this.settled) return;
      this.terminateWorker();
      this.settled = true;
      this.activeReject = null;
      reject(new PdfSecurityError('PDF security operation was cancelled.', 'CANCELLED'));
    }, 100);
  }

  private run(
    request: Extract<LargePdfSecurityWorkerMessage, { type: 'RUN' }>,
    onProgress?: LargePdfSecurityProgressCallback
  ): Promise<PdfSecurityResult> {
    if (!this.capability.supported) {
      throw new PdfSecurityError(
        'The large-file browser security engine is not available in this browser.',
        'ENGINE_FAILED'
      );
    }

    if (!this.capability.supportsFile(request.file)) {
      throw new PdfSecurityError(
        'This PDF exceeds the 1 GB browser security input target.',
        'MEMORY_LIMIT'
      );
    }

    void this.cleanupRetainedOpfsOutput();
    this.terminateWorker();
    const worker = new Worker(new URL('./large-pdf-security.worker', import.meta.url));
    this.worker = worker;
    this.settled = false;
    onProgress?.(0);

    const browserPublishedWasmUrl = typeof document !== 'undefined'
      ? new URL('assets/qpdf/qpdf.wasm', document.baseURI).toString()
      : '';
    const browserPerformanceWasmUrl = typeof document !== 'undefined'
      ? new URL('assets/qpdf/qpdf-performance.wasm', document.baseURI).toString()
      : '';
    const browserQpdfJsUrl = typeof document !== 'undefined'
      ? new URL('assets/qpdf/qpdf-performance.js', document.baseURI).toString()
      : '';

    return new Promise<PdfSecurityResult>((resolve, reject) => {
      this.activeReject = reject;

      const settle = (callback: () => void): void => {
        if (this.settled) return;
        this.settled = true;
        this.activeReject = null;
        callback();
      };

      worker.onmessage = (event: MessageEvent<LargePdfSecurityWorkerResponse>) => {
        const message = event.data;

        switch (message.type) {
          case 'PROGRESS':
            onProgress?.(
              Math.max(0, Math.min(100, message.progress)),
              message.phase,
              message.outputSize,
              message.outputName,
              undefined,
              undefined,
              undefined,
              message.wasmRuntime,
              message.outputBytesWritten,
              message.runtimeInfo
            );
            break;
          case 'COMPLETE': {
            // The Worker has finished qpdf, but the Angular-side File snapshot
            // still has to be obtained from OPFS. Keep the Worker alive until
            // that hand-off is complete so its OPFS filesystem context is not
            // torn down at the exact moment the main thread starts reading it.
            onProgress?.(100, 'retrieving-output', message.outputSize, message.outputName, message.outputHeaderValid, message.phaseTimings, message.performanceProfile, message.wasmRuntime, undefined, message.runtimeInfo);

            this.retainedOpfsPath = message.outputPath;
            void this.fileFromOpfs(message.outputPath, message.outputName)
              .then(file => {
                settle(() => {
                  this.worker = null;
                  worker.terminate();
                  resolve({
                    file,
                    mode: request.mode,
                    durationMs: message.durationMs
                  });
                });
              })
              .catch(error => {
                settle(() => {
                  this.worker = null;
                  worker.terminate();
                  reject(error);
                });
              });
            break;
          }
          case 'CANCELLED':
            settle(() => {
              this.worker = null;
              worker.terminate();
              reject(new PdfSecurityError('PDF security operation was cancelled.', 'CANCELLED'));
            });
            break;
          case 'ERROR':
            settle(() => {
              this.worker = null;
              worker.terminate();
              reject(new LargePdfSecurityEngineError(
                message.message,
                message.stderr,
                message.stdout,
                message.exitCode,
                message.phaseTimings ?? [],
                message.performanceProfile ?? request.performanceProfile,
                message.wasmRuntime ?? request.wasmRuntime,
                message.runtimeInfo ?? null
              ));
            });
            break;
        }
      };

      worker.onerror = event => {
        settle(() => {
          this.worker = null;
          worker.terminate();
          reject(new LargePdfSecurityEngineError(
            event.message || 'Large PDF security Worker failed.',
            [],
            [],
            null,
            [],
            request.performanceProfile,
            request.wasmRuntime,
            null
          ));
        });
      };

      worker.postMessage({
        ...request,
        // Phase 1.5F uses the standalone custom qpdf runtime for this engine.
        // The published package is intentionally not imported by the module
        // Worker because its CommonJS qpdf.js references Node fs/path.
        wasmUrl: browserPerformanceWasmUrl,
        publishedWasmUrl: browserPublishedWasmUrl,
        qpdfJsUrl: browserQpdfJsUrl
      });
    });
  }

  private async fileFromOpfs(path: string, name: string): Promise<File> {
    if (!navigator.storage?.getDirectory) {
      throw new PdfSecurityError(
        'Origin Private File System is unavailable in this browser.',
        'ENGINE_FAILED'
      );
    }

    const root = await navigator.storage.getDirectory();
    const segments = path.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) throw new Error('Large PDF output path is invalid.');

    let directory = root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }

    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();

    // Keep the OPFS entry alive while the returned File may still be used for
    // download. FileSystemFileHandle.getFile() can become unreadable if the
    // underlying entry is removed after getFile() resolves, so cleanup is
    // deferred until the next engine run. This avoids copying a 1 GiB output
    // into a main-thread ArrayBuffer just to create an independent Blob.
    return file.name === name ? file : new File([file], name, { type: 'application/pdf' });
  }

  private async cleanupRetainedOpfsOutput(): Promise<void> {
    const path = this.retainedOpfsPath;
    if (!path || !navigator.storage?.getDirectory) return;
    this.retainedOpfsPath = null;

    try {
      const root = await navigator.storage.getDirectory();
      const segments = path.split('/').filter(Boolean);
      const fileName = segments.pop();
      if (!fileName) return;

      let directory = root;
      for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment);
      }
      await directory.removeEntry(fileName);

      const jobDirectoryName = segments[segments.length - 1];
      if (jobDirectoryName) {
        let parent = root;
        for (const segment of segments.slice(0, -1)) {
          parent = await parent.getDirectoryHandle(segment);
        }
        await parent.removeEntry(jobDirectoryName);
      }
    } catch {
      // Cleanup is best-effort.
    }
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.activeReject = null;
    this.settled = true;
  }

  private resolveOwnerPassword(userPassword: string, ownerPassword?: string): string {
    const requested = ownerPassword?.trim();
    if (requested && requested !== userPassword) return requested;

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private outputName(name: string, suffix: string): string {
    const base = name.replace(/\.pdf$/i, '') || 'document';
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safe}_${suffix}.pdf`;
  }
}

export class LargePdfSecurityEngineError extends Error {
  constructor(
    message: string,
    readonly stderr: readonly string[],
    readonly stdout: readonly string[],
    readonly exitCode: number | null,
    readonly phaseTimings: readonly LargePdfSecurityPhaseTiming[] = [],
    readonly performanceProfile: import('./large-pdf-security.performance.config').LargePdfSecurityPerformanceProfile | null = null,
    readonly wasmRuntime: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime | null = null,
    readonly runtimeInfo: LargePdfSecurityRuntimeInfo | null = null
  ) {
    super(message);
    this.name = 'LargePdfSecurityEngineError';
  }
}

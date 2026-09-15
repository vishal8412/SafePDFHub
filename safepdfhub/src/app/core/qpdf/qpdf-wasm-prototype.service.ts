import { Injectable } from '@angular/core';

import type {
  QpdfRunRequest,
  QpdfRunResult,
  QpdfWasmRunner,
  QpdfWasmRunnerFactory
} from './qpdf-wasm.types';

/**
 * Phase 0D qpdf WASM prototype service.
 *
 * qpdf-run already executes qpdf inside its own browser Web Worker.
 * SafePDFHub therefore keeps only the higher-level lifecycle here and
 * adapts the concrete qpdf-run runner to our internal QpdfWasmRunner
 * abstraction.
 */
@Injectable({ providedIn: 'root' })
export class QpdfWasmPrototypeService {
  private activeRunner: QpdfWasmRunner | null = null;
  private cancelled = false;

  async merge(
    files: readonly File[],
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory()
  ): Promise<File> {
    if (files.length < 2) {
      throw new Error('QPDF prototype merge requires at least 2 PDFs.');
    }

    this.cancelled = false;

    onProgress?.(2);

    const inputs: Record<string, Uint8Array> = {};
    const names: string[] = [];

    for (let index = 0; index < files.length; index += 1) {
      this.throwIfCancelled();

      const file = files[index];
      const buffer = await file.arrayBuffer();
      const name = this.uniqueName(file.name, index);

      inputs[name] = new Uint8Array(buffer);
      names.push(name);

      onProgress?.(
        5 + Math.round(((index + 1) / files.length) * 25)
      );
    }

    const outputName = 'merged-qpdf-prototype.pdf';

    const request: QpdfRunRequest = {
      inputs,
      args: [
        '--empty',
        '--pages',
        ...names,
        '--',
        outputName
      ],
      outputs: [outputName]
    };

    onProgress?.(35);

    this.throwIfCancelled();

    const runner = await runnerFactory.create();

    this.activeRunner = runner;

    try {
      onProgress?.(45);

      const result = await runner.run(request);

      this.throwIfCancelled();

      if (!result.ok || result.exitCode !== 0) {
        throw new Error(this.formatQpdfError(result));
      }

      const output = result.outputs[outputName];

      if (!output) {
        throw new Error(
          'QPDF prototype did not return the merged PDF output.'
        );
      }

      onProgress?.(95);

      const outputBuffer = toArrayBuffer(output);

      onProgress?.(100);

      return new File(
        [outputBuffer],
        outputName,
        { type: 'application/pdf' }
      );
    } finally {
      if (this.activeRunner === runner) {
        this.activeRunner = null;
      }

      await runner.destroy?.();
    }
  }

  /**
   * qpdf-run's runner is backed by its own Worker.
   * Destroying that runner is our cancellation mechanism.
   */
  async cancel(): Promise<void> {
    this.cancelled = true;

    const runner = this.activeRunner;

    this.activeRunner = null;

    await runner?.destroy?.();
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      throw new QpdfPrototypeCancelledError();
    }
  }

  private formatQpdfError(result: QpdfRunResult): string {
    const details = [
      ...result.stderr,
      ...result.warnings
    ]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(' ');

    return details
      ? `QPDF prototype merge failed. ${details}`
      : 'QPDF prototype merge failed.';
  }

  private uniqueName(
    name: string,
    index: number
  ): string {
    const sanitized = name.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    return `${String(index).padStart(3, '0')}-${
      sanitized || 'input.pdf'
    }`;
  }
}

export class QpdfPrototypeCancelledError extends Error {
  constructor() {
    super('QPDF prototype merge was cancelled.');
    this.name = 'QpdfPrototypeCancelledError';
  }
}

/**
 * Adapter between the real qpdf-run API and our SafePDFHub
 * QpdfWasmRunner abstraction.
 *
 * Important:
 * qpdf-run's runner is NOT structurally identical to our interface
 * because its run() method expects its own QpdfRunOptions type.
 *
 * We therefore adapt it explicitly instead of casting it.
 */
function createBrowserQpdfRunnerFactory(): QpdfWasmRunnerFactory {
  return {
    async create(): Promise<QpdfWasmRunner> {
      const module = await import('qpdf-run');

      const workerUrl = new URL(
        'qpdf-run/worker',
        import.meta.url
      ).href;

      const qpdfJsUrl = new URL(
        'qpdf-run/qpdf.js',
        import.meta.url
      ).href;

      const wasmUrl = new URL(
        'qpdf-run/qpdf.wasm',
        import.meta.url
      ).href;

      const qpdf = await module.createQpdfRunner({
        workerUrl,
        qpdfJsUrl,
        wasmUrl,
        timeoutMs: 15 * 60 * 1000,
        env: 'browser'
      });

      return {
        run: async (
          request: QpdfRunRequest
        ): Promise<QpdfRunResult> => {
          /*
           * qpdf-run expects mutable string[].
           *
           * Our internal contract intentionally exposes readonly arrays,
           * so create fresh mutable arrays at this boundary.
           */
          const result = await qpdf.run({
            inputs: request.inputs,
            args: [...request.args],
            outputs: [...request.outputs]
          });

          return {
            ok: result.ok,
            outputs: result.outputs,
            stdout: result.stdout,
            stderr: result.stderr,
            warnings: result.warnings,
            exitCode: result.exitCode,
            durationMs: result.durationMs
          };
        },

        destroy: async (): Promise<void> => {
          await qpdf.destroy();
        }
      };
    }
  };
}

/**
 * Always create a concrete ArrayBuffer.
 *
 * This avoids the TypeScript 5.9 ArrayBufferLike / SharedArrayBuffer
 * incompatibility when constructing a Blob/File.
 */
function toArrayBuffer(
  bytes: Uint8Array
): ArrayBuffer {
  const buffer = new ArrayBuffer(
    bytes.byteLength
  );

  new Uint8Array(buffer).set(bytes);

  return buffer;
}
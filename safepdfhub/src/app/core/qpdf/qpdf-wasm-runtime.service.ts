import { Injectable } from '@angular/core';

import type {
  QpdfRunRequest,
  QpdfRunResult,
  QpdfWasmRunner,
  QpdfWasmRunnerFactory
} from './qpdf-wasm.types';

@Injectable({ providedIn: 'root' })
export class QpdfWasmRuntimeService {
  private activeRunner: QpdfWasmRunner | null = null;
  private cancelled = false;

  async run(
    request: QpdfRunRequest,
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory()
  ): Promise<QpdfRunResult> {
    this.cancelled = false;

    onProgress?.(0);

    const runner = await runnerFactory.create();
    this.activeRunner = runner;

    try {
      this.throwIfCancelled();
      onProgress?.(10);

      const result = await runner.run(request);

      this.throwIfCancelled();
      onProgress?.(100);

      return result;
    } finally {
      if (this.activeRunner === runner) {
        this.activeRunner = null;
      }

      await runner.destroy?.();
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;

    const runner = this.activeRunner;
    this.activeRunner = null;

    await runner?.destroy?.();
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error('QPDF operation was cancelled.');
    }
  }
}

export function createBrowserQpdfRunnerFactory(): QpdfWasmRunnerFactory {
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

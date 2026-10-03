import { Injectable } from '@angular/core';

import { QpdfRuntimeError, sanitizeQpdfRuntimeErrorMessage } from './qpdf-runtime-error';
import type {
  QpdfRunRequest,
  QpdfRunResult,
  QpdfWasmRunner,
  QpdfWasmRunnerFactory
} from './qpdf-wasm.types';

@Injectable({ providedIn: 'root' })
export class QpdfWasmRuntimeService {
  private activeRunner: QpdfWasmRunner | null = null;
  private generation = 0;

  async run(
    request: QpdfRunRequest,
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory()
  ): Promise<QpdfRunResult> {
    const generation = ++this.generation;
    onProgress?.(0);

    let runner: QpdfWasmRunner;
    try {
      runner = await runnerFactory.create();
    } catch (error) {
      throw new QpdfRuntimeError(
        'runner-create',
        sanitizeQpdfRuntimeErrorMessage(error),
        error,
      );
    }

    if (generation !== this.generation) {
      try {
        await runner.destroy?.();
      } catch {
        // Cancellation has already won; cleanup failure must not mask it.
      }
      throw new QpdfRuntimeError(
        'runner-run',
        'QPDF operation was cancelled.',
        undefined,
        true,
      );
    }
    this.activeRunner = runner;

    try {
      this.throwIfCancelled(generation);
      onProgress?.(10);

      let result: QpdfRunResult;
      try {
        result = await runner.run(request);
      } catch (error) {
        throw new QpdfRuntimeError(
          'runner-run',
          sanitizeQpdfRuntimeErrorMessage(error),
          error,
        );
      }

      this.throwIfCancelled(generation);
      onProgress?.(100);

      return result;
    } finally {
      if (this.activeRunner === runner) {
        this.activeRunner = null;
      }

      try {
        await runner.destroy?.();
      } catch (error) {
        // Never replace a successful qpdf result with a destroy-only failure.
        // If the operation is already failing, the original error remains the
        // useful diagnostic. Cleanup failures are intentionally not surfaced
        // as candidate failures.
        void error;
      }
    }
  }

  async cancel(): Promise<void> {
    this.generation += 1;

    const runner = this.activeRunner;
    this.activeRunner = null;

    await runner?.destroy?.();
  }

  private throwIfCancelled(generation: number): void {
    if (generation !== this.generation) {
      throw new QpdfRuntimeError('runner-run', 'QPDF operation was cancelled.', undefined, true);
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

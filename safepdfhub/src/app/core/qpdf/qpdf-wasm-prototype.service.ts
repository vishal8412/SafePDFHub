import { Injectable } from '@angular/core';

import type {
  QpdfRunRequest,
  QpdfRunResult,
  QpdfWasmRunnerFactory
} from './qpdf-wasm.types';
import {
  QpdfWasmRuntimeService,
  createBrowserQpdfRunnerFactory
} from './qpdf-wasm-runtime.service';

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
  private cancelled = false;

  constructor(
    private readonly runtime: QpdfWasmRuntimeService
  ) {}

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

    onProgress?.(45);

    const result = await this.runtime.run(
      request,
      progress => {
        onProgress?.(45 + Math.round(progress * 0.5));
      },
      runnerFactory
    );

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
  }

  /**
   * qpdf-run's runner is backed by its own Worker.
   * Destroying that runner is our cancellation mechanism.
   */
  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.runtime.cancel();
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
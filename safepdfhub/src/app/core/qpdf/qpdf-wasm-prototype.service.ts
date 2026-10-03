import { Injectable } from '@angular/core';

import type {
  QpdfRunRequest,
  QpdfRunResult,
  QpdfWasmRunnerFactory
} from './qpdf-wasm.types';
import { QpdfRuntimeError, sanitizeQpdfRuntimeErrorMessage, qpdfRuntimeErrorName } from './qpdf-runtime-error';
import type { QpdfWasmOptimizationProfile } from './qpdf-wasm-resource-guard.service';
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
  /**
   * A qpdf WASM OOM is a runtime-boundary observation, not a normal candidate
   * failure. Once the same File object has exhausted the qpdf runtime, avoid
   * immediately invoking another PDF-output operation against the same bytes.
   * This prevents structural -> image -> fallback qpdf fan-out from repeating
   * the same expensive OOM during one browser session.
   */
  private readonly outputOomBlockedFiles = new WeakSet<File>();

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
   * Overlay a small generated PDF on top of an existing PDF without rebuilding
   * the original page content. This is intentionally separate from `optimize`
   * because signature-only Studio exports should preserve the source streams
   * instead of asking pdf-lib to copy/rewrite every page resource.
   */
  async overlay(
    sourceFile: File,
    overlayFile: File,
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory()
  ): Promise<File> {
    this.cancelled = false;
    onProgress?.(5);

    const sourceName = this.uniqueName(sourceFile.name || 'input.pdf', 0);
    const overlayName = this.uniqueName(overlayFile.name || 'overlay.pdf', 1);
    const outputName = 'overlay-output.pdf';

    const request: QpdfRunRequest = {
      inputs: {
        [sourceName]: new Uint8Array(await sourceFile.arrayBuffer()),
        [overlayName]: new Uint8Array(await overlayFile.arrayBuffer()),
      },
      args: [
        sourceName,
        '--overlay',
        overlayName,
        '--',
        outputName,
      ],
      outputs: [outputName],
    };

    const result = await this.runtime.run(
      request,
      progress => onProgress?.(10 + Math.round(progress * 0.85)),
      runnerFactory
    );

    this.throwIfCancelled();
    if (!result.ok || result.exitCode !== 0) {
      throw new Error(this.formatQpdfError(result));
    }

    const output = result.outputs[outputName];
    if (!output) throw new Error('QPDF overlay did not return an output PDF.');

    onProgress?.(100);
    return new File([toArrayBuffer(output)], sourceFile.name, { type: 'application/pdf' });
  }

  /**
   * Recompress an already-generated PDF without changing its visible content.
   * This is used as a safety valve after pdf-lib rewrites a large document.
   */
  async optimize(
    file: File,
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory()
  ): Promise<File> {
    this.throwIfOutputOomBlocked(file);
    this.cancelled = false;
    onProgress?.(5);

    const inputName = this.uniqueName(file.name || 'input.pdf', 0);
    const outputName = 'optimized-output.pdf';
    const request: QpdfRunRequest = {
      inputs: { [inputName]: new Uint8Array(await file.arrayBuffer()) },
      args: [
        inputName,
        '--stream-data=compress',
        '--recompress-flate',
        '--compression-level=9',
        '--object-streams=generate',
        '--',
        outputName,
      ],
      outputs: [outputName],
    };

    let result: QpdfRunResult;
    try {
      result = await this.runtime.run(
        request,
        progress => onProgress?.(10 + Math.round(progress * 0.85)),
        runnerFactory
      );
    } catch (error) {
      if (this.isMemoryExhaustion(error)) {
        this.outputOomBlockedFiles.add(file);
      }
      throw error;
    }

    this.throwIfCancelled();
    if (this.isMemoryExhaustion(result)) {
      this.outputOomBlockedFiles.add(file);
    }
    if (!result.ok || result.exitCode !== 0) {
      throw new Error(this.formatQpdfError(result));
    }

    const output = result.outputs[outputName];
    if (!output) throw new Error('QPDF optimization did not return an output PDF.');
    onProgress?.(100);
    return new File([toArrayBuffer(output)], file.name, { type: 'application/pdf' });
  }

  /**
   * Compression-specific qpdf pass.
   *
   * Unlike the generic optimize() path used by Studio, this pass is allowed
   * to rewrite non-JPEG images when qpdf can prove that the JPEG result is
   * smaller. It also recompresses existing Flate streams at level 9.
   * qpdf 12.2.0 (the version bundled by @neslinesli93/qpdf-wasm 0.3.0)
   * supports --optimize-images and --jpeg-quality.
   */
  async optimizeForCompression(
    file: File,
    jpegQuality = 72,
    onProgress?: (progress: number) => void,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory(),
    optimizationProfile: QpdfWasmOptimizationProfile = 'standard'
  ): Promise<File> {
    this.throwIfOutputOomBlocked(file);
    this.cancelled = false;
    onProgress?.(5);

    const inputName = this.uniqueName(file.name || 'input.pdf', 0);
    const outputName = 'compressed-qpdf-output.pdf';
    const quality = Math.min(95, Math.max(40, Math.round(jpegQuality)));
    const request: QpdfRunRequest = {
      inputs: { [inputName]: new Uint8Array(await file.arrayBuffer()) },
      args: [
        inputName,
        '--compress-streams=y',
        ...(optimizationProfile === 'standard'
          ? [
              '--decode-level=generalized',
              '--recompress-flate',
              '--compression-level=9',
              '--optimize-images',
              `--jpeg-quality=${quality}`,
              '--object-streams=generate',
            ]
          : []),
        '--',
        outputName,
      ],
      outputs: [outputName],
    };

    let result: QpdfRunResult;
    try {
      result = await this.runtime.run(
        request,
        progress => onProgress?.(10 + Math.round(progress * 0.85)),
        runnerFactory
      );
    } catch (error) {
      if (this.isMemoryExhaustion(error)) this.outputOomBlockedFiles.add(file);
      throw error;
    }

    this.throwIfCancelled();
    if (this.isMemoryExhaustion(result)) {
      this.outputOomBlockedFiles.add(file);
    }
    if (!result.ok || result.exitCode !== 0) {
      throw new Error(this.formatQpdfError(result));
    }

    const output = result.outputs[outputName];
    if (!output) throw new Error('QPDF compression optimization did not return an output PDF.');

    onProgress?.(100);
    return new File([toArrayBuffer(output)], file.name, { type: 'application/pdf' });
  }

  /**
   * Run a V2.2 structural optimization candidate.
   *
   * Each candidate intentionally uses only structural/resource operations.
   * The caller is responsible for validating and comparing the returned File.
   */
  async optimizeStructuralCandidate(
    file: File,
    kind:
      | 'baseline'
      | 'resource-prune'
      | 'content-coalesce'
      | 'resource-prune-and-coalesce'
      | 'image-resource',
    jpegQuality = 80,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory(),
    optimizationProfile: QpdfWasmOptimizationProfile = 'standard'
  ): Promise<File> {
    this.throwIfOutputOomBlocked(file);
    this.cancelled = false;

    const inputName = this.uniqueName(file.name || 'input.pdf', 0);
    const outputName = `structural-${kind}-output.pdf`;

    const args = [
      inputName,
      '--compress-streams=y',
      ...(optimizationProfile === 'standard'
        ? [
            '--decode-level=generalized',
            '--recompress-flate',
            '--compression-level=9',
            '--object-streams=generate',
          ]
        : []),
    ];

    switch (kind) {
      case 'resource-prune':
        args.push('--remove-unreferenced-resources=yes');
        break;
      case 'content-coalesce':
        args.push('--coalesce-contents');
        break;
      case 'resource-prune-and-coalesce':
        args.push(
          '--remove-unreferenced-resources=yes',
          '--coalesce-contents',
        );
        break;
      case 'image-resource':
        args.push(
          '--remove-unreferenced-resources=yes',
          '--optimize-images',
          `--jpeg-quality=${Math.min(95, Math.max(40, Math.round(jpegQuality)))}`,
        );
        break;
      case 'baseline':
        break;
    }

    args.push('--', outputName);

    let result: QpdfRunResult;
    try {
      result = await this.runtime.run(
        {
          inputs: {
            [inputName]: new Uint8Array(await file.arrayBuffer()),
          },
          args,
          outputs: [outputName],
        },
        undefined,
        runnerFactory,
      );
    } catch (error) {
      if (error instanceof QpdfRuntimeError) {
        if (error.cancelled) {
          throw error;
        }
        const reason = error.phase === 'runner-create'
          ? 'QPDF_RUNNER_CREATE_FAILED' as const
          : /(?:out[ -]?of[ -]?memory|\boom\b|memory exhaustion|cannot enlarge memory|aborted\(oom\))/i.test(error.message)
            ? 'QPDF_MEMORY_EXHAUSTED' as const
            : 'QPDF_RUN_FAILED' as const;
        if (reason === 'QPDF_MEMORY_EXHAUSTED') {
          this.outputOomBlockedFiles.add(file);
        }
        throw new QpdfStructuralCandidateError(
          kind,
          null,
          error.message,
          reason,
          {
            phase: error.phase,
            name: qpdfRuntimeErrorName(error.causeError ?? error),
            message: sanitizeQpdfRuntimeErrorMessage(error),
          },
        );
      }
      throw error;
    }

    this.throwIfCancelled();

    if (!result.ok || result.exitCode !== 0) {
      const reason = this.isMemoryExhaustion(result)
        ? 'QPDF_MEMORY_EXHAUSTED' as const
        : 'QPDF_EXECUTION_FAILED' as const;
      if (reason === 'QPDF_MEMORY_EXHAUSTED') {
        this.outputOomBlockedFiles.add(file);
      }
      throw new QpdfStructuralCandidateError(
        kind,
        result,
        this.formatQpdfError(result),
        reason,
      );
    }

    const output = result.outputs[outputName];
    if (!output) {
      throw new QpdfStructuralCandidateError(
        kind,
        result,
        `QPDF structural candidate did not return ${kind}.`,
        'QPDF_NO_OUTPUT',
      );
    }

    return new File(
      [toArrayBuffer(output)],
      file.name,
      { type: 'application/pdf' },
    );
  }


  /**
   * Run an isolated V2.3 image-resource optimization candidate.
   *
   * qpdf only retains image transformations that are useful to the resulting
   * PDF; SafePDFHub still treats every quality as a candidate and validates and
   * measures the returned file before selecting it.
   */
  async optimizeImageCandidate(
    file: File,
    jpegQuality: number,
    runnerFactory: QpdfWasmRunnerFactory = createBrowserQpdfRunnerFactory(),
    optimizationProfile: QpdfWasmOptimizationProfile = 'standard'
  ): Promise<File> {
    this.throwIfOutputOomBlocked(file);
    this.cancelled = false;

    const inputName = this.uniqueName(file.name || 'input.pdf', 0);
    const outputName = `image-quality-${Math.min(95, Math.max(40, Math.round(jpegQuality)))}-output.pdf`;
    const quality = Math.min(95, Math.max(40, Math.round(jpegQuality)));

    const request: QpdfRunRequest = {
      inputs: {
        [inputName]: new Uint8Array(await file.arrayBuffer()),
      },
      args: [
        inputName,
        '--compress-streams=y',
        ...(optimizationProfile === 'standard'
          ? [
              '--decode-level=generalized',
              '--recompress-flate',
              '--compression-level=9',
              '--object-streams=generate',
            ]
          : []),
        '--optimize-images',
        `--jpeg-quality=${quality}`,
        '--',
        outputName,
      ],
      outputs: [outputName],
    };

    let result: QpdfRunResult;
    try {
      result = await this.runtime.run(request, undefined, runnerFactory);
    } catch (error) {
      if (error instanceof QpdfRuntimeError) {
        if (error.cancelled) throw error;
        const reason = error.phase === 'runner-create'
          ? 'QPDF_RUNNER_CREATE_FAILED' as const
          : this.isMemoryExhaustion(error)
            ? 'QPDF_MEMORY_EXHAUSTED' as const
            : 'QPDF_RUN_FAILED' as const;
        if (reason === 'QPDF_MEMORY_EXHAUSTED') this.outputOomBlockedFiles.add(file);
        throw new QpdfStructuralCandidateError(
          'image-resource',
          null,
          error.message,
          reason,
          {
            phase: error.phase,
            name: qpdfRuntimeErrorName(error.causeError ?? error),
            message: sanitizeQpdfRuntimeErrorMessage(error),
          },
        );
      }
      throw error;
    }

    this.throwIfCancelled();
    if (this.isMemoryExhaustion(result)) this.outputOomBlockedFiles.add(file);
    if (!result.ok || result.exitCode !== 0) {
      const reason = this.isMemoryExhaustion(result)
        ? 'QPDF_MEMORY_EXHAUSTED' as const
        : 'QPDF_EXECUTION_FAILED' as const;
      if (reason === 'QPDF_MEMORY_EXHAUSTED') this.outputOomBlockedFiles.add(file);
      throw new QpdfStructuralCandidateError(
        'image-resource',
        result,
        this.formatQpdfError(result),
        reason,
      );
    }

    const output = result.outputs[outputName];
    if (!output) {
      throw new QpdfStructuralCandidateError(
        'image-resource',
        result,
        `QPDF image candidate did not return ${outputName}.`,
        'QPDF_NO_OUTPUT',
      );
    }

    return new File(
      [toArrayBuffer(output)],
      file.name,
      { type: 'application/pdf' },
    );
  }

  private throwIfOutputOomBlocked(file: File): void {
    if (this.outputOomBlockedFiles.has(file)) {
      throw new QpdfStructuralCandidateError(
        'qpdf-output',
        null,
        'QPDF PDF-output generation was previously observed to exhaust browser WASM memory for this document. The qpdf output path is blocked for this document; SafePDFHub must use the certified non-qpdf fallback.',
        'QPDF_MEMORY_EXHAUSTED',
      );
    }
  }

  private isMemoryExhaustion(value: unknown): boolean {
    const message = value instanceof Error
      ? value.message
      : typeof value === 'object' && value !== null && 'stderr' in value
        ? [...((value as { stderr?: readonly string[] }).stderr ?? [])].join(' ')
        : String(value);
    return /(?:out[ -]?of[ -]?memory|\boom\b|memory exhaustion|cannot enlarge memory|aborted\(oom\))/i.test(message);
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


export class QpdfStructuralCandidateError extends Error {
  constructor(
    readonly kind: string,
    readonly result: QpdfRunResult | null,
    message: string,
    readonly reason:
      | 'QPDF_EXECUTION_FAILED'
      | 'QPDF_RUNNER_CREATE_FAILED'
      | 'QPDF_RUN_FAILED'
      | 'QPDF_MEMORY_EXHAUSTED'
      | 'QPDF_NO_OUTPUT' = 'QPDF_EXECUTION_FAILED',
    readonly runtimeError?: {
      phase: 'runner-create' | 'runner-run' | 'runner-destroy';
      name: string;
      message: string;
    },
  ) {
    super(message);
    this.name = 'QpdfStructuralCandidateError';
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
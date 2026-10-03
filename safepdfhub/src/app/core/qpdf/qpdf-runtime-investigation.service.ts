import { Injectable } from '@angular/core';
import { QpdfWasmRuntimeService } from './qpdf-wasm-runtime.service';
import type { QpdfRunRequest, QpdfRunResult } from './qpdf-wasm.types';

export type QpdfInvestigationProbe =
  | 'page-count'
  | 'baseline-output'
  | 'compress-streams'
  | 'recompress-flate'
  | 'object-streams'
  | 'image-optimize';

export interface QpdfMemorySnapshot {
  timestamp: string;
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
  deviceMemoryGb: number | null;
}

export interface QpdfInvestigationProbeResult {
  probe: QpdfInvestigationProbe;
  status: 'passed' | 'failed' | 'oom' | 'cancelled' | 'skipped';
  durationMs: number | null;
  exitCode: number | null;
  outputBytes: number | null;
  stderr: string[];
  warnings: string[];
  stdout: string[];
  errorMessage: string | null;
  diagnosticCode: 'NONE' | 'QPDF_MEMORY_EXHAUSTED' | 'QPDF_RUN_FAILED' | 'QPDF_NO_OUTPUT' | 'CANCELLED' | 'PAGE_COUNT_INVALID';
  recommendedAction: 'CONTINUE_PROBES' | 'STOP_QPDF_OUTPUT_FOR_WORKLOAD' | 'FIX_INPUT_OR_RUNTIME' | 'CANCELLED';
  runtimePhase: 'runner-create' | 'runner-run' | 'runner-destroy' | null;
  memoryBefore: QpdfMemorySnapshot;
  memoryAfter: QpdfMemorySnapshot;
  args: string[];
}

export interface QpdfRuntimeInvestigationReport {
  schemaVersion: 4;
  generatedAt: string;
  sourceFileName: string;
  sourceFileBytes: number;
  sourcePageCount: number;
  pageCountProbe: QpdfInvestigationProbeResult;
  operations: QpdfInvestigationProbeResult[];
  cancelled: boolean;
  sourceSha256: string;
  cacheHit: boolean;
  productionInterpretation: 'safe-output-boundary-observed' | 'output-capable' | 'page-count-boundary' | 'cancelled';
  boundary: QpdfInvestigationProbe | 'none' | 'page-count';
  note: string;
}

const INVESTIGATION_QPDF_TIMEOUT_MS = 60_000;

const OPERATION_DEFINITIONS: ReadonlyArray<{
  probe: Exclude<QpdfInvestigationProbe, 'page-count'>;
  label: string;
  args: readonly string[];
}> = [
  {
    probe: 'baseline-output',
    label: 'Baseline PDF output',
    args: [],
  },
  {
    probe: 'compress-streams',
    label: 'Stream compression only',
    args: ['--compress-streams=y'],
  },
  {
    probe: 'recompress-flate',
    label: 'Generalized Flate recompression',
    args: [
      '--decode-level=generalized',
      '--recompress-flate',
      '--compression-level=9',
    ],
  },
  {
    probe: 'object-streams',
    label: 'Object-stream generation',
    args: ['--object-streams=generate'],
  },
  {
    probe: 'image-optimize',
    label: 'Image optimization',
    args: ['--optimize-images', '--jpeg-quality=80'],
  },
];

@Injectable({ providedIn: 'root' })
export class QpdfRuntimeInvestigationService {
  private cancelled = false;
  private readonly reportCache = new Map<string, QpdfRuntimeInvestigationReport>();

  constructor(
    private readonly runtime: QpdfWasmRuntimeService,
  ) {}

  async investigate(
    source: File,
    onProgress?: (progress: number, message: string) => void,
    options: { forceRerun?: boolean } = {},
  ): Promise<QpdfRuntimeInvestigationReport> {
    this.cancelled = false;

    onProgress?.(0, 'Reading source PDF bytes...');
    const sourceBytes = await source.arrayBuffer();
    this.throwIfCancelled();
    const sourceSha256 = await this.sha256(sourceBytes);
    const cached = options.forceRerun ? undefined : this.reportCache.get(sourceSha256);
    if (cached) {
      onProgress?.(100, 'Using the cached R5 boundary evidence for this exact PDF. No qpdf OOM probe was repeated.');
      return { ...cached, cacheHit: true };
    }

    const pageCountResult = await this.runPageCountProbe(sourceBytes, onProgress);
    const pageCountProbe = pageCountResult.probe;
    this.throwIfCancelled();

    const sourcePageCount = pageCountResult.pageCount;
    if (sourcePageCount === null) {
      onProgress?.(100, 'QPDF page-count probe failed; investigation stopped.');
      return {
        schemaVersion: 4,
        generatedAt: new Date().toISOString(),
        sourceFileName: source.name,
        sourceFileBytes: source.size,
        sourcePageCount: 0,
        sourceSha256,
        cacheHit: false,
        productionInterpretation: 'page-count-boundary',
        pageCountProbe,
        operations: [],
        cancelled: false,
        boundary: 'page-count',
        note:
          'The qpdf page-count probe did not return a valid page count. ' +
          'No PDF-output boundary probes were executed.',
      };
    }

    const operations: QpdfInvestigationProbeResult[] = [];
    let boundary: QpdfRuntimeInvestigationReport['boundary'] = 'none';

    for (let index = 0; index < OPERATION_DEFINITIONS.length; index += 1) {
      this.throwIfCancelled();

      const definition = OPERATION_DEFINITIONS[index];
      const progress = Math.min(99, Math.round(5 + (index / OPERATION_DEFINITIONS.length) * 95));
      onProgress?.(
        progress,
        `Running R5 probe ${index + 1}/${OPERATION_DEFINITIONS.length}: ${definition.label}...`,
      );

      const result = await this.runOutputProbe(
        sourceBytes,
        source.name,
        sourcePageCount,
        definition,
        onProgress,
        index,
      );

      operations.push(result);

      if (result.status !== 'passed') {
        boundary = result.probe;
        const skipped = OPERATION_DEFINITIONS.slice(index + 1).map((remaining) =>
          this.skippedResult(remaining.probe, remaining.args, result.probe),
        );
        operations.push(...skipped);
        break;
      }
    }

    onProgress?.(100, boundary === 'none'
      ? 'R5 investigation completed; all isolated output probes passed.'
      : `R5 investigation completed; first output boundary: ${boundary}.`);

    const report: QpdfRuntimeInvestigationReport = {
      schemaVersion: 4,
      generatedAt: new Date().toISOString(),
      sourceFileName: source.name,
      sourceFileBytes: source.size,
      sourcePageCount,
      sourceSha256,
      cacheHit: false,
      productionInterpretation: boundary === 'baseline-output' ? 'safe-output-boundary-observed' : 'output-capable',
      pageCountProbe,
      operations,
      cancelled: false,
      boundary,
      note:
        'R5 isolates PDF-output operations using a fresh qpdf-run invocation per probe. ' +
        'Baseline output is tested first, followed by independent single-capability probes. ' +
        'Browser JS memory observations are auxiliary evidence only; they are not measurements ' +
        'of qpdf Worker WASM peak memory. A skipped probe means an earlier output operation ' +
        'failed and later operations were intentionally not executed.',
    }
    this.reportCache.set(sourceSha256, report);
    return report;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.runtime.cancel();
  }

  private async runPageCountProbe(
    sourceBytes: ArrayBuffer,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<{ probe: QpdfInvestigationProbeResult; pageCount: number | null }> {
    this.throwIfCancelled();

    const before = this.snapshotMemory();
    const started = performance.now();
    const inputName = 'r5-page-count-source.pdf';
    const outputName = 'r5-page-count.json';
    const args = ['--json', '--json-key=pages', inputName, outputName];

    onProgress?.(2, 'QPDF page-count probe: determining source page count...');

    try {
      const result = await this.runWithTimeout({
        inputs: { [inputName]: new Uint8Array(sourceBytes) },
        args,
        outputs: [outputName],
      }, INVESTIGATION_QPDF_TIMEOUT_MS);

      const after = this.snapshotMemory();
      const probe = this.toProbeResult(
        'page-count', result, performance.now() - started, before, after, outputName, args,
      );
      const pageCount = this.parsePageCountFromJson(result.outputs[outputName]);

      if (probe.status === 'passed' && pageCount === null) {
        return {
          probe: {
            ...probe,
            status: 'failed',
            errorMessage: 'qpdf page-count JSON did not contain a valid pages array.',
            diagnosticCode: 'PAGE_COUNT_INVALID',
            recommendedAction: 'FIX_INPUT_OR_RUNTIME',
          },
          pageCount: null,
        };
      }

      return { probe, pageCount };
    } catch (error) {
      const after = this.snapshotMemory();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = this.isCancellation(error);
      const oom = this.isOomMessage(message);
      return {
        probe: this.errorProbe(
          'page-count', args, message, cancelled, oom, started, before, after, error,
        ),
        pageCount: null,
      };
    }
  }

  private async runOutputProbe(
    sourceBytes: ArrayBuffer,
    sourceName: string,
    pageCount: number,
    definition: {
      probe: Exclude<QpdfInvestigationProbe, 'page-count'>;
      label: string;
      args: readonly string[];
    },
    onProgress: ((progress: number, message: string) => void) | undefined,
    index: number,
  ): Promise<QpdfInvestigationProbeResult> {
    this.throwIfCancelled();

    const inputName = `r5-${pageCount}.pdf`;
    const outputName = `r5-${definition.probe}.pdf`;
    const args = [inputName, ...definition.args, '--', outputName];
    const before = this.snapshotMemory();
    const started = performance.now();

    onProgress?.(
      Math.min(99, 5 + Math.round((index / OPERATION_DEFINITIONS.length) * 95) + 1),
      `Executing ${definition.label}...`,
    );

    try {
      const result = await this.runWithTimeout({
        inputs: { [inputName]: new Uint8Array(sourceBytes) },
        args,
        outputs: [outputName],
      }, INVESTIGATION_QPDF_TIMEOUT_MS);

      const after = this.snapshotMemory();
      return this.toProbeResult(
        definition.probe,
        result,
        performance.now() - started,
        before,
        after,
        outputName,
        args,
      );
    } catch (error) {
      const after = this.snapshotMemory();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = this.isCancellation(error);
      const oom = this.isOomMessage(message);
      return this.errorProbe(
        definition.probe,
        args,
        message,
        cancelled,
        oom,
        started,
        before,
        after,
        error,
      );
    }
  }

  private async runWithTimeout(
    request: QpdfRunRequest,
    timeoutMs: number,
  ): Promise<QpdfRunResult> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const operation = this.runtime.run(request);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        void this.runtime.cancel();
        reject(new Error(`QPDF-R5 probe timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  private async sha256(bytes: ArrayBuffer): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      // The investigation remains usable without a digest; a deterministic
      // fallback is deliberately scoped to this in-memory session cache.
      let hash = 2166136261;
      const view = new Uint8Array(bytes);
      for (const byte of view) hash = Math.imul(hash ^ byte, 16777619);
      return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private parsePageCountFromJson(bytes: Uint8Array | undefined): number | null {
    if (!bytes || bytes.byteLength === 0) return null;
    try {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as { pages?: unknown };
      if (!Array.isArray(json.pages)) return null;
      const pageCount = json.pages.length;
      return Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null;
    } catch {
      return null;
    }
  }

  private toProbeResult(
    probe: QpdfInvestigationProbe,
    result: QpdfRunResult,
    durationMs: number,
    before: QpdfMemorySnapshot,
    after: QpdfMemorySnapshot,
    outputName: string,
    args: readonly string[],
  ): QpdfInvestigationProbeResult {
    const stderr = result.stderr.map(line => this.sanitize(line));
    const warnings = result.warnings.map(line => this.sanitize(line));
    const stdout = result.stdout.map(line => this.sanitize(line));
    const successful = result.ok && result.exitCode === 0 && !!result.outputs[outputName];
    const oom = [...stderr, ...warnings, ...stdout].some(line => this.isOomMessage(line));

    return {
      probe,
      status: successful ? 'passed' : oom ? 'oom' : 'failed',
      durationMs,
      exitCode: result.exitCode,
      outputBytes: result.outputs[outputName]?.byteLength ?? null,
      stderr,
      warnings,
      stdout,
      errorMessage: successful
        ? null
        : oom
          ? 'QPDF PDF-output generation exhausted browser WASM memory (observed OOM). The remaining PDF-output probes are intentionally stopped.'
          : stderr[0] ?? warnings[0] ?? 'qpdf returned a non-zero result or no output.',
      diagnosticCode: successful ? 'NONE' : oom ? 'QPDF_MEMORY_EXHAUSTED' : result.outputs[outputName] ? 'QPDF_RUN_FAILED' : 'QPDF_NO_OUTPUT',
      recommendedAction: successful ? 'CONTINUE_PROBES' : oom ? 'STOP_QPDF_OUTPUT_FOR_WORKLOAD' : 'FIX_INPUT_OR_RUNTIME',
      runtimePhase: null,
      memoryBefore: before,
      memoryAfter: after,
      args: [...args],
    };
  }

  private errorProbe(
    probe: QpdfInvestigationProbe,
    args: readonly string[],
    message: string,
    cancelled: boolean,
    oom: boolean,
    started: number,
    before: QpdfMemorySnapshot,
    after: QpdfMemorySnapshot,
    error: unknown,
  ): QpdfInvestigationProbeResult {
    return {
      probe,
      status: cancelled ? 'cancelled' : oom ? 'oom' : 'failed',
      durationMs: performance.now() - started,
      exitCode: null,
      outputBytes: null,
      stderr: [],
      warnings: [],
      stdout: [],
      errorMessage: cancelled
        ? 'QPDF-R5 investigation was cancelled.'
        : oom
          ? 'QPDF PDF-output generation exhausted browser WASM memory (observed OOM). The remaining PDF-output probes are intentionally stopped.'
          : this.sanitize(message),
      diagnosticCode: cancelled ? 'CANCELLED' : oom ? 'QPDF_MEMORY_EXHAUSTED' : 'QPDF_RUN_FAILED',
      recommendedAction: cancelled ? 'CANCELLED' : oom ? 'STOP_QPDF_OUTPUT_FOR_WORKLOAD' : 'FIX_INPUT_OR_RUNTIME',
      runtimePhase: this.runtimePhase(error),
      memoryBefore: before,
      memoryAfter: after,
      args: [...args],
    };
  }

  private skippedResult(
    probe: Exclude<QpdfInvestigationProbe, 'page-count'>,
    args: readonly string[],
    boundary: QpdfInvestigationProbe,
  ): QpdfInvestigationProbeResult {
    const memory = this.snapshotMemory();
    return {
      probe,
      status: 'skipped',
      durationMs: null,
      exitCode: null,
      outputBytes: null,
      stderr: [],
      warnings: [],
      stdout: [],
      errorMessage: `Intentionally skipped after ${boundary} established the first PDF-output boundary.`,
      diagnosticCode: 'NONE',
      recommendedAction: 'STOP_QPDF_OUTPUT_FOR_WORKLOAD',
      runtimePhase: null,
      memoryBefore: memory,
      memoryAfter: memory,
      args: [...args],
    };
  }

  private snapshotMemory(): QpdfMemorySnapshot {
    const performanceWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const memory = performanceWithMemory.memory;
    return {
      timestamp: new Date().toISOString(),
      jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: memory?.totalJSHeapSize ?? null,
      jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
      deviceMemoryGb: 'deviceMemory' in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? NaN) || null
        : null,
    };
  }

  private runtimePhase(error: unknown): QpdfInvestigationProbeResult['runtimePhase'] {
    const phase = error instanceof Error ? (error as Error & { phase?: unknown }).phase : null;
    return phase === 'runner-create' || phase === 'runner-run' || phase === 'runner-destroy' ? phase : null;
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof Error && (/cancelled/i.test(error.name) || /cancelled/i.test(error.message));
  }

  private isOomMessage(message: string): boolean {
    return /(?:out[ -]?of[ -]?memory|\boom\b|memory exhaustion|cannot enlarge memory|aborted\(oom\))/i.test(message);
  }

  private sanitize(value: string): string {
    return value
      .replace(/[A-Za-z]:\\[^\r\n]*/g, '<path>')
      .replace(/(?:file|blob|https?):\/\/[^\s]+/gi, '<resource>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('QPDF-R5 investigation was cancelled.');
  }
}

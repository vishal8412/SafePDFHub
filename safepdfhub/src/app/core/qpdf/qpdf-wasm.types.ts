export interface QpdfRunRequest {
  inputs: Record<string, Uint8Array>;
  args: readonly string[];
  outputs: readonly string[];
}

export interface QpdfRunResult {
  ok: boolean;
  outputs: Record<string, Uint8Array>;
  stdout: readonly string[];
  stderr: readonly string[];
  warnings: readonly string[];
  exitCode: number | null;
  durationMs: number;
}

/**
 * SafePDFHub abstraction around the concrete qpdf WASM runtime.
 *
 * This deliberately does not expose qpdf-run's internal types.
 */
export interface QpdfWasmRunner {
  run(
    request: QpdfRunRequest
  ): Promise<QpdfRunResult>;

  destroy?(): Promise<void> | void;
}

export interface QpdfWasmRunnerFactory {
  create(): Promise<QpdfWasmRunner>;
}
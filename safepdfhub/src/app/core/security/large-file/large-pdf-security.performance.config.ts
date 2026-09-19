export type LargePdfSecurityPerformanceProfile =
  | 'default'
  | 'fast-write'
  | 'fast-aes-128';

export type LargePdfSecurityWasmRuntime = 'published' | 'performance';

/** Exact qpdf build expected by the Phase 1.5F-F1.2 performance runtime. */
export const LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION = '12.4.1';
export const LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER = 'openssl';

/** F3 diagnostics are opt-in and never enabled for normal Protect requests. */
export const LARGE_PDF_SECURITY_F3_PROFILE_ENABLED = true;
export const LARGE_PDF_SECURITY_F3_RAW_AES_DEFAULT_TOTAL_MIB = 64;
export const LARGE_PDF_SECURITY_F3_RAW_AES_DEFAULT_BUFFER_BYTES = 262144;
export const LARGE_PDF_SECURITY_F3_RAW_AES_ALLOWED_BUFFERS = [16384, 65536, 262144, 1048576, 4194304] as const;
/** PDF stream-level parallelism remains disabled until qpdf writer safety is proven. */
export const LARGE_PDF_SECURITY_F3_STREAM_PARALLELISM_ENABLED = false;

/** F2 bulk AES-CBC tuning metadata; kept in sync with the performance WASM build. */
export const LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED = true;
export const LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES = 262144;
/** Performance benchmarks must never silently fall back to the published runtime. */
export const LARGE_PDF_SECURITY_STRICT_PERFORMANCE_RUNTIME = true;

/** Keep the known 15 MiB regression on the published/default writer profile. */
export const LARGE_PDF_SECURITY_FAST_WRITE_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** qpdf's documented stream-data=preserve equivalent. */
export const LARGE_PDF_SECURITY_FAST_WRITE_QPDF_ARGS = [
  '--compress-streams=n',
  '--decode-level=none'
] as const;

/** Bound Worker -> OPFS transfer buffers without creating a main-thread giant buffer. */
export const LARGE_PDF_SECURITY_OUTPUT_CHUNK_BYTES = 32 * 1024 * 1024;

/**
 * The performance runtime is a separately built qpdf WASM artifact.
 * For the Phase 1.5F-F1.2 benchmark path, a missing/invalid artifact is a
 * hard failure so benchmark results can never be mislabeled as performance runs.
 */
export const LARGE_PDF_SECURITY_PERFORMANCE_WASM_JS_ASSET =
  'assets/qpdf/qpdf-performance.js';

export const LARGE_PDF_SECURITY_PERFORMANCE_WASM_BINARY_ASSET =
  'assets/qpdf/qpdf-performance.wasm';

export function selectLargePdfSecurityPerformanceProfile(
  inputBytes: number,
  requestedBits: 128 | 256 = 256,
  largeFilePerformance: 'balanced' | 'fast' = 'balanced'
): LargePdfSecurityPerformanceProfile {
  if (inputBytes < LARGE_PDF_SECURITY_FAST_WRITE_THRESHOLD_BYTES) return 'default';

  if (largeFilePerformance === 'fast' && requestedBits === 128) {
    return 'fast-aes-128';
  }

  return 'fast-write';
}

export function resolveLargePdfSecurityBits(
  inputBytes: number,
  requestedBits: 128 | 256 | undefined,
  largeFilePerformance: 'balanced' | 'fast' = 'balanced'
): 128 | 256 {
  const requested = requestedBits ?? 256;
  return largeFilePerformance === 'fast'
    && inputBytes >= LARGE_PDF_SECURITY_FAST_WRITE_THRESHOLD_BYTES
    && requestedBits === undefined
    ? 128
    : requested;
}

export function selectLargePdfSecurityWasmRuntime(
  _inputBytes: number,
  _largeFilePerformance: 'balanced' | 'fast' = 'balanced'
): LargePdfSecurityWasmRuntime {
  /*
   * Phase 1.5F owns a standalone qpdf runtime. Using it for every invocation
   * of the large-file security engine avoids bundling the legacy CommonJS
   * @neslinesli93/qpdf-wasm package into Angular's module Worker.
   *
   * The custom build is qpdf 12.4.1 + OpenSSL 3.5.1 and supports both AES-128
   * and AES-256. The writer profile remains independently selected above.
   */
  return 'performance';
}

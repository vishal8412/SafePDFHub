import type {
  LargePdfSecurityWorkerMessage,
  LargePdfSecurityWorkerResponse,
  LargePdfSecurityWorkerRequest,
  LargePdfSecurityProgressPhase,
  LargePdfSecurityPhaseTiming,
  LargePdfSecurityF3RawAesBenchmarkRequest,
  LargePdfSecurityF3RawAesBenchmarkResult
} from './large-pdf-security.protocol';
import {
  LARGE_PDF_SECURITY_FAST_WRITE_QPDF_ARGS,
  LARGE_PDF_SECURITY_OUTPUT_CHUNK_BYTES,
  LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION,
  LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
  LARGE_PDF_SECURITY_STRICT_PERFORMANCE_RUNTIME,
  LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED,
  LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES,
  LARGE_PDF_SECURITY_F3_PROFILE_ENABLED
} from './large-pdf-security.performance.config';

interface QpdfModuleInitOptions {
  readonly noInitialRun?: boolean;
  readonly locateFile?: () => string;
  readonly print?: (line: string) => void;
  readonly printErr?: (line: string) => void;
}

type QpdfModuleFactory = (
  options?: QpdfModuleInitOptions
) => Promise<QpdfModuleLike>;

interface QpdfModuleLike {
  FS: {
    mkdir(path: string): void;
    mount(type: unknown, options: { files: File[]; blobs: Blob[] }, mountpoint: string): void;
    unmount(path: string): void;
    readFile(path: string, options?: { encoding?: 'binary' | 'utf8' }): Uint8Array | string;
    open(path: string, flags: string, mode?: number): number;
    read(stream: number, buffer: Uint8Array, offset: number, length: number, position?: number): number;
    close(stream: number): void;
    unlink(path: string): void;
    readdir(path: string): string[];
    stat(path: string): { size: number };
  };
  WORKERFS: unknown;
  callMain(args: string[]): number;
  ENV?: Record<string, string>;
  _safepdfhubF3RawAesBenchmark?: (providerId: number, bits: number, bufferBytes: number, totalMiB: number, bulk: number) => number;
  _safepdfhubF3RawAesChecksum?: () => number;
  quit?: () => void;
}

let cancelled = false;
let activeModule: QpdfModuleLike | null = null;
let activeWasmRuntime: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime = 'published';
let activePhaseTimings: LargePdfSecurityPhaseTiming[] = [];
let activeRuntimeInfo: import('./large-pdf-security.protocol').LargePdfSecurityRuntimeInfo = emptyRuntimeInfo(false);

self.onmessage = async (event: MessageEvent<LargePdfSecurityWorkerMessage>) => {
  const message = event.data;

  if (message.type === 'CANCEL') {
    cancelled = true;
    // qpdf CLI work is synchronous inside callMain. The hard cancellation
    // boundary is the host Worker, which the service terminates if needed.
    return;
  }

  cancelled = false;

  try {
    if (message.type === 'RUN-F3-RAW-AES') {
      post(await runF3RawAesBenchmark(message));
      return;
    }

    const response = await run(message);
    post(response);
  } catch (error: unknown) {
    if (cancelled) {
      post({ type: 'CANCELLED' });
      return;
    }

    const qpdfError = error instanceof QpdfWorkerFailure ? error : null;
    const messageText = error instanceof Error ? error.message : String(error);
    post({
      type: 'ERROR',
      message: messageText,
      stderr: qpdfError?.stderr ?? [],
      stdout: qpdfError?.stdout ?? [],
      exitCode: qpdfError?.exitCode ?? null,
      phaseTimings: activePhaseTimings,
      performanceProfile: 'performanceProfile' in message ? message.performanceProfile : undefined,
      wasmRuntime: activeWasmRuntime,
      runtimeInfo: activeRuntimeInfo
    });
  } finally {
    activeModule = null;
    activePhaseTimings = [];
  }
};

interface LoadedQpdfRuntime {
  readonly factory: QpdfModuleFactory;
  readonly runtime: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime;
  /** WASM URL that matches the selected JS factory. */
  readonly wasmUrl: string;
}

async function loadQpdfModuleFactory(
  request: LargePdfSecurityWorkerRequest
): Promise<LoadedQpdfRuntime> {
  if (!request.qpdfJsUrl || !request.wasmUrl) {
    throw new Error(
      'Phase 1.5F-F1.2 performance qpdf runtime assets are missing. ' +
      'The module worker requires qpdf-performance.js and qpdf-performance.wasm.'
    );
  }

  await validateWasmAsset(request.wasmUrl);

  // The binary header has already been verified at this point. Preserve that
  // fact in the diagnostic payload even if a later runtime probe fails.
  activeRuntimeInfo = {
    ...activeRuntimeInfo,
    expectedQpdfVersion: LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION,
    expectedCryptoProvider: LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
    wasmHeaderValid: true,
    strictValidation: LARGE_PDF_SECURITY_STRICT_PERFORMANCE_RUNTIME,
    bulkAesEnabled: LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED,
    bulkAesBufferBytes: LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES
  };

  /*
   * IMPORTANT: do not import @neslinesli93/qpdf-wasm here. That package is
   * CommonJS and its qpdf.js contains Node-only fs/path requires. Angular 21
   * statically analyzes Worker imports and therefore attempts to bundle those
   * Node built-ins, which breaks the browser build.
   *
   * The Phase 1.5F custom qpdf runtime is a standalone browser asset and is
   * loaded at runtime as an ES module instead.
   */
  const performanceModule = await import(/* @vite-ignore */ request.qpdfJsUrl) as {
    readonly SafePDFHubQpdfFactory?: unknown;
    readonly default?: unknown;
  };

  const performanceFactory =
    performanceModule.SafePDFHubQpdfFactory ??
    performanceModule.default;

  if (typeof performanceFactory !== 'function') {
    throw new Error(
      'Phase 1.5F-F1.2 performance qpdf JS asset did not export SafePDFHubQpdfFactory.'
    );
  }

  activeWasmRuntime = 'performance';
  return {
    factory: performanceFactory as QpdfModuleFactory,
    runtime: 'performance',
    wasmUrl: request.wasmUrl
  };
}

async function validateWasmAsset(wasmUrl: string): Promise<void> {
  if (!wasmUrl) throw new Error('Performance qpdf WASM URL is missing.');
  const response = await fetch(wasmUrl, { cache: 'no-store' });
  const contentType = response.headers.get('content-type') ?? 'unknown';
  if (!response.ok) {
    throw new Error(`Performance qpdf WASM request returned HTTP ${response.status} (${contentType}). URL: ${wasmUrl}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const valid = bytes.length >= 8
    && bytes[0] === 0x00
    && bytes[1] === 0x61
    && bytes[2] === 0x73
    && bytes[3] === 0x6d
    && bytes[4] === 0x01;
  if (!valid) {
    const preview = new TextDecoder().decode(bytes.slice(0, 32)).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Performance qpdf WASM asset is not a valid WebAssembly binary `
      + `(HTTP ${response.status}, content-type ${contentType}, ${bytes.length} bytes; `
      + `first bytes: ${preview || 'empty'}; URL: ${wasmUrl}).`
    );
  }
}

async function createQpdfModuleWithPerformanceRuntime(
  request: LargePdfSecurityWorkerRequest,
  stdout: string[],
  stderr: string[]
): Promise<{ module: QpdfModuleLike; runtime: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime }> {
  const selected = await loadQpdfModuleFactory(request);

  if (selected.runtime !== 'performance') {
    throw new Error('Phase 1.5F-F1.2 requires the custom performance qpdf runtime.');
  }

  const module = await selected.factory({
    noInitialRun: true,
    locateFile: () => selected.wasmUrl,
    print: (line: string) => stdout.push(line),
    printErr: (line: string) => stderr.push(line)
  }) as unknown as QpdfModuleLike;

  if (module.ENV) {
    module.ENV['QPDF_F3_PROFILE'] = request.enableF3Diagnostics && LARGE_PDF_SECURITY_F3_PROFILE_ENABLED ? '1' : '0';
  }
  activeRuntimeInfo = await validatePerformanceRuntime(module, stdout, stderr);
  return { module, runtime: selected.runtime };
}

async function validatePerformanceRuntime(
  module: QpdfModuleLike,
  stdout: string[],
  stderr: string[],
  expectedProvider: string = LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
  requireDefaultProvider = true
): Promise<import('./large-pdf-security.protocol').LargePdfSecurityRuntimeInfo> {
  const stdoutStart = stdout.length;
  const stderrStart = stderr.length;
  if (module.ENV) {
    module.ENV['QPDF_CRYPTO_PROVIDER'] = expectedProvider;
  }

  let versionExit = 0;
  try {
    versionExit = module.callMain(['--version']);
  } catch (error) {
    throw new Error(`Performance qpdf --version probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (versionExit !== 0) throw new Error(`Performance qpdf --version exited with code ${versionExit}.`);

  const versionOutput = stdout.slice(stdoutStart);
  const qpdfVersion = extractQpdfVersion(versionOutput);
  activeRuntimeInfo = {
    ...activeRuntimeInfo,
    qpdfVersion,
    expectedQpdfVersion: LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION,
    expectedCryptoProvider: LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
    wasmHeaderValid: true,
    strictValidation: LARGE_PDF_SECURITY_STRICT_PERFORMANCE_RUNTIME,
    bulkAesEnabled: LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED,
    bulkAesBufferBytes: LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES
  };
  if (qpdfVersion !== LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION) {
    throw new Error(`Performance qpdf version mismatch: expected ${LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION}, got ${qpdfVersion || 'unknown'}.`);
  }

  const cryptoStart = stdout.length;
  let cryptoExit = 0;
  try {
    cryptoExit = module.callMain(['--show-crypto']);
  } catch (error) {
    throw new Error(`Performance qpdf --show-crypto probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (cryptoExit !== 0) throw new Error(`Performance qpdf --show-crypto exited with code ${cryptoExit}.`);

  const cryptoProviders = stdout
    .slice(cryptoStart)
    .map(line => line.trim())
    .filter(Boolean);
  const defaultCryptoProvider = cryptoProviders[0] ?? null;
  activeRuntimeInfo = {
    ...activeRuntimeInfo,
    cryptoProviders,
    defaultCryptoProvider,
    expectedQpdfVersion: LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION,
    expectedCryptoProvider: LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
    wasmHeaderValid: true,
    strictValidation: LARGE_PDF_SECURITY_STRICT_PERFORMANCE_RUNTIME,
    bulkAesEnabled: LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED,
    bulkAesBufferBytes: LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES
  };
  if (!cryptoProviders.includes(expectedProvider)) {
    throw new Error(`Performance qpdf does not expose the required ${expectedProvider} crypto provider.`);
  }
  if (requireDefaultProvider && defaultCryptoProvider !== expectedProvider) {
    throw new Error(`Performance qpdf crypto provider mismatch: expected default ${expectedProvider}, got ${defaultCryptoProvider ?? 'none'}.`);
  }

  const stderrProbe = stderr.slice(stderrStart).filter(Boolean);
  if (stderrProbe.length) {
    console.warn('[SafePDFHub] qpdf runtime validation emitted stderr:', stderrProbe);
  }

  return {
    qpdfVersion,
    cryptoProviders,
    defaultCryptoProvider,
    expectedQpdfVersion: LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION,
    expectedCryptoProvider: LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER,
    wasmHeaderValid: true,
    strictValidation: true,
    bulkAesEnabled: LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED,
    bulkAesBufferBytes: LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES
  };
}

function extractQpdfVersion(lines: readonly string[]): string {
  // In a browser/Worker build qpdf can see Emscripten's synthetic argv[0]
  // (`./this.program`) instead of the native executable name. Consequently
  // `qpdf --version` may emit `this.program version 12.4.1` rather than
  // `qpdf version 12.4.1`. The version token is the stable part we must
  // validate; requiring the literal program name incorrectly rejects a valid
  // performance runtime.
  for (const line of lines) {
    const match = line.match(/\bversion\s+([0-9]+(?:\.[0-9]+){1,3})\b/i);
    if (match?.[1]) return match[1];
  }
  return '';
}

function emptyRuntimeInfo(strictValidation: boolean): import('./large-pdf-security.protocol').LargePdfSecurityRuntimeInfo {
  return {
    qpdfVersion: 'unknown',
    cryptoProviders: [],
    defaultCryptoProvider: null,
    expectedQpdfVersion: strictValidation ? LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION : null,
    expectedCryptoProvider: strictValidation ? LARGE_PDF_SECURITY_PERFORMANCE_CRYPTO_PROVIDER : null,
    wasmHeaderValid: false,
    strictValidation,
    bulkAesEnabled: strictValidation ? LARGE_PDF_SECURITY_F2_BULK_AES_ENABLED : undefined,
    bulkAesBufferBytes: strictValidation ? LARGE_PDF_SECURITY_F2_BULK_AES_BUFFER_BYTES : undefined
  };
}

async function run(request: LargePdfSecurityWorkerRequest): Promise<LargePdfSecurityWorkerWorkerResponse> {
  const startedAt = performance.now();
  activePhaseTimings = [];
  // Set the selected runtime before any validation so a strict performance
  // failure can never be mislabeled as the published runtime.
  activeWasmRuntime = request.wasmRuntime;
  activeRuntimeInfo = emptyRuntimeInfo(request.wasmRuntime === 'performance');
  const stdout: string[] = [];
  const stderr: string[] = [];

  post({ type: 'PROGRESS', progress: 2, phase: 'loading-engine', wasmRuntime: request.wasmRuntime });
  const loadingStartedAt = performance.now();
  let module: QpdfModuleLike;
  let actualWasmRuntime: import('./large-pdf-security.performance.config').LargePdfSecurityWasmRuntime;
  try {
    const loaded = await createQpdfModuleWithPerformanceRuntime(request, stdout, stderr);
    module = loaded.module;
    actualWasmRuntime = loaded.runtime;
    activeWasmRuntime = actualWasmRuntime;
  } finally {
    activePhaseTimings.push({
      phase: 'loading-engine',
      durationMs: performance.now() - loadingStartedAt
    });
  }
  activeModule = module;

  post({ type: 'PROGRESS', progress: 10, phase: 'mounting-input', wasmRuntime: actualWasmRuntime });

  const mountingStartedAt = performance.now();
  const root = `/safepdfhub-large-${Date.now()}`;
  const inputMount = `${root}/input`;
  try {
    module.FS.mkdir(root);
    module.FS.mkdir(inputMount);
    module.FS.mount(module.WORKERFS, { files: [request.file], blobs: [] }, inputMount);

    // WORKERFS exposes the supplied File under its actual File.name. Discover
    // that mounted entry instead of inventing a synthetic filename; this avoids
    // asking qpdf to open a path that does not exist in the WORKERFS mount.
    const mountedEntries = module.FS.readdir(inputMount).filter(entry => entry !== '.' && entry !== '..');
    if (mountedEntries.length !== 1) {
      throw new Error('The selected PDF could not be resolved inside the Worker input filesystem.');
    }
    const inputPath = `${inputMount}/${mountedEntries[0]}`;
    const outputPath = `${root}/${request.outputName}`;
    const args = buildArgs(request, inputPath, outputPath);

    activePhaseTimings.push({
      phase: 'mounting-input',
      durationMs: performance.now() - mountingStartedAt
    });

    post({ type: 'PROGRESS', progress: 18, phase: 'encrypting', wasmRuntime: actualWasmRuntime });

    const encryptingStartedAt = performance.now();
    let exitCode = 0;
    let encryptingDurationMs = 0;
    try {
      exitCode = module.callMain(args);
    } catch (error: unknown) {
      const failure = new QpdfWorkerFailure(
        error instanceof Error ? error.message : String(error),
        typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 1
      );
      failure.stderr = stderr;
      failure.stdout = stdout;
      throw failure;
    } finally {
      encryptingDurationMs = performance.now() - encryptingStartedAt;
      activePhaseTimings.push({
        phase: 'encrypting',
        durationMs: encryptingDurationMs
      });
    }

    if (request.enableF3Diagnostics) {
      const f3 = parseF3Profile(stdout);
      activeRuntimeInfo = {
        ...activeRuntimeInfo,
        f3ProfileEnabled: f3.calls > 0,
        f3AesCalls: f3.calls,
        f3AesBytes: f3.bytes,
        f3AesElapsedUs: f3.elapsedUs,
        f3AesThroughputMiBPerSecond: f3.elapsedUs > 0 ? (f3.bytes / (1024 * 1024)) / (f3.elapsedUs / 1_000_000) : 0,
        f3NonCryptoEncryptMs: Math.max(0, encryptingDurationMs - f3.elapsedUs / 1000),
        f3ParallelismExperiment: 'disabled-safe-default'
      };
    }

    post({ type: 'PROGRESS', progress: 90, phase: 'writing-output', wasmRuntime: actualWasmRuntime, runtimeInfo: activeRuntimeInfo });

    if (cancelled) {
      throw new Error('cancelled');
    }

    if (exitCode !== 0) {
      const failure = new QpdfWorkerFailure(`qpdf exited with code ${exitCode}.`, exitCode);
      failure.stderr = stderr;
      failure.stdout = stdout;
      throw failure;
    }

    const writingStartedAt = performance.now();
    const outputHeaderValid = hasPdfHeader(module, outputPath);
    const outputPathInOpfs = `safepdfhub/security/${crypto.randomUUID()}/${request.outputName}`;
    let outputSize = 0;
    try {
      outputSize = await streamQpdfOutputToOpfs(
        module,
        outputPath,
        outputPathInOpfs,
        request.outputName
      );
    } finally {
      activePhaseTimings.push({
        phase: 'writing-output',
        durationMs: performance.now() - writingStartedAt
      });
    }

    const finalizingStartedAt = performance.now();
    try {
      try {
        module.FS.unlink(outputPath);
      } catch {
        // Cleanup is best-effort. The Worker is discarded after completion.
      }

      try {
        module.FS.unmount(inputMount);
      } catch {
        // Cleanup is best-effort.
      }
    } finally {
      activePhaseTimings.push({
        phase: 'finalizing',
        durationMs: performance.now() - finalizingStartedAt
      });
    }

    post({ type: 'PROGRESS', progress: 100, phase: 'finalizing', wasmRuntime: actualWasmRuntime });

    return {
      type: 'COMPLETE',
      outputPath: outputPathInOpfs,
      outputName: request.outputName,
      outputSize,
      outputHeaderValid,
      durationMs: performance.now() - startedAt,
      phaseTimings: activePhaseTimings,
      performanceProfile: request.performanceProfile,
      wasmRuntime: actualWasmRuntime,
      runtimeInfo: activeRuntimeInfo
    };
  } finally {
    // Keep the outer mount phase measurable even when mount resolution fails.
    if (!activePhaseTimings.some(timing => timing.phase === 'mounting-input')) {
      activePhaseTimings.push({
        phase: 'mounting-input',
        durationMs: performance.now() - mountingStartedAt
      });
    }
  }
}

function hasPdfHeader(module: QpdfModuleLike, outputPath: string): boolean {
  const stream = module.FS.open(outputPath, 'r');
  const header = new Uint8Array(5);
  try {
    const read = module.FS.read(stream, header, 0, header.byteLength, 0);
    return read === 5
      && header[0] === 0x25
      && header[1] === 0x50
      && header[2] === 0x44
      && header[3] === 0x46
      && header[4] === 0x2D;
  } finally {
    try {
      module.FS.close(stream);
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function streamQpdfOutputToOpfs(
  module: QpdfModuleLike,
  qpdfOutputPath: string,
  opfsPath: string,
  outputName: string
): Promise<number> {
  if (!navigator.storage?.getDirectory) {
    throw new Error('Origin Private File System is unavailable in this browser.');
  }

  const root = await navigator.storage.getDirectory();
  const segments = opfsPath.split('/');
  const fileName = segments.pop()!;
  let directory = root;

  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const accessHandle = await fileHandle.createSyncAccessHandle();
  const stream = module.FS.open(qpdfOutputPath, 'r');
  const outputSize = module.FS.stat(qpdfOutputPath).size;
  const chunk = new Uint8Array(LARGE_PDF_SECURITY_OUTPUT_CHUNK_BYTES);
  let position = 0;
  let lastReportedBytes = 0;
  let lastReportedAt = performance.now();

  try {
    accessHandle.truncate(0);

    post({
      type: 'PROGRESS',
      progress: 90,
      phase: 'writing-output',
      outputSize,
      outputName,
      outputBytesWritten: 0
    });

    while (true) {
      const read = module.FS.read(stream, chunk, 0, chunk.byteLength, position);
      if (read <= 0) break;

      const written = accessHandle.write(chunk.subarray(0, read), { at: position });
      if (written !== read) {
        throw new Error('Large PDF output could not be fully written to local storage.');
      }

      position += read;

      const now = performance.now();
      if (
        position === outputSize
        || position - lastReportedBytes >= LARGE_PDF_SECURITY_OUTPUT_CHUNK_BYTES
        || now - lastReportedAt >= 250
      ) {
        const writeProgress = outputSize > 0
          ? 90 + Math.min(9, Math.floor((position / outputSize) * 9))
          : 90;

        post({
          type: 'PROGRESS',
          progress: writeProgress,
          phase: 'writing-output',
          outputSize,
          outputName,
          outputBytesWritten: position
        });

        lastReportedBytes = position;
        lastReportedAt = now;
      }

      if (cancelled) {
        throw new Error('cancelled');
      }
    }

    accessHandle.flush();
    return position;
  } finally {
    try {
      module.FS.close(stream);
    } catch {
      // Best-effort cleanup.
    }
    accessHandle.close();
  }
}

function parseF3Profile(lines: readonly string[]): { calls: number; bytes: number; elapsedUs: number } {
  let calls = 0;
  let bytes = 0;
  let elapsedUs = 0;
  const pattern = /^SAFEPDFHUB_F3_AES\s+.*?bytes=(\d+)\s+elapsed_us=(\d+)\s+calls=(\d+)$/;
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (!match) continue;
    bytes += Number(match[1]);
    elapsedUs += Number(match[2]);
    calls += Number(match[3]);
  }
  return { calls, bytes, elapsedUs };
}

async function runF3RawAesBenchmark(
  request: LargePdfSecurityF3RawAesBenchmarkRequest
): Promise<LargePdfSecurityWorkerResponse> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const loaded = await loadQpdfModuleFactory(request as unknown as LargePdfSecurityWorkerRequest);
  const module = await loaded.factory({
    noInitialRun: true,
    locateFile: () => loaded.wasmUrl,
    print: (line: string) => stdout.push(line),
    printErr: (line: string) => stderr.push(line)
  }) as unknown as QpdfModuleLike;
  if (module.ENV) {
    module.ENV['QPDF_CRYPTO_PROVIDER'] = request.provider;
    module.ENV['QPDF_F3_PROFILE'] = '0';
  }
  await validatePerformanceRuntime(module, stdout, stderr, request.provider, false);
  const benchmark = module._safepdfhubF3RawAesBenchmark;
  if (!benchmark) throw new Error('F3 raw AES benchmark export is missing from qpdf-performance.wasm.');
  const providerId = request.provider === 'openssl' ? 0 : 1;
  const elapsedMs = benchmark(providerId, request.bits, request.bufferBytes, request.totalMiB, request.bulk ? 1 : 0);
  if (!(elapsedMs > 0)) throw new Error(`F3 raw AES benchmark failed (provider=${request.provider}, bits=${request.bits}, bulk=${request.bulk}).`);
  const checksum = module._safepdfhubF3RawAesChecksum?.() ?? 0;
  const result: LargePdfSecurityF3RawAesBenchmarkResult = {
    provider: request.provider,
    bits: request.bits,
    bufferBytes: request.bufferBytes,
    totalMiB: request.totalMiB,
    bulk: request.bulk,
    elapsedMs,
    throughputMiBPerSecond: request.totalMiB / (elapsedMs / 1000),
    checksum,
    qpdfVersion: LARGE_PDF_SECURITY_PERFORMANCE_QPDF_VERSION
  };
  try { module.quit?.(); } catch { /* best-effort */ }
  return { type: 'F3_RAW_AES_COMPLETE', result };
}

function buildArgs(
  request: LargePdfSecurityWorkerRequest,
  inputPath: string,
  outputPath: string
): string[] {
  switch (request.mode) {
    case 'protect':
      if (!request.userPassword || !request.ownerPassword || !request.permissions) {
        throw new Error('Protect PDF request is incomplete.');
      }

      return [
        // IMPORTANT: qpdf's --encrypt ... -- section parses encryption options
        // until the standalone "--". Stream-transformation options must be
        // placed before --encrypt, not inside that section. The previous
        // placement caused large fast-write jobs to exit with code 2 before
        // reading the PDF.
        ...((request.performanceProfile === 'fast-write' || request.performanceProfile === 'fast-aes-128') ? LARGE_PDF_SECURITY_FAST_WRITE_QPDF_ARGS : []),
        '--encrypt',
        `--user-password=${request.userPassword}`,
        `--owner-password=${request.ownerPassword}`,
        `--bits=${request.bits ?? 256}`,
        ...(request.bits === 128 ? ['--use-aes=y'] : []),
        `--print=${request.permissions.allowPrinting ? 'full' : 'none'}`,
        `--extract=${request.permissions.allowCopying ? 'y' : 'n'}`,
        `--modify=${request.permissions.allowModifying ? 'all' : 'none'}`,
        `--annotate=${request.permissions.allowAnnotations ? 'y' : 'n'}`,
        `--form=${request.permissions.allowForms ? 'y' : 'n'}`,
        `--assemble=${request.permissions.allowAssembly ? 'y' : 'n'}`,
        '--',
        inputPath,
        outputPath
      ];

    case 'unlock':
    case 'remove-password':
      if (!request.password) {
        throw new Error('PDF password is required.');
      }

      return [
        ...((request.performanceProfile === 'fast-write' || request.performanceProfile === 'fast-aes-128') ? LARGE_PDF_SECURITY_FAST_WRITE_QPDF_ARGS : []),
        `--password=${request.password}`,
        '--decrypt',
        '--',
        inputPath,
        outputPath
      ];
  }
}

function post(message: LargePdfSecurityWorkerResponse): void {
  // The large output stays in OPFS; only small metadata crosses the Worker boundary.
  self.postMessage(message);
}

class QpdfWorkerFailure extends Error {
  stderr: readonly string[] = [];
  stdout: readonly string[] = [];

  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = 'QpdfWorkerFailure';
  }
}

type LargePdfSecurityWorkerWorkerResponse = LargePdfSecurityWorkerResponse;

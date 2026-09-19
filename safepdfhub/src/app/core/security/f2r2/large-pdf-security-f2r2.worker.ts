import type {
  LargePdfSecurityF2R2Request,
  LargePdfSecurityF2R2Response
} from './large-pdf-security-f2r2.protocol';

interface QpdfModule {
  readonly FS: {
    mkdir(path: string): void;
    mount(type: unknown, options: { files: File[]; blobs: Blob[] }, mountpoint: string): void;
    unmount(path: string): void;
    readFile(path: string, options?: { encoding?: 'binary' | 'utf8' }): Uint8Array | string;
    open(path: string, flags: string, mode?: number): number;
    read(stream: number, buffer: Uint8Array, offset: number, length: number, position?: number): number;
    close(stream: number): void;
    unlink(path: string): void;
    stat(path: string): { size: number };
    readdir(path: string): string[];
  };
  readonly WORKERFS: unknown;
  callMain(args: string[]): number;
}

type QpdfFactory = (options?: {
  readonly noInitialRun?: boolean;
  readonly locateFile?: () => string;
  readonly print?: (line: string) => void;
  readonly printErr?: (line: string) => void;
}) => Promise<QpdfModule>;

self.onmessage = async (event: MessageEvent<LargePdfSecurityF2R2Request>) => {
  if (event.data.type !== 'RUN-F2R2-PDF') return;

  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const result = await run(event.data, stdout, stderr);
    post({ type: 'F2R2_COMPLETE', result });
  } catch (error) {
    post({
      type: 'F2R2_ERROR',
      message: error instanceof Error ? error.message : String(error),
      stdout,
      stderr
    });
  }
};

async function run(
  request: LargePdfSecurityF2R2Request,
  stdout: string[],
  stderr: string[]
): Promise<import('./large-pdf-security-f2r2.protocol').LargePdfSecurityF2R2Result> {
  if (request.file.size > 100 * 1024 * 1024) {
    throw new Error('F2-R.2 validation is intentionally limited to 100 MiB until the isolated candidate passes the correctness gates.');
  }

  post({ type: 'F2R2_PROGRESS', progress: 5, phase: 'loading' });

  const [referenceFactory, candidateFactory] = await Promise.all([
    loadFactory(request.referenceJsUrl, request.referenceWasmUrl, 'SafePDFHubQpdfFactory'),
    loadFactory(request.candidateJsUrl, request.candidateWasmUrl, 'SafePDFHubQpdfF2R2CandidateFactory')
  ]);

  const reference = await referenceFactory({
    noInitialRun: true,
    locateFile: () => request.referenceWasmUrl,
    print: line => stdout.push(line),
    printErr: line => stderr.push(line)
  });
  const candidate = await candidateFactory({
    noInitialRun: true,
    locateFile: () => request.candidateWasmUrl,
    print: line => stdout.push(line),
    printErr: line => stderr.push(line)
  });

  const qpdfVersion = probeVersion(reference, stdout, stderr);
  if (qpdfVersion !== '12.4.1') {
    throw new Error(`F2-R.2 reference qpdf version mismatch: expected 12.4.1, got ${qpdfVersion || 'unknown'}.`);
  }

  post({ type: 'F2R2_PROGRESS', progress: 20, phase: 'reference' });
  const referenceRun = runEncryption(reference, request, 'reference', stdout, stderr);

  post({ type: 'F2R2_PROGRESS', progress: 55, phase: 'candidate' });
  const candidateRun = runEncryption(candidate, request, 'candidate', stdout, stderr);

  post({ type: 'F2R2_PROGRESS', progress: 82, phase: 'compare' });
  const comparison = compareFiles(reference, referenceRun.outputPath, candidate, candidateRun.outputPath);

  post({ type: 'F2R2_PROGRESS', progress: 90, phase: 'check' });
  const referenceCheck = checkPdf(reference, referenceRun.outputPath, stdout, stderr);
  const candidateCheck = checkPdf(candidate, candidateRun.outputPath, stdout, stderr);

  return {
    inputBytes: request.file.size,
    bits: request.bits,
    referenceElapsedMs: referenceRun.elapsedMs,
    candidateElapsedMs: candidateRun.elapsedMs,
    speedup: candidateRun.elapsedMs > 0 ? referenceRun.elapsedMs / candidateRun.elapsedMs : 0,
    referenceOutputBytes: referenceRun.outputBytes,
    candidateOutputBytes: candidateRun.outputBytes,
    encryptedOutputsByteExact: comparison.byteExact,
    firstMismatchOffset: comparison.firstMismatchOffset,
    referenceCheckPassed: referenceCheck,
    candidateCheckPassed: candidateCheck,
    qpdfVersion,
    notes: [
      'Reference uses the pristine qpdf Pl_AES_PDF pipeline from F2-R.1.',
      'Candidate uses the isolated F2 bulk AES-CBC pipeline and is not used by production Protect PDF.',
      'Static document ID and static AES IV are enabled only for deterministic validation and must never be used in production.',
      'F2-R.2 is a correctness/performance gate, not a production deployment decision.'
    ]
  };
}

async function loadFactory(jsUrl: string, wasmUrl: string, expectedFactory: string): Promise<QpdfFactory> {
  const response = await fetch(wasmUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`F2-R.2 WASM request failed: HTTP ${response.status} (${wasmUrl}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d || bytes[4] !== 1) {
    throw new Error(`F2-R.2 WASM asset is invalid: ${wasmUrl}`);
  }

  const module = await import(/* @vite-ignore */ jsUrl) as Record<string, unknown>;
  const factory = module[expectedFactory] ?? module['default'];
  if (typeof factory !== 'function') {
    throw new Error(`F2-R.2 qpdf module did not export ${expectedFactory}.`);
  }
  return factory as QpdfFactory;
}

function probeVersion(module: QpdfModule, stdout: string[], stderr: string[]): string {
  const beforeOut = stdout.length;
  const beforeErr = stderr.length;
  const exitCode = module.callMain(['--version']);
  if (exitCode !== 0) throw new Error(`F2-R.2 qpdf --version failed with exit code ${exitCode}.`);
  const lines = stdout.slice(beforeOut).concat(stderr.slice(beforeErr));
  for (const line of lines) {
    const match = line.match(/\bversion\s+([0-9]+(?:\.[0-9]+){1,3})\b/i);
    if (match?.[1]) return match[1];
  }
  return '';
}

function runEncryption(
  module: QpdfModule,
  request: LargePdfSecurityF2R2Request,
  label: string,
  stdout: string[],
  stderr: string[]
): { readonly outputPath: string; readonly outputBytes: number; readonly elapsedMs: number } {
  const root = `/safepdfhub-f2r2-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputMount = `${root}/input`;
  const outputPath = `${root}/${label}-protected.pdf`;
  module.FS.mkdir(root);
  module.FS.mkdir(inputMount);
  module.FS.mount(module.WORKERFS, { files: [request.file], blobs: [] }, inputMount);
  const entries = module.FS.readdir(inputMount).filter(entry => entry !== '.' && entry !== '..');
  if (entries.length !== 1) throw new Error(`F2-R.2 ${label} input mount is invalid.`);
  const inputPath = `${inputMount}/${entries[0]}`;

  const args = [
    '--static-id',
    '--static-aes-iv',
    '--encrypt',
    `--user-password=${request.userPassword}`,
    `--owner-password=${request.ownerPassword}`,
    `--bits=${request.bits}`,
    ...(request.bits === 128 ? ['--use-aes=y'] : []),
    '--print=full',
    '--extract=y',
    '--modify=all',
    '--annotate=y',
    '--form=y',
    '--assemble=y',
    '--',
    inputPath,
    outputPath
  ];

  const started = performance.now();
  const exitCode = module.callMain(args);
  const elapsedMs = performance.now() - started;
  if (exitCode !== 0) {
    throw new Error(`F2-R.2 ${label} qpdf encryption failed with exit code ${exitCode}.`);
  }

  const outputBytes = module.FS.stat(outputPath).size;
  if (outputBytes < 5 || !hasPdfHeader(module, outputPath)) {
    throw new Error(`F2-R.2 ${label} output is not a valid PDF header.`);
  }

  // Keep the filesystem alive until comparison/checking has completed.
  return { outputPath, outputBytes, elapsedMs };
}

function checkPdf(module: QpdfModule, outputPath: string, stdout: string[], stderr: string[]): boolean {
  const beforeOut = stdout.length;
  const beforeErr = stderr.length;
  const exitCode = module.callMain(['--check', outputPath]);
  if (exitCode !== 0) return false;
  const newOut = stdout.slice(beforeOut);
  const newErr = stderr.slice(beforeErr);
  return !newErr.some(line => /error/i.test(line)) && !newOut.some(line => /errors found/i.test(line));
}

function hasPdfHeader(module: QpdfModule, path: string): boolean {
  const stream = module.FS.open(path, 'r');
  const header = new Uint8Array(5);
  try {
    return module.FS.read(stream, header, 0, 5, 0) === 5
      && header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46 && header[4] === 0x2D;
  } finally {
    module.FS.close(stream);
  }
}

function compareFiles(
  leftModule: QpdfModule,
  leftPath: string,
  rightModule: QpdfModule,
  rightPath: string
): { readonly byteExact: boolean; readonly firstMismatchOffset: number | null } {
  const leftSize = leftModule.FS.stat(leftPath).size;
  const rightSize = rightModule.FS.stat(rightPath).size;
  if (leftSize !== rightSize) return { byteExact: false, firstMismatchOffset: Math.min(leftSize, rightSize) };

  const leftStream = leftModule.FS.open(leftPath, 'r');
  const rightStream = rightModule.FS.open(rightPath, 'r');
  const left = new Uint8Array(1024 * 1024);
  const right = new Uint8Array(1024 * 1024);
  try {
    let position = 0;
    while (position < leftSize) {
      const length = Math.min(left.byteLength, leftSize - position);
      const leftRead = leftModule.FS.read(leftStream, left, 0, length, position);
      const rightRead = rightModule.FS.read(rightStream, right, 0, length, position);
      if (leftRead !== length || rightRead !== length) {
        return { byteExact: false, firstMismatchOffset: position };
      }
      for (let i = 0; i < length; i += 1) {
        if (left[i] !== right[i]) return { byteExact: false, firstMismatchOffset: position + i };
      }
      position += length;
    }
    return { byteExact: true, firstMismatchOffset: null };
  } finally {
    leftModule.FS.close(leftStream);
    rightModule.FS.close(rightStream);
  }
}

function post(message: LargePdfSecurityF2R2Response): void {
  self.postMessage(message);
}

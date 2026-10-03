import { describe, expect, it, vi } from 'vitest';
import { QpdfWasmPrototypeService } from './qpdf-wasm-prototype.service';
import { QpdfRuntimeError } from './qpdf-runtime-error';
import { QpdfWasmRuntimeService } from './qpdf-wasm-runtime.service';

function makeRunnerFactory(requests: unknown[]) {
  return {
    async create() {
      return {
        async run(request: unknown) {
          requests.push(request);
          return {
            ok: true,
            outputs: {
              'structural-baseline-output.pdf': new Uint8Array([1, 2, 3]),
              'compressed-qpdf-output.pdf': new Uint8Array([1, 2, 3]),
              'image-quality-76-output.pdf': new Uint8Array([1, 2, 3]),
            },
            stdout: [],
            stderr: [],
            warnings: [],
            exitCode: 0,
            durationMs: 1,
          };
        },
        async destroy() {},
      };
    },
  };
}

describe('QpdfWasmPrototypeService — compression optimization', () => {
  it('uses content-preserving qpdf size optimization flags', async () => {
    const requests: unknown[] = [];
    const runtime = {
      run: vi.fn(async (request: unknown, onProgress?: (progress: number) => void, factory?: unknown) => {
        onProgress?.(50);
        const runner = await (factory as any).create();
        return runner.run(request);
      }),
    };

    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });
    const output = await service.optimizeForCompression(
      input,
      68,
      undefined,
      makeRunnerFactory(requests),
    );

    const request = requests[0] as { args: string[]; outputs: string[] };
    expect(output.size).toBe(3);
    expect(request.args).toEqual(expect.arrayContaining([
      '--compress-streams=y',
      '--decode-level=generalized',
      '--recompress-flate',
      '--compression-level=9',
      '--optimize-images',
      '--jpeg-quality=68',
      '--object-streams=generate',
    ]));
    expect(request.outputs).toContain('compressed-qpdf-output.pdf');
  });
});



  it('blocks repeated PDF-output attempts after an observed OOM for the same File', async () => {
    let calls = 0;
    const runtime = {
      run: vi.fn(async () => {
        calls += 1;
        throw new Error('Aborted(OOM). Build with -sASSERTIONS for more info.');
      }),
    };
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });

    await expect(service.optimizeForCompression(input, 70)).rejects.toThrow(/OOM/i);
    await expect(service.optimizeForCompression(input, 70)).rejects.toMatchObject({
      name: 'QpdfStructuralCandidateError',
      reason: 'QPDF_MEMORY_EXHAUSTED',
    });
    expect(calls).toBe(1);
  });

describe('QpdfWasmPrototypeService — V2.3 image candidate', () => {
  it('uses an isolated image optimization quality candidate', async () => {
    const requests: unknown[] = [];
    const runtime = {
      run: vi.fn(async (request: unknown, _onProgress?: unknown, factory?: unknown) => {
        const runner = await (factory as any).create();
        return runner.run(request);
      }),
    };
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });
    const output = await service.optimizeImageCandidate(input, 76, makeRunnerFactory(requests));
    const request = requests[0] as { args: string[]; outputs: string[] };

    expect(output.size).toBe(3);
    expect(request.args).toEqual(expect.arrayContaining([
      '--optimize-images',
      '--jpeg-quality=76',
      '--recompress-flate',
      '--object-streams=generate',
    ]));
    expect(request.outputs).toContain('image-quality-76-output.pdf');
  });
});


describe('QpdfWasmPrototypeService — structural runtime diagnostics', () => {
  it('uses the supplied runner factory for structural candidates', async () => {
    const requests: unknown[] = [];
    const runtime = new QpdfWasmRuntimeService();
    const service = new QpdfWasmPrototypeService(runtime);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });

    await expect(
      service.optimizeStructuralCandidate(
        input,
        'baseline',
        80,
        makeRunnerFactory(requests),
      ),
    ).resolves.toBeInstanceOf(File);

    expect(requests).toHaveLength(1);
  });

  it('wraps runner failures with structured runtime metadata', async () => {
    const runtime = {
      run: vi.fn(async () => {
        throw new QpdfRuntimeError('runner-run', 'worker initialization failed at <path>', new Error('worker failure'));
      }),
    };
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });

    await expect(
      service.optimizeStructuralCandidate(input, 'baseline', 80, makeRunnerFactory([])),
    ).rejects.toMatchObject({
      name: 'QpdfStructuralCandidateError',
      reason: 'QPDF_RUN_FAILED',
      runtimeError: {
        phase: 'runner-run',
        name: 'Error',
        message: 'worker initialization failed at <path>',
      },
    });
  });
  it('uses the conservative profile without memory-amplifying recompression flags', async () => {
    const requests: unknown[] = [];
    const runtime = {
      run: vi.fn(async (request: unknown, _onProgress?: unknown, factory?: unknown) => {
        const runner = await (factory as any).create();
        return runner.run(request);
      }),
    };
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([9, 8, 7])], 'input.pdf', { type: 'application/pdf' });

    await service.optimizeStructuralCandidate(
      input,
      'baseline',
      80,
      makeRunnerFactory(requests),
      'conservative',
    );

    const request = requests[0] as { args: string[] };
    expect(request.args).toEqual(expect.arrayContaining(['--compress-streams=y']));
    expect(request.args).not.toContain('--decode-level=generalized');
    expect(request.args).not.toContain('--recompress-flate');
    expect(request.args).not.toContain('--compression-level=9');
    expect(request.args).not.toContain('--object-streams=generate');
  });

});

describe('QpdfWasmPrototypeService — output boundary closure coverage', () => {
  function makeOomRuntime() {
    return {
      run: vi.fn(async () => {
        throw new Error('Aborted(OOM). Build with -sASSERTIONS for more info.');
      }),
    };
  }

  it('blocks the generic optimize output path after an observed OOM', async () => {
    const runtime = makeOomRuntime();
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const input = new File([new Uint8Array([1, 2, 3])], 'input.pdf', { type: 'application/pdf' });

    await expect(service.optimize(input)).rejects.toThrow(/OOM/i);
    await expect(service.optimize(input)).rejects.toMatchObject({
      name: 'QpdfStructuralCandidateError',
      reason: 'QPDF_MEMORY_EXHAUSTED',
    });
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });

  it('keeps the generic optimize path available for a different File object', async () => {
    const runtime = makeOomRuntime();
    const service = new QpdfWasmPrototypeService(runtime as unknown as QpdfWasmRuntimeService);
    const first = new File([new Uint8Array([1, 2, 3])], 'input.pdf', { type: 'application/pdf' });
    const second = new File([new Uint8Array([1, 2, 3])], 'input.pdf', { type: 'application/pdf' });

    await expect(service.optimize(first)).rejects.toThrow(/OOM/i);
    await expect(service.optimize(second)).rejects.toThrow(/OOM/i);
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
});

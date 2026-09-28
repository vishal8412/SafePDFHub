import { describe, expect, it, vi } from 'vitest';
import { QpdfWasmPrototypeService } from './qpdf-wasm-prototype.service';
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
              'compressed-qpdf-output.pdf': new Uint8Array([1, 2, 3]),
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

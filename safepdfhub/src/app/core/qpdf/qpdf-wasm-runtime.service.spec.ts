import { describe, expect, it, vi } from 'vitest';
import { QpdfWasmRuntimeService } from './qpdf-wasm-runtime.service';
import type { QpdfWasmRunnerFactory } from './qpdf-wasm.types';

function request() {
  return {
    inputs: { 'input.pdf': new Uint8Array([1, 2, 3]) },
    args: ['input.pdf', '--', 'output.pdf'],
    outputs: ['output.pdf'],
  };
}

describe('QpdfWasmRuntimeService cancellation lifecycle', () => {
  it('destroys a runner created after cancellation instead of reviving the cancelled operation', async () => {
    const createStarted = vi.fn();
    let resolveCreate!: (runner: any) => void;
    const createPromise = new Promise(resolve => { resolveCreate = resolve; });
    const destroy = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({
      ok: true,
      outputs: { 'output.pdf': new Uint8Array([9]) },
      stdout: [],
      stderr: [],
      warnings: [],
      exitCode: 0,
      durationMs: 1,
    }));
    const factory: QpdfWasmRunnerFactory = {
      create: async () => {
        createStarted();
        return createPromise;
      },
    } as never;

    const service = new QpdfWasmRuntimeService();
    const operation = service.run(request(), undefined, factory);
    expect(createStarted).toHaveBeenCalledOnce();

    await service.cancel();
    resolveCreate({ run, destroy });

    await expect(operation).rejects.toThrow('cancelled');
    expect(destroy).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
});


describe('QpdfWasmRuntimeService runtime failure diagnostics', () => {
  it('classifies runner creation failures', async () => {
    const service = new QpdfWasmRuntimeService();
    const factory: QpdfWasmRunnerFactory = {
      create: async () => {
        throw new Error('qpdf-run worker failed at C:\\temp\\qpdf.wasm');
      },
    };

    await expect(service.run(request(), undefined, factory)).rejects.toMatchObject({
      name: 'QpdfRuntimeError',
      phase: 'runner-create',
      message: 'qpdf-run worker failed at <path>',
      cancelled: false,
    });
  });

  it('classifies runner execution failures', async () => {
    const service = new QpdfWasmRuntimeService();
    const factory: QpdfWasmRunnerFactory = {
      create: async () => ({
        run: async () => {
          throw new Error('WASM worker crashed');
        },
        destroy: async () => undefined,
      }),
    };

    await expect(service.run(request(), undefined, factory)).rejects.toMatchObject({
      name: 'QpdfRuntimeError',
      phase: 'runner-run',
      message: 'WASM worker crashed',
      cancelled: false,
    });
  });
});

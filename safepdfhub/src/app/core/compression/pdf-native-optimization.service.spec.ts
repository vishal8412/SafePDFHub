import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfNativeOptimizationService } from './pdf-native-optimization.service';

describe('Native worker lifetime', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function worker() {
    const instance = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as any, onerror: null as any };
    vi.stubGlobal('Worker', class { constructor() { return instance; } });
    return instance;
  }
  const file = () => new File([new Uint8Array(1000)], 'input.pdf');

  it('terminates synchronous PDF work immediately on abort', async () => {
    const instance = worker();
    const controller = new AbortController();
    const pending = new PdfNativeOptimizationService().optimize(file(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'CompressionCancelledError' });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it('terminates an unresponsive worker and returns no candidate at its deadline', async () => {
    vi.useFakeTimers();
    const instance = worker();
    const pending = new PdfNativeOptimizationService().optimize(file());
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(pending).resolves.toBeNull();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it('does not select a larger output and releases the worker', async () => {
    const instance = worker();
    const pending = new PdfNativeOptimizationService().optimize(file());
    instance.onmessage({ data: { buffers: [new ArrayBuffer(1001)] } });
    await expect(pending).resolves.toBeNull();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
});

describe('Native progress messages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('forwards activity without completing or terminating the worker', async () => {
    const instance = {postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as any};
    vi.stubGlobal('Worker',class { constructor(){return instance;} });
    const onActivity=vi.fn();
    const pending=new PdfNativeOptimizationService().optimizeCandidates(new File([new Uint8Array(1000)],'test.pdf'),undefined,{},onActivity);
    instance.onmessage({data:{type:'activity',activity:{stage:'optimizing',current:1,total:5}}});
    expect(onActivity).toHaveBeenCalledWith({stage:'optimizing',current:1,total:5});
    expect(instance.terminate).not.toHaveBeenCalled();
    instance.onmessage({data:{buffers:[new ArrayBuffer(500)]}});
    expect((await pending)[0].size).toBe(500);expect(instance.terminate).toHaveBeenCalledOnce();
  });
});

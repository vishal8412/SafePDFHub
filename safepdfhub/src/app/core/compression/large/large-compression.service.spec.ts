import { describe, expect, it, vi } from 'vitest';
import { LargeCompressionService } from './large-compression.service';
class FakeWorker {
  static last: FakeWorker;
  terminate = vi.fn(); postMessage = vi.fn();
  onerror?: () => void;
  constructor() { FakeWorker.last = this; }
}
describe('large worker lifetime', () => {
  for (const scenario of ['abort', 'timeout', 'error']) {
    it(`terminates and rejects on ${scenario}`, async () => {
      vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
      try {
        const service = new LargeCompressionService({} as never);
        const controller = new AbortController();
        const pending = (service as any).runWorker(new File(['pdf'], 'x.pdf'), {}, controller.signal, () => {});
        const rejected = expect(pending).rejects.toThrow();
        if (scenario === 'abort') controller.abort();
        if (scenario === 'timeout') await vi.advanceTimersByTimeAsync(300_000);
        if (scenario === 'error') FakeWorker.last.onerror?.();
        await rejected;
        expect(FakeWorker.last.terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
    });
  }
});

describe('large result save', () => {
  it('streams to the chosen destination and waits for close', async () => {
    let written = 0; let closed = false;
    const picker = vi.fn(async () => ({ createWritable: async () => new WritableStream({
      write: chunk => { written += chunk.byteLength; }, close: () => { closed = true; }
    }) }));
    Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true });
    try {
      const service = new LargeCompressionService({} as never);
      const file = new File(['a small PDF'], 'test.pdf');
      // jsdom's File omits Blob.stream; supply the standard stream contract.
      Object.defineProperty(file, 'stream', { value: () => new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('a small PDF')); controller.close(); }
      }) });
      expect(await service.save(file)).toBe(true);
      expect(written).toBe(file.size); expect(closed).toBe(true);
    } finally { delete (window as any).showSaveFilePicker; }
  });
});

describe('sequential disk candidate selection', () => {
  it('starts each image pass from the source and keeps only the best candidate', async () => {
    const files = new Map<string, File>(); const removed: string[] = [];
    const fakeFile = (size: number) => { const f = new File(['pdf'], 'test.pdf'); Object.defineProperty(f, 'size', { value: size }); return f; };
    const dir = { getFileHandle: async (name: string) => ({ getFile: async () => files.get(name)! }),
      removeEntry: async (name: string) => { removed.push(name); files.delete(name); } };
    const root = { entries: async function* () {}, getDirectoryHandle: async () => dir, removeEntry: vi.fn() };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks: {
      query: async () => ({ held: [] }), request: (_name: string, ...args: any[]) => args.at(-1)({}) } });
    try {
      const service = new LargeCompressionService({ assertFile: vi.fn(), checkStorage: vi.fn() } as never);
      const source = fakeFile(200_000_000);
      const run = vi.spyOn(service as any, 'runWorker').mockImplementation(async (...args: any[]) => {
        expect(args[0]).toBe(source);
        const pass = args[4];
        files.set(pass.outputName, fakeFile(pass.quality === undefined ? 100_000_000 : 4_000_000));
        return 100;
      });
      const result = await service.compress(source, new AbortController().signal, () => {}, { level: 'strong', targetBytes: 5_000_000 });
      expect(run).toHaveBeenCalledTimes(1);
      expect(result.note).toContain('JPEG quality 45');
      expect(removed).toEqual([]);
      expect(files.size).toBe(1);
      await service.release();
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not mask cancellation as a successful fallback', async () => {
    const controller = new AbortController();
    const f = new File(['pdf'], 'test.pdf'); Object.defineProperty(f, 'size', { value: 40_000_000 });
    const dir = { getFileHandle: async () => ({ getFile: async () => f }) };
    const root = { entries: async function* () {}, getDirectoryHandle: async () => dir, removeEntry: vi.fn() };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks: {
      query: async () => ({ held: [] }), request: (_name: string, ...args: any[]) => args.at(-1)({}) } });
    try {
      const service = new LargeCompressionService({ assertFile: vi.fn(), checkStorage: vi.fn() } as never);
      vi.spyOn(service as any, 'runWorker').mockImplementationOnce(async () => { controller.abort(); throw new Error('stopped'); });
      await expect(service.compress(f, controller.signal, () => {}, { level: 'recommended' })).rejects.toThrow(/cancel/i);
      expect(root.removeEntry).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('temporary file cleanup', () => {
  it('retries a worker handle lock before completing cleanup', async () => {
    vi.useFakeTimers();
    try {
      const service = new LargeCompressionService({} as never);
      const directory = { removeEntry: vi.fn()
        .mockRejectedValueOnce(new DOMException('Worker is closing', 'NoModificationAllowedError'))
        .mockResolvedValue(undefined) };
      const pending = (service as any).removeTemporaryEntry(directory, 'job', true);
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(directory.removeEntry).toHaveBeenCalledTimes(2);
      expect(directory.removeEntry).toHaveBeenLastCalledWith('job', { recursive: true });
    } finally { vi.useRealTimers(); }
  });
});


describe('direct download lifetime', () => {
  it('keeps the backing file alive after leaving the result page', async () => {
    vi.useFakeTimers();
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ removeEntry }) } });
    try {
      const service = new LargeCompressionService({} as never);
      (service as any).outputDirectory = 'download-job';
      service.retainForDownload();
      await service.release();
      expect(removeEntry).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(299999);
      expect(removeEntry).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(removeEntry).toHaveBeenCalledWith('download-job', { recursive: true });
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});

describe('200 MB native routing and fallback', () => {
  for (const bytes of [150_000_000, 200_000_000, 200_000_001]) {
    it(`routes ${bytes} bytes with a reserved fallback budget`, async () => {
      const f = new File(['pdf'], 'test.pdf'); Object.defineProperty(f, 'size', { value: bytes });
      const dir = { removeEntry: vi.fn(), getFileHandle: async () => ({ getFile: async () => new File(['smaller'], 'output.pdf') }) };
      const root = { entries: async function* () {}, getDirectoryHandle: async () => dir, removeEntry: vi.fn() };
      vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks: {
        query: async () => ({ held: [] }), request: (_name: string, ...args: any[]) => args.at(-1)({}) } });
      try {
        const service = new LargeCompressionService({ assertFile: vi.fn(), checkStorage: vi.fn(), budget: { memoryMiB: 512 } } as never);
        const run = vi.spyOn(service as any, 'runWorker');
        const native = bytes <= 200_000_000;
        if (native) run.mockRejectedValueOnce(new Error('Native memory limit'));
        run.mockResolvedValue(1);
        const result = await service.compress(f, new AbortController().signal, () => {}, { level: 'strong', targetBytes: 20_000_000 });
        const first = run.mock.calls[0][4] as any;
        expect(!!first.nativeOptions).toBe(native);
        if (native) {
          expect(first.timeoutMs).toBeLessThanOrEqual(180000);
          expect(run).toHaveBeenCalledTimes(2);
          expect((run.mock.calls[1][4] as any).nativeOptions).toBeUndefined();
          expect(result.note).toContain('lossless');
        } else expect(run).toHaveBeenCalledTimes(1);
        await service.release();
      } finally { vi.unstubAllGlobals(); }
    });
  }
});

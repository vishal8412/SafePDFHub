import { vi } from 'vitest';
import { StudioSourcePageReader } from './studio-source-page';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (message: any) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
describe('shared background source pages', () => {
  beforeEach(() => { FakeWorker.instances=[]; vi.stubGlobal('Worker',FakeWorker); });
  afterEach(() => vi.unstubAllGlobals());
  it('shares in-flight pages and releases the previous document on replacement', async () => {
    const reader=new StudioSourcePageReader(), file=new File(['pdf'],'one.pdf');
    const first=reader.read(file,1), same=reader.read(file,1);
    expect(same).toBe(first);
    const worker=FakeWorker.instances[0]; expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.onmessage!({data:{id:worker.postMessage.mock.calls[0][0].id,bytes:new Uint8Array([1,2])}});
    expect(await first).toEqual(new Uint8Array([1,2]));
    const stale=reader.read(file,2); const rejected=expect(stale).rejects.toThrow('document changed');
    const next=reader.read(new File(['new'],'two.pdf'),1);
    await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
    const nextRejected=expect(next).rejects.toThrow();reader.reset();await nextRejected;
  });
  it('does not retain an oversized prepared page in its cache', async () => {
    const reader=new StudioSourcePageReader(), file=new File(['pdf'],'one.pdf');
    const first=reader.read(file,1),worker=FakeWorker.instances[0];
    worker.onmessage!({data:{id:worker.postMessage.mock.calls[0][0].id,bytes:new Uint8Array(17*1024*1024)}});
    await first;
    const again=reader.read(file,1);expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const rejected=expect(again).rejects.toThrow();reader.reset();await rejected;
  });
});

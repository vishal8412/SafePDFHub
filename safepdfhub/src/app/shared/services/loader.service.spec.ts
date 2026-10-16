import { LoaderService } from './loader.service';
describe('Common loader real progress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps real page progress and text without timer overrides', () => {
    const loader = new LoaderService();
    loader.show('Reading scanned text', { determinate: true });
    loader.setProgress(14);
    loader.setPage(4, 301);
    vi.advanceTimersByTime(10000);
    expect(loader.progress()).toBe(14);
    expect(loader.text()).toBe('Reading scanned text');
    expect(loader.page()).toEqual({ current: 4, total: 301 });
    loader.hide();
    vi.runAllTimers();
    expect(loader.loading()).toBe(false);
  });
  it('does not allow a delayed hide to dismiss a newer operation', () => {
    const loader = new LoaderService();
    loader.show();
    loader.hide();
    loader.show('New conversion', { determinate: true });
    vi.advanceTimersByTime(2000);
    expect(loader.loading()).toBe(true);
    expect(loader.text()).toBe('New conversion');
    loader.hide();
    vi.runAllTimers();
  });
  it('shows a non-estimated completed state at 100%', () => {
    const loader = new LoaderService();
    loader.show('Reading your PDF', { determinate: true, estimated: true });
    loader.setProgress(78);
    loader.complete('Compression complete');
    expect(loader.loading()).toBe(true);
    expect(loader.progress()).toBe(100);
    expect(loader.estimated()).toBe(false);
    expect(loader.text()).toBe('Compression complete');
    loader.hide();
    vi.runAllTimers();
  });
  it('uses only the current cancellation registration', () => {
    const loader = new LoaderService(),
      old = vi.fn(),
      current = vi.fn();
    const releaseOld = loader.registerCancellationHandler(old);
    const release = loader.registerCancellationHandler(current);
    releaseOld();
    loader.cancelActiveTask();
    expect(current).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
    release();
    expect(loader.cancellationAvailable()).toBe(false);
  });
});

describe('Common loader elapsed time and image work', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('counts elapsed time independently of progress updates and resets for the next job', () => {
    const loader = new LoaderService();
    loader.show('Reducing file size', { determinate: true, estimated: true });
    vi.advanceTimersByTime(2000); loader.setProgress(20); vi.advanceTimersByTime(3000);
    expect(loader.elapsedSeconds()).toBe(5);
    expect(loader.progress()).toBe(20);
    expect(loader.estimated()).toBe(true);
    loader.setWork({current:2,total:10,pass:1,passes:2});
    expect(loader.work()?.current).toBe(2);
    loader.hide();vi.runAllTimers();
    loader.show('New job',{determinate:true});
    expect(loader.elapsedSeconds()).toBe(0);expect(loader.work()).toBeNull();expect(loader.estimated()).toBe(false);
    loader.hide();vi.runAllTimers();
  });
  it('shows zero-based page progress at the start of a Studio batch', () => {
    const loader = new LoaderService();
    loader.show('Preparing pages', { determinate: true });
    loader.setPage(0, 3378);
    expect(loader.page()).toEqual({ current: 0, total: 3378 });
    loader.setPage(2624, 3378);
    expect(loader.page()).toEqual({ current: 2624, total: 3378 });
    loader.setPage(4000, 3378);
    expect(loader.page()).toEqual({ current: 3378, total: 3378 });
    loader.hide();
    vi.runAllTimers();
  });
  it('keeps page and image counters separate and clamps image counts', () => {
    const loader = new LoaderService();
    loader.setPage(1,20);loader.setWork({current:25,total:10});
    expect(loader.page()).toBeNull();expect(loader.work()?.current).toBe(10);
    loader.setPage(2,20);expect(loader.work()).toBeNull();
    loader.setWork({current:1,total:0});expect(loader.work()).toBeNull();
  });
});

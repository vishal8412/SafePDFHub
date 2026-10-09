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

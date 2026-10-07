/** Shared by font analysis and live previews: never parse the whole PDF twice
 * on the UI thread. Closing/replacing the source terminates outstanding work. */
export class StudioSourcePageReader {
  private file: File | null = null;
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly requests = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
  private readonly pages = new Map<number, Promise<Uint8Array>>();

  reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.file = null;
    for (const request of this.requests.values()) request.reject(new Error('PDF document changed.'));
    this.requests.clear();
    this.pages.clear();
  }

  read(file: File, page: number): Promise<Uint8Array> {
    if (!file) return Promise.reject(new Error('Missing source PDF.'));
    if (file !== this.file) { this.reset(); this.file = file; }
    const cached = this.pages.get(page);
    if (cached) { this.pages.delete(page); this.pages.set(page, cached); return cached; }
    const task = this.request(file, page);
    this.pages.set(page, task);
    // Count plus byte bounds: a few image-heavy pages can be very large.
    while (this.pages.size > 4) this.pages.delete(this.pages.keys().next().value!);
    void task.then(bytes => {
      if (bytes.byteLength > 16 * 1024 * 1024 && this.pages.get(page) === task) this.pages.delete(page);
    }, () => { if (this.pages.get(page) === task) this.pages.delete(page); });
    return task;
  }

  private request(file: File, page: number): Promise<Uint8Array> {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser does not support background PDF preparation.'));
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./studio-source-page.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<{ id: number; bytes?: Uint8Array; error?: string }>) => {
          const pending = this.requests.get(data.id);
          if (!pending) return;
          this.requests.delete(data.id);
          if (data.bytes) pending.resolve(data.bytes);
          else pending.reject(new Error(data.error ?? 'Unable to prepare PDF page.'));
        };
        this.worker.onerror = () => this.reset();
      }
      const worker = this.worker;
      const id = ++this.nextId;
      return new Promise((resolve, reject) => {
        this.requests.set(id, { resolve, reject });
        try { worker.postMessage({ id, file, page }); }
        catch (error) { this.requests.delete(id); reject(error); }
      });
    } catch (error) { return Promise.reject(error); }
  }
}

export const studioSourcePages = new StudioSourcePageReader();

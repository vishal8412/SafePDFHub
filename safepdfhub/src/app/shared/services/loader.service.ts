import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoaderService {
  private _loading = signal(false);
  private _text = signal('Loading...');
  private _progress = signal(0);
  private _page = signal<{ current: number; total: number } | null>(null);
  private _determinate = signal(false);
  loading = this._loading.asReadonly();
  text = this._text.asReadonly();
  progress = this._progress.asReadonly();
  page = this._page.asReadonly();
  determinate = this._determinate.asReadonly();
  private activeTasks = 0;
  private startTime = 0;
  private generation = 0;
  private progressInterval?: ReturnType<typeof setInterval>;
  private messageInterval?: ReturnType<typeof setInterval>;
  private cancellationHandler: (() => void) | null = null;
  private cancellationRegistrationId = 0;
  private _cancellationAvailable = signal(false);
  cancellationAvailable = this._cancellationAvailable.asReadonly();
  private steps = [
    'Analyzing your PDF...',
    'Rendering preview...',
    'Optimizing pages...',
    'Almost ready...',
  ];

  /** Existing tools retain their loader; determinate tools supply real progress and page data. */
  show(customText?: string, options: { determinate?: boolean } = {}) {
    this.activeTasks++;
    if (this.activeTasks !== 1) return;
    this.generation++;
    this.stopProgress();
    this.startTime = Date.now();
    this._loading.set(true);
    this._progress.set(0);
    this._page.set(null);
    this._determinate.set(!!options.determinate);
    this._text.set(customText || this.steps[0]);
    if (!options.determinate) {
      this.progressInterval = setInterval(() => {
        const current = this._progress();
        if (current < 90)
          this._progress.set(Math.min(90, current + Math.max((100 - current) * 0.05, 0.5)));
      }, 300);
      // Explicit operation messages must not be overwritten by generic stages.
      if (!customText) {
        let i = 0;
        this.messageInterval = setInterval(
          () => this._text.set(this.steps[++i % this.steps.length]),
          1200,
        );
      }
    }
  }
  hide() {
    if (!this.activeTasks) return;
    if (--this.activeTasks) return;
    this.stopProgress();
    const generation = this.generation;
    setTimeout(
      () => {
        if (generation !== this.generation || this.activeTasks) return;
        this._loading.set(false);
        this._progress.set(0);
        this._page.set(null);
      },
      Math.max(600 - (Date.now() - this.startTime), 0),
    );
  }
  private stopProgress() {
    clearInterval(this.progressInterval);
    clearInterval(this.messageInterval);
    this.progressInterval = undefined;
    this.messageInterval = undefined;
  }
  registerCancellationHandler(handler: () => void): () => void {
    const id = ++this.cancellationRegistrationId;
    this.cancellationHandler = handler;
    this._cancellationAvailable.set(true);
    return () => {
      if (id !== this.cancellationRegistrationId) return;
      this.cancellationHandler = null;
      this._cancellationAvailable.set(false);
    };
  }
  cancelActiveTask() {
    this.cancellationHandler?.();
  }
  setText(value: string) {
    clearInterval(this.messageInterval);
    this.messageInterval = undefined;
    this._text.set(value);
  }
  setProgress(value: number) {
    this.stopProgress();
    this._determinate.set(true);
    this._progress.set(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);
  }
  setPage(current?: number, total?: number) {
    this._page.set(current && total ? { current, total } : null);
  }
}

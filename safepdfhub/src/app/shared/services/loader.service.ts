import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoaderService {

  private _loading = signal(false);
  private _text = signal('Loading...');
  private _progress = signal(0);

  loading = this._loading.asReadonly();
  text = this._text.asReadonly();
  progress = this._progress.asReadonly();

  private activeTasks = 0;
  private startTime = 0;
  private minDuration = 600; // prevents flicker

  private progressInterval: any;

  private steps = [
    'Analyzing your PDF...',
    'Rendering preview...',
    'Optimizing pages...',
    'Almost ready...'
  ];

  // 🔥 START LOADER
  show(customText?: string) {
    this.activeTasks++;

    if (this.activeTasks === 1) {
      this._loading.set(true);
      this.startTime = Date.now();

      setTimeout(() => {
        this._progress.set(2);
      });
      
      this._text.set(customText || this.steps[0]);

      this.startFakeProgress();
      this.startStepMessages();
    }
  }

  // 🔥 END LOADER
  hide() {
    if (this.activeTasks > 0) {
      this.activeTasks--;
    }

    if (this.activeTasks === 0) {
      const elapsed = Date.now() - this.startTime;
      const delay = Math.max(this.minDuration - elapsed, 0);

      setTimeout(() => {
        this._progress.set(100);
        this._text.set('Done ✓');

        setTimeout(() => {
          this._loading.set(false);
          this._progress.set(0);
        }, 300);

        this.stopProgress();
      }, delay);
    }
  }

  // 🔥 FAKE PROGRESS (feels real)
  private startFakeProgress() {
  this.progressInterval = setInterval(() => {
    const current = this._progress();

    if (current < 90) {
      // 🔥 easing curve (feels natural)
      const remaining = 100 - current;
      const increment = Math.max(remaining * 0.05, 0.5);

      this._progress.set(current + increment);
    }
  }, 300);
}

  private stopProgress() {
    clearInterval(this.progressInterval);
  }

  // 🔥 SMART TEXT ROTATION
  private startStepMessages() {
  let i = 0;

  const interval = setInterval(() => {
    if (!this._loading()) {
      clearInterval(interval);
      return;
    }

    i = (i + 1) % this.steps.length;
    this._text.set(this.steps[i]);

  }, 1200);
}

  setText(value: string) {
    this._text.set(value);
}


setProgress(value: number) {
  this._progress.set(Math.min(100, Math.max(0, value)));

  // 🔥 stop fake progress when real progress comes
  if (this.progressInterval) {
    clearInterval(this.progressInterval);
  }
}

}
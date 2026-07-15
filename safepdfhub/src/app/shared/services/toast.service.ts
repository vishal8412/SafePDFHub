import { Injectable, signal } from '@angular/core';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  text: string;
  ttl: number;
  createdAt: number;
}

interface Toast {
  id: number;
  type: ToastType;
  text: string;
  ttl: number;
  createdAt: number;

  // ✅ NEW (add only)
  meta?: {
    fileName?: string;
  };

  actions?: {
    label: string;
    action: () => void;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ToastService {

  private MAX_VISIBLE = 4; // 👈 stack limit

  private _toasts = signal<Toast[]>([]);
  toasts = this._toasts.asReadonly();

  private queue: Toast[] = [];
  private id = 0;
  private timers = new Map<number, any>();
  private paused = new Set<number>();

  // ======================
  // SHOW TOAST
  // ======================
  show(
  text: string,
  type: ToastType = 'info',
  ttl?: number,
  options?: {
    meta?: { fileName?: string };
    actions?: { label: string; action: () => void }[];
  }
) {

  if (!ttl) {
    ttl = type === 'error' ? 5000 : 2500;
  }

  const existing = this._toasts().find(t => t.text === text);
  if (existing) {
    this.restartTimer(existing.id, ttl);
    return;
  }

  const toast: Toast = {
    id: ++this.id,
    type,
    text,
    ttl,
    createdAt: Date.now(),

    // ✅ NEW
    meta: options?.meta,
    actions: options?.actions || []
  };

  if (this._toasts().length >= this.MAX_VISIBLE) {
    this.queue.push(toast);
    return;
  }

  setTimeout(() => {
    this.addToast(toast);
  });
  
}

  // ======================
  // ADD TO UI
  // ======================
  private addToast(toast: Toast) {
    this._toasts.update(t => [...t, toast]);
    this.startTimer(toast);
  }

  // ======================
  // REMOVE
  // ======================
  remove(id: number) {
    this.clearTimer(id);

    this._toasts.update(t => t.filter(x => x.id !== id));

    // 🚀 LOAD FROM QUEUE
    if (this.queue.length) {
      const next = this.queue.shift()!;
      this.addToast(next);
    }
  }

  // ======================
  // TIMER MANAGEMENT
  // ======================
  private startTimer(toast: Toast) {
    const remaining = toast.ttl;

    const timer = setTimeout(() => {
      if (!this.paused.has(toast.id)) {
        this.remove(toast.id);
      }
    }, remaining);

    this.timers.set(toast.id, timer);
  }

  private restartTimer(id: number, ttl: number) {
    this.clearTimer(id);

    const toast = this._toasts().find(t => t.id === id);
    if (!toast) return;

    toast.ttl = ttl;
    this.startTimer(toast);
  }

  private clearTimer(id: number) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  // ======================
  // PAUSE / RESUME
  // ======================
  pause(id: number) {
    this.paused.add(id);
    this.clearTimer(id);
  }

  resume(id: number) {
    this.paused.delete(id);

    const toast = this._toasts().find(t => t.id === id);
    if (toast) {
      this.startTimer(toast);
    }
  }
}
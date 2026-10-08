import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

/** Register a lightweight dirty-state reader for any editor/tool that needs exit protection. */
@Injectable({ providedIn: 'root' })
export class UnsavedWorkService {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly readers = signal<ReadonlyMap<object, () => boolean>>(new Map());
  readonly hasPendingChanges = computed(() => [...this.readers().values()].some((read) => read()));

  readonly prompt = signal<'leave' | 'replace' | null>(null);
  private pending: Promise<boolean> | null = null;
  private resolvePending: ((leave: boolean) => void) | null = null;

  constructor() {
    effect((onCleanup) => {
      if (!this.hasPendingChanges() || !this.window) return;
      const listener = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      this.window.addEventListener('beforeunload', listener);
      onCleanup(() => this.window?.removeEventListener('beforeunload', listener));
    });
  }

  register(owner: object, read: () => boolean): () => void {
    this.readers.update((readers) => new Map(readers).set(owner, read));
    return () => {
      this.readers.update((readers) => {
        const next = new Map(readers);
        next.delete(owner);
        return next;
      });
      if (!this.hasPendingChanges()) this.resolve(false);
    };
  }

  confirmLeave(action: 'leave' | 'replace' = 'leave'): boolean | Promise<boolean> {
    if (!this.hasPendingChanges()) return true;
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => {
      this.resolvePending = resolve;
    });
    this.prompt.set(action);
    return this.pending;
  }

  resolve(leave: boolean): void {
    const resolve = this.resolvePending;
    this.pending = null;
    this.resolvePending = null;
    this.prompt.set(null);
    resolve?.(leave);
  }
}

export const unsavedWorkGuard: CanDeactivateFn<unknown> = () =>
  inject(UnsavedWorkService).confirmLeave();

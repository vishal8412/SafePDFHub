import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UnsavedWorkService } from './unsaved-work.service';

describe('Reusable unsaved work protection', () => {
  it('allows clean work and waits for an explicit decision on dirty work', async () => {
    const service = TestBed.inject(UnsavedWorkService),
      dirty = signal(false);
    service.register({}, () => dirty());
    expect(service.confirmLeave()).toBe(true);
    dirty.set(true);
    const decision = service.confirmLeave();
    expect(service.prompt()).toBe('leave');
    service.resolve(false);
    expect(await decision).toBe(false);
    expect(service.prompt()).toBeNull();
  });
  it('shares concurrent prompts and accepts replacing a PDF only on confirmation', async () => {
    const service = TestBed.inject(UnsavedWorkService);
    service.register({}, () => true);
    const first = service.confirmLeave('replace');
    expect(service.confirmLeave()).toBe(first);
    expect(service.prompt()).toBe('replace');
    service.resolve(true);
    expect(await first).toBe(true);
  });
  it('cancels an obsolete prompt when the dirty editor is destroyed', async () => {
    const service = TestBed.inject(UnsavedWorkService);
    const stop = service.register({}, () => true);
    const decision = service.confirmLeave();
    stop();
    expect(await decision).toBe(false);
    expect(service.prompt()).toBeNull();
    expect(service.confirmLeave()).toBe(true);
  });
});

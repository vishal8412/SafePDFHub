import { TestBed } from '@angular/core/testing';
import { StudioWatermarkStateService } from './studio-watermark-state.service';

describe('StudioWatermarkStateService', () => {
  let service: StudioWatermarkStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StudioWatermarkStateService] });
    service = TestBed.inject(StudioWatermarkStateService);
  });

  it('opens with a deterministic draft and no committed watermark', () => {
    service.open();

    expect(service.isOpen()).toBe(true);
    expect(service.draft()?.text).toBe('CONFIDENTIAL');
    expect(service.committed()).toBeNull();
    expect(service.hasUnappliedChanges()).toBe(true);
  });

  it('commits Add Watermark and preserves the committed configuration after closing', () => {
    service.open();
    const draft = service.draft();
    expect(draft).not.toBeNull();

    service.apply();
    service.close();

    expect(service.isOpen()).toBe(false);
    expect(service.committed()).toEqual(draft);
    expect(service.draft()).toEqual(draft);
    expect(service.hasUnappliedChanges()).toBe(false);
  });

  it('reopens an existing watermark for Update Watermark', () => {
    service.open();
    service.apply();
    service.close();

    service.open();

    expect(service.isOpen()).toBe(true);
    expect(service.draft()).toEqual(service.committed());
    expect(service.committed()).not.toBeNull();
    expect(service.hasUnappliedChanges()).toBe(false);
  });

  it('clears both draft and committed state when the watermark is removed', () => {
    service.open();
    service.apply();

    service.clear();

    expect(service.isOpen()).toBe(false);
    expect(service.draft()).toBeNull();
    expect(service.committed()).toBeNull();
    expect(service.hasUnappliedChanges()).toBe(false);
  });

  it('reopens the committed watermark after the inspector was closed with unsaved draft changes', () => {
    service.open();
    const committed = service.apply();
    service.close();

    service.open();
    service.updateDraft({ ...committed!, text: 'UPDATED' });
    service.close();
    service.open();

    expect(service.committed()).toEqual(committed);
    expect(service.draft()).toEqual(committed);
    expect(service.hasUnappliedChanges()).toBe(false);
  });
});

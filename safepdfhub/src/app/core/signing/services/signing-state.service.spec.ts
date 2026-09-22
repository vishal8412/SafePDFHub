import { SigningStateService } from './signing-state.service';
import type { SigningAsset, SigningField } from '../models/signing.models';

const asset: SigningAsset = {
  id: 'asset-1',
  kind: 'signature',
  source: 'drawn',
  dataUrl: 'data:image/png;base64,AA==',
  mimeType: 'image/png',
  naturalWidth: 1000,
  naturalHeight: 300,
  createdAt: 1,
};

const field: SigningField = {
  id: 'field-1',
  pageNumber: 1,
  kind: 'signature',
  bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.06 },
  asset,
  opacity: 1,
};

describe('SigningStateService', () => {
  it('supports a complete field undo/redo cycle', () => {
    const state = new SigningStateService();
    const before = state.checkpoint();
    state.addField(field);
    state.commitCheckpoint(before);

    expect(state.fields()).toHaveLength(1);
    expect(state.canUndo()).toBe(true);

    expect(state.undo()).toBe(true);
    expect(state.fields()).toHaveLength(0);
    expect(state.canRedo()).toBe(true);

    expect(state.redo()).toBe(true);
    expect(state.fields()[0].id).toBe('field-1');
  });

  it('clones field bounds and assets instead of sharing mutable nested objects', () => {
    const state = new SigningStateService();
    const before = state.checkpoint();
    state.addField(field);
    state.commitCheckpoint(before);
    expect(state.undo()).toBe(true);
    expect(state.redo()).toBe(true);

    const restored = state.fields()[0];
    expect(restored.bounds).not.toBe(field.bounds);
    expect(restored.asset).not.toBe(field.asset);
  });

  it('clears all signing data when the workflow session ends', () => {
    const state = new SigningStateService();
    state.addAsset(asset);
    state.addField(field);

    state.reset();

    expect(state.assets()).toHaveLength(0);
    expect(state.fields()).toHaveLength(0);
    expect(state.activeAsset()).toBeNull();
    expect(state.canUndo()).toBe(false);
  });
});

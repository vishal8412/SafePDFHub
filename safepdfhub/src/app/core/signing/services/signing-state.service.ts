import { Injectable, computed, signal } from '@angular/core';
import type { SigningAsset, SigningField, SigningFieldKind } from '../models/signing.models';

type FieldSnapshot = readonly SigningField[];

@Injectable({ providedIn: 'root' })
export class SigningStateService {
  private readonly _assets = signal<readonly SigningAsset[]>([]);
  private readonly _fields = signal<readonly SigningField[]>([]);
  private readonly _activeAsset = signal<SigningAsset | null>(null);
  private readonly _activeKind = signal<SigningFieldKind>('signature');
  private readonly _busy = signal(false);

  private readonly history: FieldSnapshot[] = [];
  private readonly redoStack: FieldSnapshot[] = [];
  private readonly historyVersion = signal(0);
  private readonly redoVersion = signal(0);
  private historyBefore: FieldSnapshot | null = null;
  private historyBatchDepth = 0;

  readonly assets = this._assets.asReadonly();
  readonly fields = this._fields.asReadonly();
  readonly activeAsset = this._activeAsset.asReadonly();
  readonly activeKind = this._activeKind.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly hasFields = computed(() => this._fields().length > 0);
  readonly canUndo = computed(() => {
    this.historyVersion();
    return this.history.length > 0;
  });
  readonly canRedo = computed(() => {
    this.redoVersion();
    return this.redoStack.length > 0;
  });

  addAsset(asset: SigningAsset): void {
    this._assets.update(items => [...items.filter(item => item.id !== asset.id), asset]);
    this._activeAsset.set(asset);
    this._activeKind.set(asset.kind);
  }

  removeAsset(id: string): void {
    this._assets.update(items => items.filter(item => item.id !== id));
    if (this._activeAsset()?.id === id) this._activeAsset.set(null);
  }

  moveAsset(id: string, targetIndex: number): void {
    this._assets.update(items => {
      const next = [...items];
      const from = next.findIndex(item => item.id === id);
      if (from < 0) return items;
      const [item] = next.splice(from, 1);
      const index = Math.max(0, Math.min(targetIndex, next.length));
      next.splice(index, 0, item);
      return next;
    });
  }

  setActiveAsset(asset: SigningAsset | null): void {
    this._activeAsset.set(asset);
    if (asset) this._activeKind.set(asset.kind);
  }

  setActiveKind(kind: SigningFieldKind): void {
    this._activeKind.set(kind);
  }

  addField(field: SigningField): void {
    this._fields.update(items => [...items, field]);
  }

  updateField(id: string, patch: Partial<SigningField>): void {
    this._fields.update(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  removeField(id: string): void {
    this._fields.update(items => items.filter(item => item.id !== id));
  }

  clearFields(): void {
    this._fields.set([]);
    this.history.length = 0;
    this.redoStack.length = 0;
    this.historyBefore = null;
    this.historyVersion.update(version => version + 1);
    this.redoVersion.update(version => version + 1);
  }

  /** Capture the current field state before a user-visible mutation. */
  checkpoint(): FieldSnapshot {
    return this.cloneFields(this._fields());
  }

  /** Commit a mutation as one undo step. No-op when nothing changed. */
  commitCheckpoint(before: FieldSnapshot): void {
    if (this.sameFields(before, this._fields())) return;
    this.history.push(this.cloneFields(before));
    if (this.history.length > 100) this.history.shift();
    this.redoStack.length = 0;
    this.historyVersion.update(version => version + 1);
    this.redoVersion.update(version => version + 1);
  }

  /** Group several low-level updates into a single undo step. */
  beginHistoryBatch(): FieldSnapshot {
    this.historyBatchDepth += 1;
    if (!this.historyBefore) this.historyBefore = this.checkpoint();
    return this.historyBefore;
  }

  endHistoryBatch(): void {
    if (this.historyBatchDepth <= 0) return;
    this.historyBatchDepth -= 1;
    if (this.historyBatchDepth !== 0) return;
    const before = this.historyBefore;
    this.historyBefore = null;
    if (before) this.commitCheckpoint(before);
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.redoStack.push(this.cloneFields(this._fields()));
    this._fields.set(this.cloneFields(previous));
    this.historyVersion.update(version => version + 1);
    this.redoVersion.update(version => version + 1);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.history.push(this.cloneFields(this._fields()));
    this._fields.set(this.cloneFields(next));
    this.historyVersion.update(version => version + 1);
    this.redoVersion.update(version => version + 1);
    return true;
  }

  setBusy(value: boolean): void {
    this._busy.set(value);
  }

  private cloneFields(fields: readonly SigningField[]): SigningField[] {
    return fields.map(field => ({
      ...field,
      bounds: { ...field.bounds },
      asset: field.asset ? { ...field.asset } : undefined,
    }));
  }

  private sameFields(a: readonly SigningField[], b: readonly SigningField[]): boolean {
    if (a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

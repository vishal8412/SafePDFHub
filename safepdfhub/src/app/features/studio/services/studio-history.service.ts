import {
  Injectable,
  computed,
  signal
} from '@angular/core';

import type {
  StudioPage
} from '../models/studio-page.model';

import type {
  StudioObject
} from '../models/studio-selection.model';

export interface StudioHistorySnapshot {
  readonly pages:
    readonly StudioPage[];

  readonly objects:
    readonly StudioObject[];

  readonly currentPage:
    number;
}

interface StudioHistoryEntry {
  readonly label:
    string;

  readonly before:
    StudioHistorySnapshot;

  readonly after:
    StudioHistorySnapshot;

  /**
   * Approximate serialized payload retained by this entry.
   *
   * F6.3 uses this to bound history memory in addition to the entry count.
   */
  readonly byteSize:
    number;
}

/**
 * F6.3 — Studio history manager.
 *
 * History stores immutable before/after snapshots. The service now also keeps
 * the retained snapshot payload bounded so image-heavy editing sessions cannot
 * grow indefinitely merely because every mutation captured the full document
 * object collection.
 */
@Injectable({
  providedIn: 'root'
})
export class StudioHistoryService {

  private readonly undoStack =
    signal<
      readonly StudioHistoryEntry[]
    >([]);

  private readonly redoStack =
    signal<
      readonly StudioHistoryEntry[]
    >([]);

  readonly canUndo =
    computed(
      () =>
        this.undoStack().length > 0
    );

  readonly canRedo =
    computed(
      () =>
        this.redoStack().length > 0
    );

  /**
   * Count cap remains useful for ordinary small documents.
   */
  private readonly maxEntries = 100;

  /**
   * Approximate total serialized history retained by this service.
   *
   * Snapshot cloning is intentionally simple and deterministic, but images can
   * contain large data URLs. The byte cap prevents the history from retaining
   * an unbounded number of those copies.
   */
  private readonly maxBytes =
    32 * 1024 * 1024;

  private undoBytes = 0;
  private redoBytes = 0;

  reset(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.undoBytes = 0;
    this.redoBytes = 0;
  }

  record(
    label: string,
    before: StudioHistorySnapshot,
    after: StudioHistorySnapshot
  ): void {

    const beforeJson =
      this.serializeSnapshot(before);

    const afterJson =
      this.serializeSnapshot(after);

    if (beforeJson === afterJson) {
      return;
    }

    const entry: StudioHistoryEntry = {
      label,
      before:
        this.cloneFromJson(beforeJson),
      after:
        this.cloneFromJson(afterJson),
      byteSize:
        beforeJson.length +
        afterJson.length
    };

    const nextUndo = [
      ...this.undoStack(),
      entry
    ];

    const boundedUndo =
      this.trimUndo(nextUndo);

    this.undoStack.set(
      boundedUndo.entries
    );

    this.undoBytes =
      boundedUndo.bytes;

    /**
     * A new mutation creates a new history branch.
     */
    this.redoStack.set([]);
    this.redoBytes = 0;
  }

  undo(): StudioHistorySnapshot | null {

    const entries =
      this.undoStack();

    const entry =
      entries[
        entries.length - 1
      ];

    if (!entry) {
      return null;
    }

    this.undoStack.set(
      entries.slice(0, -1)
    );

    this.undoBytes = Math.max(
      0,
      this.undoBytes - entry.byteSize
    );

    const nextRedo = [
      ...this.redoStack(),
      entry
    ];

    const boundedRedo =
      this.trimRedo(nextRedo);

    this.redoStack.set(
      boundedRedo.entries
    );

    this.redoBytes =
      boundedRedo.bytes;

    return this.cloneSnapshot(
      entry.before
    );
  }

  redo(): StudioHistorySnapshot | null {

    const entries =
      this.redoStack();

    const entry =
      entries[
        entries.length - 1
      ];

    if (!entry) {
      return null;
    }

    this.redoStack.set(
      entries.slice(0, -1)
    );

    this.redoBytes = Math.max(
      0,
      this.redoBytes - entry.byteSize
    );

    const nextUndo = [
      ...this.undoStack(),
      entry
    ];

    const boundedUndo =
      this.trimUndo(nextUndo);

    this.undoStack.set(
      boundedUndo.entries
    );

    this.undoBytes =
      boundedUndo.bytes;

    return this.cloneSnapshot(
      entry.after
    );
  }

  private trimUndo(
    entries: readonly StudioHistoryEntry[]
  ): {
    entries: readonly StudioHistoryEntry[];
    bytes: number;
  } {

    const mutable = [...entries];
    let bytes =
      this.sumBytes(mutable);

    while (
      mutable.length > this.maxEntries ||
      (
        bytes > this.maxBytes &&
        mutable.length > 1
      )
    ) {
      const removed =
        mutable.shift();

      bytes -=
        removed?.byteSize ?? 0;
    }

    return {
      entries: mutable,
      bytes: Math.max(0, bytes)
    };
  }

  private trimRedo(
    entries: readonly StudioHistoryEntry[]
  ): {
    entries: readonly StudioHistoryEntry[];
    bytes: number;
  } {

    const mutable = [...entries];
    let bytes =
      this.sumBytes(mutable);

    while (
      mutable.length > this.maxEntries ||
      (
        bytes > this.maxBytes &&
        mutable.length > 1
      )
    ) {
      /**
       * Remove the oldest redo state and preserve the nearest redo actions.
       */
      const removed =
        mutable.shift();

      bytes -=
        removed?.byteSize ?? 0;
    }

    return {
      entries: mutable,
      bytes: Math.max(0, bytes)
    };
  }

  private sumBytes(
    entries: readonly StudioHistoryEntry[]
  ): number {
    return entries.reduce(
      (total, entry) =>
        total + entry.byteSize,
      0
    );
  }

  private serializeSnapshot(
    snapshot: StudioHistorySnapshot
  ): string {
    return JSON.stringify(snapshot);
  }

  private cloneFromJson(
    serialized: string
  ): StudioHistorySnapshot {
    return JSON.parse(serialized) as StudioHistorySnapshot;
  }

  private cloneSnapshot(
    snapshot: StudioHistorySnapshot
  ): StudioHistorySnapshot {
    return this.cloneFromJson(
      this.serializeSnapshot(snapshot)
    );
  }
}

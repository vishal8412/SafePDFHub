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
}

/**
 * F5 — Studio history manager.
 *
 * The history stores immutable before/after snapshots instead of trying to
 * reverse each command manually. This makes page operations deterministic and
 * also gives future object editing features the same history foundation.
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
   * Keep history bounded so a very long editing session does not grow without
   * limit. Full snapshots are deliberate because correctness is more important
   * than command replay complexity at this stage.
   */
  private readonly maxEntries = 100;

  reset(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
  }

  record(
    label: string,
    before: StudioHistorySnapshot,
    after: StudioHistorySnapshot
  ): void {

    if (
      this.sameSnapshot(
        before,
        after
      )
    ) {
      return;
    }

    const nextUndo = [
      ...this.undoStack(),
      {
        label,
        before:
          this.cloneSnapshot(before),
        after:
          this.cloneSnapshot(after)
      }
    ];

    const boundedUndo =
      nextUndo.length >
        this.maxEntries
        ? nextUndo.slice(
            nextUndo.length -
              this.maxEntries
          )
        : nextUndo;

    this.undoStack.set(
      boundedUndo
    );

    /**
     * A new mutation creates a new history branch.
     */
    this.redoStack.set([]);
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

    this.redoStack.update(
      stack => [
        ...stack,
        entry
      ]
    );

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

    this.undoStack.update(
      stack => [
        ...stack,
        entry
      ]
    );

    return this.cloneSnapshot(
      entry.after
    );
  }

  private sameSnapshot(
    left: StudioHistorySnapshot,
    right: StudioHistorySnapshot
  ): boolean {

    return (
      left.currentPage ===
        right.currentPage &&
      JSON.stringify(
        left.pages
      ) ===
        JSON.stringify(
          right.pages
        ) &&
      JSON.stringify(
        left.objects
      ) ===
        JSON.stringify(
          right.objects
        )
    );
  }

  private cloneSnapshot(
    snapshot: StudioHistorySnapshot
  ): StudioHistorySnapshot {

    return {
      pages:
        this.cloneValue(
          snapshot.pages
        ),

      objects:
        this.cloneValue(
          snapshot.objects
        ),

      currentPage:
        snapshot.currentPage
    };
  }

  /**
   * Studio page/object models are persisted as plain data. JSON cloning keeps
   * every history entry isolated without sharing mutable nested style/point
   * objects with the live editor.
   */
  private cloneValue<T>(
    value: T
  ): T {

    return JSON.parse(
      JSON.stringify(value)
    ) as T;
  }
}

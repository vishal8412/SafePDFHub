import {
  Injectable,
  computed,
  signal
} from '@angular/core';

import type {
  StudioPage
} from '../models/studio-page.model';

@Injectable({
  providedIn: 'root'
})
export class StudioPageService {

  private readonly _pages =
    signal<readonly StudioPage[]>([]);

  readonly pages =
    this._pages.asReadonly();

  readonly pageCount =
    computed(() => this._pages().length);

  private normalizeBlankDimension(value: number,fallback: number): number {

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}
  initialize(
    sourcePageCount: number
  ): void {

    const count =
      Math.max(
        0,
        Math.floor(sourcePageCount)
      );

    this._pages.set(
      Array.from(
        { length: count },
        (_, index) => ({
          id:
            `source-${index + 1}-${this.token()}`,
          kind:
            'source' as const,
          sourcePageNumber:
            index + 1,
          rotation:
            0 as const
        })
      )
    );
  }

  clear(): void {
    this._pages.set([]);
  }

  pageAt(
    position: number
  ): StudioPage | null {

    return (
      this._pages()[position - 1] ??
      null
    );
  }

  /**
   * F5 — Return an immutable history snapshot of the logical page model.
   *
   * Page objects are cloned so history entries can never be changed by a
   * later page operation.
   */
  snapshot(): readonly StudioPage[] {
    return this.clonePages(
      this._pages()
    );
  }

  /**
   * F5 — Restore an exact logical page snapshot.
   *
   * This is intentionally a direct state replacement rather than replaying
   * page commands. That makes Undo/Redo deterministic for insert, delete,
   * duplicate, rotate and reorder operations.
   */
  restore(
    pages: readonly StudioPage[]
  ): void {

    this._pages.set(
      this.clonePages(pages)
    );
  }

  move(
    fromPosition: number,
    toPosition: number
  ): boolean {

    const pages =
      [...this._pages()];

    if (
      !this.validPosition(
        fromPosition,
        pages.length
      ) ||
      !this.validPosition(
        toPosition,
        pages.length
      ) ||
      fromPosition === toPosition
    ) {
      return false;
    }

    const [page] =
      pages.splice(
        fromPosition - 1,
        1
      );

    pages.splice(
      toPosition - 1,
      0,
      page
    );

    this._pages.set(pages);

    return true;
  }

  /**
   * Move multiple logical pages as one ordered group.
   *
   * `targetPosition` is expressed in the pre-mutation page order and the
   * selected pages are inserted immediately before that logical target.
   * Dropping a group onto one of its own members is treated as a no-op.
   */
  moveMany(
    positions: readonly number[],
    targetPosition: number
  ): boolean {

    const pages =
      [...this._pages()];

    const selected =
      Array.from(
        new Set(
          positions.filter(
            position =>
              this.validPosition(
                position,
                pages.length
              )
          )
        )
      ).sort(
        (a, b) => a - b
      );

    if (
      selected.length === 0 ||
      !Number.isInteger(
        targetPosition
      ) ||
      targetPosition < 1 ||
      targetPosition > pages.length + 1
    ) {
      return false;
    }

    const selectedSet =
      new Set(selected);

    if (
      targetPosition <= pages.length &&
      selectedSet.has(
        targetPosition
      )
    ) {
      return false;
    }

    const moving =
      selected.map(
        position =>
          pages[position - 1]
      );

    const remaining =
      pages.filter(
        (_, index) =>
          !selectedSet.has(
            index + 1
          )
      );

    /**
     * Convert the original target into an index in the list after the selected
     * pages have been removed.
     */
    const removedBeforeTarget =
      selected.filter(
        position =>
          position < targetPosition
      ).length;

    const insertionIndex =
      Math.max(
        0,
        Math.min(
          remaining.length,
          targetPosition -
            1 -
            removedBeforeTarget
        )
      );

    const next = [
      ...remaining.slice(
        0,
        insertionIndex
      ),
      ...moving,
      ...remaining.slice(
        insertionIndex
      )
    ];

    const changed =
      next.some(
        (page, index) =>
          page.id !==
          pages[index]?.id
      );

    if (!changed) {
      return false;
    }

    this._pages.set(next);

    return true;
  }

  /**
   * Move a selected set by one visual position without collapsing
   * non-contiguous selections into one contiguous block.
   */
  moveManyOneStep(
    positions: readonly number[],
    direction: 'up' | 'down'
  ): boolean {
    const pages = [...this._pages()];
    const selected = new Set(
      positions
        .filter(position => this.validPosition(position, pages.length))
        .map(position => pages[position - 1]?.id)
        .filter((id): id is string => !!id)
    );

    if (!selected.size) return false;

    const next = [...pages];

    if (direction === 'up') {
      for (let index = 1; index < next.length; index++) {
        if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
        }
      }
    } else {
      for (let index = next.length - 2; index >= 0; index--) {
        if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
        }
      }
    }

    const changed = next.some((page, index) => page.id !== pages[index]?.id);
    if (!changed) return false;

    this._pages.set(next);
    return true;
  }

  duplicate(
    position: number
  ): number | null {

    const pages =
      [...this._pages()];

    const source =
      pages[position - 1];

    if (!source) {
      return null;
    }

    const copy: StudioPage = {
      ...source,
      id:
        `${source.kind}-${this.token()}`
    };

    const target =
      position + 1;

    pages.splice(
      target - 1,
      0,
      copy
    );

    this._pages.set(pages);

    return target;
  }

  insertBlank(
  position: number,
  width = 595.28,
  height = 841.89
): number {

  const pages =
    [...this._pages()];

  const target =
    Math.min(
      Math.max(
        1,
        Math.floor(position)
      ),
      pages.length + 1
    );

  const blankWidth =
    this.normalizeBlankDimension(
      width,
      595.28
    );

  const blankHeight =
    this.normalizeBlankDimension(
      height,
      841.89
    );

  pages.splice(
    target - 1,
    0,
    {
      id:
        `blank-${this.token()}`,
      kind:
        'blank',
      sourcePageNumber:
        null,
      rotation:
        0,
      blankWidth,
      blankHeight
    }
  );

  this._pages.set(pages);

  return target;
}

  delete(
    position: number
  ): StudioPage | null {

    const pages =
      [...this._pages()];

    if (
      pages.length <= 1 ||
      !this.validPosition(
        position,
        pages.length
      )
    ) {
      return null;
    }

    const [removed] =
      pages.splice(
        position - 1,
        1
      );

    this._pages.set(pages);

    return (
      removed ??
      null
    );
  }

  rotate(
    position: number,
    delta: 90 | -90
  ): boolean {

    const pages =
      [...this._pages()];

    const page =
      pages[position - 1];

    if (!page) {
      return false;
    }

    const angle =
      (
        (
          (
            page.rotation +
            delta
          ) %
          360 +
          360
        ) %
        360
      ) as
        | 0
        | 90
        | 180
        | 270;

    pages[position - 1] = {
      ...page,
      rotation:
        angle
    };

    this._pages.set(pages);

    return true;
  }

  private clonePages(
    pages: readonly StudioPage[]
  ): readonly StudioPage[] {

    return pages.map(
      page => ({
        ...page
      })
    );
  }

  private validPosition(
    position: number,
    length: number
  ): boolean {

    return (
      Number.isInteger(position) &&
      position >= 1 &&
      position <= length
    );
  }

  private token(): string {

    return (
      `${Date.now().toString(36)}-` +
      `${Math.random()
        .toString(36)
        .slice(2, 9)}`
    );
  }
}

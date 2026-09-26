import { Injectable, computed, signal } from '@angular/core';
import type { PdfWatermarkRequest } from '../../../core/watermark/pdf-watermark.types';

/**
 * Studio-scoped watermark session state.
 *
 * The standalone Watermark tool remains responsible for file-to-file
 * watermarking. This service only owns the Studio editing intent: draft,
 * committed configuration and whether the Watermark inspector is open.
 */
@Injectable({ providedIn: 'root' })
export class StudioWatermarkStateService {
  readonly isOpen = signal(false);
  readonly draft = signal<PdfWatermarkRequest | null>(null);
  readonly committed = signal<PdfWatermarkRequest | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly hasUnappliedChanges = computed(() => {
    const draft = this.draft();
    const committed = this.committed();
    // A newly opened draft is itself an unapplied change. Once committed,
    // the draft and committed references intentionally point to the same
    // request until the user edits the draft again.
    return draft !== null && (committed === null || draft !== committed);
  });

  open(initial?: PdfWatermarkRequest | null): void {
    const request = initial ?? this.committed() ?? this.defaultRequest();
    this.error.set(null);
    this.draft.set(request);
    this.isOpen.set(true);
  }

  close(): void {
    if (this.busy()) return;
    this.error.set(null);
    this.isOpen.set(false);
  }

  updateDraft(request: PdfWatermarkRequest): void {
    this.error.set(null);
    this.draft.set(request);
  }

  apply(): PdfWatermarkRequest | null {
    const request = this.draft();
    if (!request) return null;
    this.committed.set(request);
    this.draft.set(request);
    this.error.set(null);
    return request;
  }

  /**
   * Remove the committed Studio watermark without touching the source PDF.
   *
   * Clearing the draft as well is important because the canvas intentionally
   * previews the draft while the inspector is open. Leaving the draft behind
   * would make a removed watermark remain visible until the inspector closed.
   */
  remove(): void {
    if (this.busy()) return;
    this.isOpen.set(false);
    this.draft.set(null);
    this.committed.set(null);
    this.error.set(null);
  }

  /**
   * Restore committed watermark state from the unified Studio history.
   *
   * History restoration is intentionally separate from apply/remove so an
   * Undo/Redo operation cannot accidentally create another history entry or
   * reopen the inspector.
   */
  restoreCommitted(request: PdfWatermarkRequest | null): void {
    this.error.set(null);
    this.draft.set(request);
    this.committed.set(request);
    this.isOpen.set(false);
    this.busy.set(false);
  }

  clear(): void {
    this.isOpen.set(false);
    this.draft.set(null);
    this.committed.set(null);
    this.error.set(null);
    this.busy.set(false);
  }

  setBusy(value: boolean): void {
    this.busy.set(value);
  }

  setError(message: string | null): void {
    this.error.set(message);
  }

  private defaultRequest(): PdfWatermarkRequest {
    return {
      kind: 'text',
      text: 'CONFIDENTIAL',
      opacity: 0.28,
      rotation: -35,
      position: 'center',
      pageSelection: { mode: 'all' },
      tiled: false,
      fontSize: 42,
      font: 'Helvetica',
      color: '#17324d',
      imageScalePercent: 28,
    };
  }
}

import {
  Injectable,
  computed,
  signal
} from '@angular/core';

import type { StudioPdfDocument } from '../models/pdf-document.model';
import type {
  PdfViewerState,
  PdfViewerStatus
} from '../models/pdf-viewer-state.model';

import type {
  StudioToolId
} from '../models/studio-tool.model';
import { StudioSelection } from '../models/studio-selection.model';

export type StudioViewMode =
  | 'fit-page'
  | 'fit-width'
  | 'zoom';

const INITIAL_VIEWER_STATE: PdfViewerState = {
  status: 'idle',
  currentPage: 1,
  pageCount: 0,
  zoom: 100,
  viewMode: 'fit-page',
  activeTool: 'select',
  selectedObjectId: null,
  selection: null,
  error: null
};

@Injectable({
  providedIn: 'root'
})
export class StudioStateService {

  private readonly _state =
    signal<PdfViewerState>(INITIAL_VIEWER_STATE);

  private readonly _document =
    signal<StudioPdfDocument | null>(null);

  /**
   * Public readonly signals.
   */
  readonly state = this._state.asReadonly();

  readonly document = this._document.asReadonly();

  /**
   * Convenient derived signals.
   */
  readonly status = computed(
    () => this._state().status
  );

  readonly isLoading = computed(
    () => this._state().status === 'loading'
  );

  readonly isReady = computed(
    () => this._state().status === 'ready'
  );

  readonly hasDocument = computed(
    () => this._document() !== null
  );

  readonly fileName = computed(
    () => this._document()?.name ?? 'Untitled.pdf'
  );

  readonly pageCount = computed(
    () => this._state().pageCount
  );

  readonly currentPage = computed(
    () => this._state().currentPage
  );

  readonly zoom = computed(
    () => this._state().zoom
  );

  readonly viewMode = computed(
    () => this._state().viewMode
  );

  readonly activeTool = computed(
    () => this._state().activeTool
  );

  readonly selectedObjectId = computed(
    () => this._state().selectedObjectId
  );

  readonly selection = computed(
    () => this._state().selection
  );

  readonly error = computed(
    () => this._state().error
  );

  /**
   * Start document loading.
   */
  beginLoading(): void {
    this._state.update(state => ({
      ...state,
      status: 'loading',
      error: null
    }));
  }

  /**
   * Store the successfully loaded PDF.
   */
  setDocument(document: StudioPdfDocument): void {
   this._document.set(document);
   this._state.set({
    status: 'ready',
    currentPage: 1,
    pageCount: document.pageCount,
    zoom: 50,
    viewMode: 'fit-page',
    activeTool: 'select',
    selectedObjectId: null,
    selection: null,
    error: null
  });
  }

  setActiveTool(activeTool: StudioToolId): void {
    this._state.update(state => ({
        ...state,
        activeTool
      })
    );
  }

  /**
   * Set an error without destroying the
   * currently loaded document.
   */
  setError(message: string): void {
    this._state.update(state => ({
      ...state,
      status: 'error',
      error: message
    }));
  }

  /**
   * Change zoom percentage.
   *
   * Rendering will consume this state later.
   */
  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) {
      return;
    }

    const normalizedZoom =
      Math.min(
        Math.max(Math.round(zoom), 50),
        200
      );

    this._state.update(state => ({
      ...state,
      zoom: normalizedZoom
    }));
  }

  setViewMode(viewMode: StudioViewMode): void {
  this._state.update(
    state => ({
      ...state,
      viewMode
    })
  );
}

  /**
   * Change current page.
   *
   * Rendering/navigation will consume this later.
   */
  setCurrentPage(page: number): void {
    const pageCount = this._state().pageCount;

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > pageCount
    ) {
      return;
    }

    this._state.update(state => ({
      ...state,
      currentPage: page
    }));
  }

  /**
   * Clear the complete Studio document state.
   */
  clear(): void {
    this._document.set(null);
    this._state.set(INITIAL_VIEWER_STATE);
  }

  /**
   * Utility for future state transitions.
   */
  setStatus(status: PdfViewerStatus): void {
    this._state.update(state => ({
      ...state,
      status
    }));
  }

  setSelection(selection: StudioSelection): void {
  this._state.update(
    state => ({
      ...state,
      selectedObjectId:
        selection.objectId,
      selection
    })
  );
  }

  clearSelection(): void {
  this._state.update(
    state => ({
      ...state,
      selectedObjectId: null,
      selection: null
    })
  );
}


}
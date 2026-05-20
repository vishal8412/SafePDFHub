import { Injectable } from '@angular/core';
import { WorkspaceFile } from '../models/workspace-file.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceStateService {

  workspaceFiles: WorkspaceFile[] = [];

  activeIndex = -1;

  dragIndex: number | null = null;

  hoverIndex: number | null = null;

  isDragging = false;

  hasMerged = false;

  loading = false;

  lastMergedUrl: string | null = null;

  // =====================
  // GETTERS
  // =====================

  get files(): File[] {
    return this.workspaceFiles.map(w => w.file);
  }

  get previews(): string[] {
    return this.workspaceFiles.map(w => w.preview || '');
  }

  get pageCounts(): number[] {
    return this.workspaceFiles.map(w => w.pageCount || 0);
  }

  get previewLoading(): boolean[] {
    return this.workspaceFiles.map(w => w.previewLoading);
  }

  get previewProgress(): number[] {
    return this.workspaceFiles.map(w => w.previewProgress);
  }

  get previewError(): boolean[] {
    return this.workspaceFiles.map(w => w.previewError);
  }

}
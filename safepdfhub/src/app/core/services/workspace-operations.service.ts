import { Injectable } from '@angular/core';
import { WorkspaceStateService } from './workspace-state.service';
import { WorkspaceFile } from '../models/workspace-file.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceOperationsService {

  constructor(
    private workspace: WorkspaceStateService
  ) {}

  addFiles(items: WorkspaceFile[]) {
    this.workspace.workspaceFiles = [
      ...this.workspace.workspaceFiles,
      ...items
    ];
  }

  replaceAll(items: WorkspaceFile[]) {
    this.workspace.workspaceFiles = items;
  }

  removeFile(index: number) {
    this.workspace.workspaceFiles =
      this.workspace.workspaceFiles.filter((_, i) => i !== index);

    if (this.workspace.activeIndex >= this.workspace.files.length) {
      this.workspace.activeIndex =
        this.workspace.files.length - 1;
    }
  }

  restoreFile(index: number, item: WorkspaceFile) {

    const cloned = [...this.workspace.workspaceFiles];

    cloned.splice(index, 0, item);

    this.workspace.workspaceFiles = cloned;
  }

  reorder(from: number, to: number) {

    const cloned = [...this.workspace.workspaceFiles];

    const moved = cloned.splice(from, 1)[0];

    cloned.splice(to, 0, moved);

    this.workspace.workspaceFiles = cloned;

    this.workspace.activeIndex = to;
  }

  clear() {
    this.workspace.workspaceFiles = [];

    this.workspace.activeIndex = -1;

    this.workspace.dragIndex = null;

    this.workspace.hoverIndex = null;

    this.workspace.isDragging = false;

    this.workspace.hasMerged = false;
  }

  cleanupPreviews() {
     this.workspace.previews.forEach(p => {
     if (p) URL.revokeObjectURL(p);
    });
  }

}
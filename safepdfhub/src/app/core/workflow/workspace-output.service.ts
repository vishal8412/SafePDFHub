import { Injectable } from '@angular/core';
import { WorkspaceOperationsService } from '../services/workspace-operations.service';
import { WorkspaceStateService } from '../services/workspace-state.service';

export interface WorkspaceResult {

  file: File;

  previewGenerator: (
    file: File,
    id: string
  ) => Promise<void>;

}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceOutputService {

  constructor(
    private workspaceOps: WorkspaceOperationsService,
    private workspace: WorkspaceStateService
  ) {}

  async showResult(result: WorkspaceResult): Promise<void> {
    const id = crypto.randomUUID();

    // Prevent memory leak
    if (this.workspace.lastMergedUrl) {
      URL.revokeObjectURL(this.workspace.lastMergedUrl);
    }

    // Replace current workspace
    this.workspaceOps.replaceAll([
      {
        id,
        file: result.file,
        preview: '',
        pageCount: 0,
        previewLoading: true,
        previewProgress: 0,
        previewError: false,
        previewQueued: false
      }
    ]);

    // Generate thumbnail
    await result.previewGenerator(
      result.file,
      id
    );

    // Mark completed
    this.workspace.hasMerged = true;

    // Store download URL
    this.workspace.lastMergedUrl = URL.createObjectURL(result.file);

  }

}
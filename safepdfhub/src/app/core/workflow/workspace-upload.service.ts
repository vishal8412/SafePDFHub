import { Injectable } from '@angular/core';

import { WorkspaceOperationsService } from '../services/workspace-operations.service';
import type { WorkspaceFile } from '../models/workspace-file.model';
import { WorkspaceStateService } from '../services/workspace-state.service';

@Injectable({
    providedIn: 'root'
})
export class WorkspaceUploadService {

    constructor(
        private workspaceOps: WorkspaceOperationsService,
        private workspace: WorkspaceStateService
    ) { }

    addFiles(files: File[], replaceExisting: boolean): number {
        if (replaceExisting) {
            this.workspaceOps.clear();
            this.workspace.activeIndex = -1;
        }

        const startIndex = this.workspace.files.length;
        const items: WorkspaceFile[] = files.map((file): WorkspaceFile => ({
            id: crypto.randomUUID(),
            file,
            preview: '',
            pageCount: 0,
            previewLoading: false,
            previewProgress: 0,
            previewError: false,
            previewQueued: false,
            validationState: 'checking'
        }));

        this.workspaceOps.addFiles(items);

        return startIndex;
    }

}
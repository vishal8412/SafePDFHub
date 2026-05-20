import { Injectable } from '@angular/core';

import { MergeEngine }
from '../../../core/engines/merge.engine';

@Injectable({
  providedIn: 'root'
})
export class MergeFacade {

  constructor(
    private mergeEngine: MergeEngine
  ) {}

  async merge(
    files: File[],
    onProgress?: (progress: number) => void
  ) {

    return this.mergeEngine.merge(
      files,
      onProgress
    );
  }
}
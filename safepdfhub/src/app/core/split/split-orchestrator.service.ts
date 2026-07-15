import { Injectable } from '@angular/core';

import { SplitEngine } from '../engines/split.engine';

import { SplitExportService } from './split-export.service';

import {
  SplitMode,
  SplitOutput,
  SplitOptions,
  SplitGroup
} from './split.types';

@Injectable({
  providedIn: 'root'
})

export class SplitOrchestratorService {

  constructor(

    private splitEngine: SplitEngine,

    private splitExport: SplitExportService

  ) {}

  async splitPdf(

    source: File,

    mode: SplitMode,

    options: SplitOptions

  ): Promise<SplitOutput> {

    let groups: SplitGroup[] = [];

    switch (mode) {

      case 'range':

        groups =
          this.splitEngine.splitByRanges(
            options.pageRanges ?? ''
          );

        break;

      case 'every-page':

        groups =
          this.splitEngine.splitEveryPage(
            options.totalPages
          );

        break;

      case 'every-n':

        groups =
          this.splitEngine.splitEveryN(
            options.totalPages,
            options.everyN ?? 1
          );

        break;

      case 'extract':

        groups =
          this.splitEngine.extractPages(
            options.selectedPages ?? []
          );

        break;

      default:

        groups = [];

    }

    return this.splitExport.export(
      source,
      groups
    );

  }

}
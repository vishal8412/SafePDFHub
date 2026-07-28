import { Injectable } from '@angular/core';
import { MergeEngine } from '../engines/merge.engine';
import { CompressEngine } from '../engines/compress.engine';
import { CompressionPlanner } from '../compression/compression-planner';
import { PdfAnalyzer } from '../compression/pdf-analyzer.service';

export type WorkflowStep = 'merge' | 'compress' | 'split';

@Injectable({ providedIn: 'root' })
export class WorkflowService {

  constructor(
    private mergeEngine: MergeEngine,
    private compressEngine: CompressEngine,
    private pdfAnalyzer: PdfAnalyzer,
    private compressionPlanner: CompressionPlanner
  ) {}

  detectWorkflow(files: File[], pageCounts: number[]): WorkflowStep[] {
    const totalSizeMB =
      files.reduce((a, f) => a + f.size, 0) / (1024 * 1024);

    const maxPages = Math.max(...pageCounts.filter(Boolean), 0);

    const steps: WorkflowStep[] = [];

    if (files.length > 1) steps.push('merge');
    if (totalSizeMB > 20) steps.push('compress');
    if (maxPages > 300) steps.unshift('split');

    return steps;
  }

  async runWorkflow(
    files: File[],
    pageCounts: number[],
    onProgress?: (p: number, step: string) => void
  ): Promise<File> {

    let workingFiles = [...files];
    const steps = this.detectWorkflow(files, pageCounts);

    const totalSteps = steps.length;
    let currentStep = 0;

    for (const step of steps) {currentStep++;
      if (step === 'merge') {
        const merged = await this.mergeEngine.merge(workingFiles, (p) => {
          onProgress?.(this.mapProgress(p, currentStep, totalSteps), 'merge');
        });

        workingFiles = [merged];
      }

      else if (step === 'compress') {
        const analysis = await this.pdfAnalyzer.analyzeFile(workingFiles[0]);
        const plan = this.compressionPlanner.createPlan(analysis.analysis,analysis.pages,'recommended');
        const compressed = await this.compressEngine.compress(workingFiles[0],'recommended',plan,(p) => {
            onProgress?.(this.mapProgress(p,currentStep,totalSteps),'compress');});
            
        workingFiles = [compressed];
      }

      await new Promise(r => setTimeout(r, 0));
    }

    return workingFiles[0];
  }

  private mapProgress(p: number, step: number, total: number): number {
    const stepSize = 100 / total;
    return Math.round((step - 1) * stepSize + (p / 100) * stepSize);
  }
}
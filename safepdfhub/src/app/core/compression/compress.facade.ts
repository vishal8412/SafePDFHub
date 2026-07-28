import { Injectable } from '@angular/core';
import { CompressionState } from './compression.state';
import { CompressEngine } from '../engines/compress.engine';
import { CompressionEstimate } from './compression.models';
import { CompressionPlanner } from './compression-planner';
import { PdfAnalyzer } from './pdf-analyzer.service';
@Injectable({
    providedIn: 'root'
})
export class CompressionFacade {

    constructor(private pdfAnalyzer: PdfAnalyzer, 
        private compressEngine: CompressEngine, 
        private compressionPlanner: CompressionPlanner,
        public state: CompressionState) { }

    async analyze(file: File): Promise<CompressionEstimate> {
        const sizeMB = file.size / 1024 / 1024;
        const result = await this.pdfAnalyzer.analyzeFile(file);
        this.state.analyzedPdfType = result.type;
        this.state.pdfInsights = result.analysis;
        // const pages = result.pages;
        // let reduction = 0;
        // const imageRatio = result.analysis.imageRatio;
        // const dpi = result.analysis.estimatedDpi;
        // reduction = imageRatio * 50;

        const plan = this.compressionPlanner.createPlan(result.analysis,result.pages,this.state.compressionLevel);

        this.state.estimatedReduction = plan.estimatedReduction;

        this.state.estimatedFinalSize = sizeMB * (1 - plan.estimatedReduction / 100);

        // if (dpi > 250) {
        //     reduction += 15;
        // }
        // if (result.analysis.largePages) {
        //     reduction += 10;
        // }
        // switch (this.state.compressionLevel) {
        //     case 'light':
        //         reduction *= 0.6;
        //         break;
        //     case 'recommended':
        //         reduction *= 1;
        //         break;
        //     case 'strong':
        //         reduction *= 1.4;
        //         break;
        // }

        // reduction = Math.min(Math.round(reduction), 80);

        // // very huge PDFs
        // if (pages > 1000) {
        //     reduction = Math.min(reduction, 10);
        // }

        // this.state.estimatedReduction = reduction;
        // this.state.estimatedFinalSize = sizeMB * (1 - reduction / 100);

        console.log('CompressionFacade');
        console.log({
          analysis: result.analysis,
          plan,
          estimatedReduction: this.state.estimatedReduction,
          estimatedFinalSize: this.state.estimatedFinalSize
        });
        return {
            estimatedReduction: plan.estimatedReduction,
            estimatedFinalSize: this.state.estimatedFinalSize
        };

    }

    async compress(file: File): Promise<File> {
      const startedAt = performance.now();
      const analysis = await this.pdfAnalyzer.analyzeFile(file);
      const plan = this.compressionPlanner.createPlan(analysis.analysis,analysis.pages,this.state.compressionLevel);

      this.state.compressing = true;
      this.state.progress = 0;
      this.state.stage = 'analysis';
      try {
       const result = await this.compressEngine.compress(file,this.state.compressionLevel,plan,(p) => {
        this.state.progress = p;
       });
        this.state.compressedFile = result;  
        this.state.originalSize = file.size;  
        this.state.finalSize = result.size;  
        this.state.reduction = Math.max(0,Math.round(((this.state.originalSize - this.state.finalSize) / this.state.originalSize) * 100));  
        this.state.duration = ((performance.now() - startedAt) / 1000).toFixed(1) + 's';  
        this.state.estimatedFinalSize = result.size / 1024 / 1024;  
        this.state.estimatedReduction = this.state.reduction;  
        return result;  
      }
      finally {  
        this.state.compressing = false;  
        this.state.progress = 100;  
      }

    }

    reset() { }

    replacePdf() { }

    download() { }

}
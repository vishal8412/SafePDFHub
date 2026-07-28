import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { PdfAnalysis, PageAnalysis } from '../compression/pdf-analysis.models';
import { CompressionPlan } from '../compression/compression-plan';
import { PdfAnalyzer } from '../compression/pdf-analyzer.service';
import { CompressionPlanner } from '../compression/compression-planner';
import { PdfPageRendererService } from '../compression/pdf-page-renderer.service';
import { PdfPageEmbedderService } from '../compression/pdf-page-embedder.service';
let pdfjsPromise: Promise<any> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(lib);
      };

      document.body.appendChild(script);
    });
  }

  return pdfjsPromise;
}

export interface CompressionResult {
  file: File;
  analysis: PdfAnalysis;
  alreadyCompressed: boolean;
}

@Injectable({
  providedIn: 'root'
})

export class CompressEngine {

 private worker?: Worker;

 constructor(
  private pdfAnalyzer: PdfAnalyzer, 
  private compressionPlanner: CompressionPlanner,
  private pageRenderer: PdfPageRendererService,
  private pageEmbedder: PdfPageEmbedderService) {
   if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('../workers/pdf-compression.worker',import.meta.url));
    }
 }

// =====================
// MAIN ENTRY
// =====================
 async compress(file: File,
  level:
    | 'light'
    | 'recommended'
    | 'strong',
  plan: CompressionPlan,
  onProgress?: (p: number) => void
): Promise<File> {

  const {pdf,buffer} = await this.loadPdfForAnalysis(file);
  const totalPages = pdf.numPages;
  const alreadyCompressed = this.detectAlreadyCompressed(file.size,totalPages);
  if (alreadyCompressed) {
   console.log('Already compressed PDF detected');
    return this.safeCompress(file,'light',onProgress);
  }
  
  const analysis = await this.pdfAnalyzer.analyzePdfStructure(pdf);
  console.log('PDF Analysis',analysis);
  
  pdf.destroy();

  // NEVER rasterize huge PDFs
  if (totalPages > 3000 || file.size > 500 * 1024 * 1024) {
    return this.safeCompress(file, level, onProgress);
  }
  // TEXT PDFs
  switch (plan.strategy) {
    case 'safe':
        return this.safeCompress(file,level,onProgress);
    case 'smart':
        return this.smartCompress(file,plan,onProgress);
    case 'strong':
        return this.strongCompress(file,plan,onProgress);
    default:
        return this.safeCompress(file,level,onProgress);
  }

}

  // =====================
  // SAFE (TEXT PDF)
  // =====================
 async safeCompress(
  file: File,
  level:
    | 'light'
    | 'recommended'
    | 'strong',

  onProgress?: (p: number) => void
 ): Promise<File> {

  const existingPdfBytes = await file.arrayBuffer();

  const pdfDoc = await PDFDocument.load(existingPdfBytes,
      {
        ignoreEncryption: true,
        updateMetadata: false
      }
  );

  onProgress?.(20);

  // cleanup metadata
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  onProgress?.(40);

  const objectsPerTick = this.compressionPlanner.getObjectsPerTick(level);

  const compressedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick,
      updateFieldAppearances: false
  });

  if (compressedBytes.length >= file.size) {
   console.log('Already optimized PDF');
   return file;
  }

  onProgress?.(100);
  console.log('SAFE COMPRESS',file.size);

  return new File([new Uint8Array(compressedBytes)],this.rename(file.name),
  {
    type: 'application/pdf'
  });
  
}

// =====================
// STRONG (SCANNED PDF)
// =====================

async strongCompress(
    file: File,
    plan: CompressionPlan,
    onProgress?: (p: number) => void): Promise<File>{
  const {buffer,sourcePdf,pdf} = await this.loadSourcePdf(file);
  const totalPages = pdf.numPages;
  const newPdf = await PDFDocument.create();

  // PROFESSIONAL SETTINGS
  let quality = plan.quality;
  let maxWidth = plan.maxWidth;
  let maxHeight = plan.maxHeight;

  // HUGE PDF PROTECTION
  if (totalPages > 1000) {
    quality *= 0.9;
    maxWidth *= 0.8;
    maxHeight *= 0.8;
  }

  // PAGE LOOP
  const BATCH_SIZE = 10;
  for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
    for (let i = batchStart; i <= batchEnd; i++) {
      const page = await pdf.getPage(i);
      const analysis = await this.pdfAnalyzer.analyzePage(page);

    // VECTOR PAGE PRESERVATION
    if (analysis.type === 'text') {
      console.log('PAGE',i,analysis.type,analysis.textDensity);
      await this.copyOriginalPage(sourcePdf,newPdf,i - 1);
      continue;
    }

    // IMPORTANT
    const adaptiveQuality = this.compressionPlanner.getAdaptiveQuality(plan, analysis);
    const viewport = page.getViewport({scale: 1});
    const scale = this.compressionPlanner.getAdaptiveScale(plan,viewport,analysis);
    const renderWidth = Math.floor(viewport.width * scale);
    const renderHeight = Math.floor(viewport.height * scale);
    const ratio = Math.min(maxWidth / renderWidth,maxHeight / renderHeight,1);
    const finalWidth = Math.floor(renderWidth * ratio);
    const finalHeight = Math.floor(renderHeight * ratio);

    // CANVAS
    
    // EMBED IMAGE
    const bytes = await this.renderPageToJpeg(page,finalWidth,finalHeight,adaptiveQuality);
    await this.addJpegPage(newPdf,bytes);

    // progress
    onProgress?.(Math.round((i / totalPages) * 100));

  }
  
  // BATCH CLEANUP
  await new Promise(resolve =>
    setTimeout(resolve, 40)
  );

}

  pdf.destroy();

  // =====================================
  // SAVE PDF
  // =====================================
  console.log('newPdf pages:',newPdf.getPageCount());

  const pdfBytes = await newPdf.save({useObjectStreams: true});
  const compressedFile = new File([new Uint8Array(pdfBytes)],this.rename(file.name),{type: 'application/pdf'});
  console.log('pdfBytes length:', pdfBytes.length);
  console.log('compressedFile size:', compressedFile.size);

  // =====================================
  // DO NOT RETURN LARGER FILES
  // =====================================
  console.log('ORIGINAL:', file.size);
  console.log('COMPRESSED:', compressedFile.size);
  console.log('RATIO:',(compressedFile.size / file.size) * 100);

  if (compressedFile.size >= file.size) {
    console.warn('Compression increased size. Returning original.');
    return file;
  }
  const reduction = ((file.size - compressedFile.size) / file.size) * 100;
  if (reduction < 1) {
    console.log('Compression gain too small');
    return compressedFile;
  }

  console.log('Total output pages:',newPdf.getPageCount());
  return compressedFile;
}

// =====================
// Smart Compress
// =====================
async smartCompress(file: File, plan: CompressionPlan, onProgress?: (p:number)=>void): Promise<File> {
  const {sourcePdf,pdf} = await this.loadSourcePdf(file);
  const newPdf = await PDFDocument.create();
  const totalPages = pdf.numPages;

  for(let i=1;i<=totalPages;i++){
      const page = await pdf.getPage(i);
      const analysis = await this.pdfAnalyzer.analyzePage(page);
      if(analysis.type === 'text'){
         await this.copyOriginalPage(sourcePdf,newPdf,i - 1);
      }
      else{
         await this.compressPage(page,newPdf,plan);
      }

      onProgress?.(Math.round(i/totalPages*100));
  }

  const bytes = await newPdf.save({useObjectStreams:true});
  const result = new File([new Uint8Array(bytes)],this.rename(file.name),{type:'application/pdf'});
  return result.size < file.size ? result : file;
}

  // =====================
  // HELPERS
  // =====================
  private dataURLToUint8Array(dataURL: string): Uint8Array {
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);

    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  private rename(name: string): string {
    const cleanName = name.replace(/\.pdf$/i, '');
    return `${cleanName}-safepdfhub_compressed.pdf`;
  }

private compressInWorker(imageBlob: Blob,width: number,height: number,quality: number): Promise<Uint8Array> {
  return new Promise(async (resolve, reject) => {
      if (!this.worker) {
        reject('Worker unavailable');
        return;
      }
      const handleMessage = (event: MessageEvent) => {
          if (event.data.success) {
            resolve(new Uint8Array(event.data.bytes));
          } else {
            reject(event.data.error);
          }
          this.worker?.removeEventListener('message',handleMessage);
      };
      this.worker.addEventListener('message',handleMessage);
      this.worker.postMessage({pageData: imageBlob,width,height,quality});
    }
  );
}

private detectAlreadyCompressed(fileSize: number,pages: number): boolean {
  if (!pages) {
    return false;
  }
  const bytesPerPage = fileSize / pages;
  return bytesPerPage < 15000;
}

private async compressPage(page: any,newPdf: PDFDocument,plan: CompressionPlan) {
  const viewport = page.getViewport({
    scale: plan.scale
  });

  const bytes = await this.renderPageToJpeg(
    page,
    Math.floor(viewport.width),
    Math.floor(viewport.height),
    plan.quality
  );

  await this.addJpegPage(newPdf, bytes);
}

private async copyOriginalPage(sourcePdf: PDFDocument,targetPdf: PDFDocument,pageIndex: number): Promise<void> {
   const copiedPages = await targetPdf.copyPages(sourcePdf,[pageIndex]);
   targetPdf.addPage(copiedPages[0]);
}

private async renderPageToJpeg(
    page: any,
    width: number,
    height: number,
    quality: number
): Promise<Uint8Array> {
    return this.pageRenderer.renderToJpeg(
        page,
        width,
        height,
        quality
    );
}

private async addJpegPage(pdf: PDFDocument,jpegBytes: Uint8Array): Promise<void> {
    return this.pageEmbedder.addJpegPage(pdf,jpegBytes);
}

private async loadSourcePdf(file: File) {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(buffer);
    const pdf = await pdfjs.getDocument({data: buffer}).promise;
    return {buffer,pdf,sourcePdf};
}

private async loadPdfForAnalysis(file: File) {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({data: buffer}).promise;

    return {pdf,buffer};
}

// private supportsWebP(): boolean {
  //   try {
  //     const canvas = document.createElement('canvas');
  //     return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  //   } catch {
  //     return false;
  //   }
  // }

}
import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';

let pdfjsPromise: Promise<any> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }

      const script = document.createElement('script');
      script.src =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

      script.onload = () => {
        const lib = (window as any).pdfjsLib;

        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        resolve(lib);
      };

      document.body.appendChild(script);
    });
  }

  return pdfjsPromise;
}

interface PdfAnalysis {
  type:
    | 'text'
    | 'scanned'
    | 'mixed';

  avgTextDensity: number;
  estimatedDpi: number;
  largePages: boolean;
  imageHeavy: boolean;
  imageRatio: number;
}

interface PageAnalysis {
  type: 'text' | 'scanned' | 'mixed';
  textDensity: number;
  estimatedImageArea: number;
  estimatedPhotoPage: boolean;
  shouldRasterize: boolean;
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

 constructor() {
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

  onProgress?: (p: number) => void
): Promise<File> {

  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({data: buffer}).promise;
  const totalPages = pdf.numPages;
  const alreadyCompressed = this.detectAlreadyCompressed(file.size,totalPages);
  if (alreadyCompressed) {
   console.log('Already compressed PDF detected');
    return this.safeCompress(file,'light',onProgress);
  }
  
  const type = await this.detectPdfType(pdf);
  const analysis = await this.analyzePdfStructure(pdf);
  console.log('PDF Analysis',analysis);
  
  pdf.destroy();

  // NEVER rasterize huge PDFs
  if (totalPages > 3000 || file.size > 500 * 1024 * 1024) {
    return this.safeCompress(file, level, onProgress);
  }
  // TEXT PDFs
  if (analysis.type === 'text' && !analysis.imageHeavy && file.size < 10 * 1024 * 1024) {
    console.log('FORCED STRONG COMPRESSION');
    return this.safeCompress(
      file,
      level,
      onProgress
    );
  }

if (analysis.avgTextDensity > 70 && analysis.imageRatio < 0.30) {
  console.log('DOCUMENT PDF');
  return this.safeCompress(
    file,
    level,
    onProgress
  );
}

  return this.strongCompress(file, level, onProgress);

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

  let objectsPerTick = 50;

  if (level === 'light') {
    objectsPerTick = 80;
  }

  if (level === 'recommended') {
    objectsPerTick = 50;
  }

  if (level === 'strong') {
    objectsPerTick = 25;
  }

  const compressedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick,
      updateFieldAppearances: false
  });

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
  level: 'light' | 'recommended' | 'strong',
  onProgress?: (p: number) => void
): Promise<File> {

  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const sourcePdf = await PDFDocument.load(buffer);
  const pdf = await pdfjs.getDocument({data: buffer}).promise;
  const totalPages = pdf.numPages;
  const newPdf = await PDFDocument.create();

  // PROFESSIONAL SETTINGS

  let quality = 0.82;
  let MAX_WIDTH = 1800;
  let MAX_HEIGHT = 2400;

  // LIGHT
  if (level === 'light') {
    quality = 0.90;
    MAX_WIDTH = 2400;
    MAX_HEIGHT = 3200;
  }

  // RECOMMENDED
  if (level === 'recommended') {
    quality = 0.80;
    MAX_WIDTH = 1400;
    MAX_HEIGHT = 1900;
  }

  // STRONG
  if (level === 'strong') {
    quality = 0.65;
    MAX_WIDTH = 1000;
    MAX_HEIGHT = 1400;
  }

  // HUGE PDF PROTECTION

  if (totalPages > 1000) {
    quality *= 0.9;
    MAX_WIDTH *= 0.8;
    MAX_HEIGHT *= 0.8;
  }

  // PAGE LOOP

  const BATCH_SIZE = 10;

  for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
    for (let i = batchStart; i <= batchEnd; i++) {
      const page = await pdf.getPage(i);
      const analysis = await this.analyzePage(page);

    // VECTOR PAGE PRESERVATION
  
    if (analysis.type === 'text') {
      console.log('PAGE',i,analysis.type,analysis.textDensity);
      const copiedPages = await newPdf.copyPages(sourcePdf,[i - 1]);
      newPdf.addPage(copiedPages[0]);
      continue;
    }

    // IMPORTANT
    const adaptiveQuality = this.getAdaptiveQuality(analysis, level);
    const viewport = page.getViewport({scale: 1});
    const scale = this.calculateAdaptiveScale(viewport,analysis,level);
    const renderWidth = Math.floor(viewport.width * scale);
    const renderHeight = Math.floor(viewport.height * scale);
    const ratio = Math.min(MAX_WIDTH / renderWidth,MAX_HEIGHT / renderHeight,1);
    const finalWidth = Math.floor(renderWidth * ratio);
    const finalHeight = Math.floor(renderHeight * ratio);

    // CANVAS
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      continue;
    }

    canvas.width = finalWidth;
    canvas.height = finalHeight;

    // better rendering quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // RENDER PDF PAGE
    const scaledViewport = page.getViewport({scale: finalWidth /viewport.width});
    await page.render({canvasContext: ctx, viewport: scaledViewport}).promise;

    page.cleanup();

    // CONVERT TO JPEG
    const blob = await new Promise<Blob>(resolve => {canvas.toBlob(b => resolve(b!),'image/jpeg',adaptiveQuality);});
    let bytes: Uint8Array;
    try {
      bytes = await this.compressInWorker(blob,finalWidth,finalHeight,adaptiveQuality);
    } catch {
      bytes = new Uint8Array(await blob.arrayBuffer());
    }

    // EMBED IMAGE
    const img = await newPdf.embedJpg(bytes);
    const pdfPage = newPdf.addPage([img.width, img.height]);
    pdfPage.drawImage(img, {x: 0, y: 0, width: img.width, height: img.height});

    // CLEANUP MEMORY
    canvas.width = 0;
    canvas.height = 0;

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

  const compressedFile =
    new File(
      [new Uint8Array(pdfBytes)],
      this.rename(file.name),
      {
        type: 'application/pdf'
      }
    );

    console.log('pdfBytes length:', pdfBytes.length);
console.log('compressedFile size:', compressedFile.size);

  // =====================================
  // DO NOT RETURN LARGER FILES
  // =====================================

  console.log('ORIGINAL:', file.size);
  console.log('COMPRESSED:', compressedFile.size);
  console.log('RATIO:',(compressedFile.size / file.size) * 100);
  // if (compressedFile.size >= file.size * 0.98) {
  //   return file;
  // }
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
async smartCompress(
  file: File,
  level:
    | 'light'
    | 'recommended'
    | 'strong',
  onProgress?: (p:number)=>void
): Promise<File> {

  return this.strongCompress(
    file,
    level,
    onProgress
  );
}

  // =====================
  // TYPE DETECTION
  // =====================

  private getSamplePages(totalPages: number): number[] {
    if (totalPages <= 10) {
      return Array.from({ length: totalPages },(_, i) => i + 1);
    }

    return [
      1,
      Math.floor(totalPages * 0.25),
      Math.floor(totalPages * 0.50),
      Math.floor(totalPages * 0.75),
      totalPages
    ];
  }

async detectPdfType(pdf: any): Promise<'text' | 'scanned' | 'mixed'> {
  let textPages = 0;
  let scannedPages = 0;
  const samplePages = this.getSamplePages(pdf.numPages);

  for (const pageNo of samplePages) {
    const page = await pdf.getPage(pageNo);
    try {
      const text = await page.getTextContent();
      if (text.items.length > 120) {
        textPages++;
      } else {
        scannedPages++;
      }
    } catch {
      scannedPages++;
    }
    page.cleanup();
  }

  if (textPages === samplePages.length) {
    return 'text';
  }

  if (scannedPages === samplePages.length) {
    return 'scanned';
  }

  return 'mixed';
}

async analyzeFile(file: File) {

  const pdfjs = await loadPdfJs();

  const buffer = await file.arrayBuffer();

  const pdf =
    await pdfjs.getDocument({
      data: buffer
    }).promise;

  const type =
    await this.detectPdfType(pdf);

  const analysis =
    await this.analyzePdfStructure(pdf);

  const pages =
    pdf.numPages;

  pdf.destroy();

  return {
    type,
    analysis,
    pages
  };
}

async analyzePdfStructure(pdf: any): Promise<PdfAnalysis> {
  let textItems = 0;
  let largePages = false;
  let imageHeavyPages = 0;
  const pagesToCheck = Math.min(5, pdf.numPages);
  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });

    // large page detection
    if (viewport.width > 1000 || viewport.height > 1400) {
      largePages = true;
    }
    try {
      const text = await page.getTextContent();
      textItems += text.items.length;

      // low text = likely scanned
      if (text.items.length < 50) {
        imageHeavyPages++;
      }

    } catch {}

    page.cleanup();
  }

  const avgTextDensity = textItems / pagesToCheck;
  const estimatedDpi = largePages ? 300 : avgTextDensity > 150 ? 200 : 150;
  const imageRatio = imageHeavyPages / pagesToCheck;

  let type:
    | 'text'
    | 'scanned'
    | 'mixed';

  if (avgTextDensity > 180 && imageRatio < 0.20) {
    type = 'text';
  }
  else if (avgTextDensity < 40) {
    type = 'scanned';
  }
  else {
    type = 'mixed';
  }

  return {
    type,
    avgTextDensity,
    estimatedDpi: estimatedDpi,
    largePages,
    imageHeavy: imageRatio > 0.4,
    imageRatio
  };
}

async analyzePage(page: any): Promise<PageAnalysis> {
  let textItems = 0;
  try {
    const text = await page.getTextContent();
    textItems = text.items.length;
  } catch {}
  const viewport = page.getViewport({scale: 1});
  const pageArea = viewport.width *viewport.height;
  let estimatedImageArea = 0;
  if (textItems < 40) {
    estimatedImageArea = pageArea * 0.95;
  }
  else if (textItems < 120) {
    estimatedImageArea = pageArea * 0.60;
  }
  else {
    estimatedImageArea = pageArea * 0.20;
  }

  let type: 'text' | 'mixed' | 'scanned';
  if (textItems > 80) {
    type = 'text';
  } else if (textItems < 40) {
    type = 'scanned';
  } else {
    type = 'mixed';
  }

  return {
    type,
    textDensity: textItems,
    estimatedImageArea,
    estimatedPhotoPage: estimatedImageArea > pageArea * 0.50,
    shouldRasterize: type !== 'text'
  };
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

private calculateAdaptiveScale(viewport: any, analysis: PageAnalysis,
  level:
    | 'light'
    | 'recommended'
    | 'strong'
): number {

  const max = Math.max(viewport.width, viewport.height);

  if (analysis.type === 'text') {
    return 1;
  }

  if (level === 'light') {
    if (max > 2500) {
      return 0.90;
    }
    return 1;
  }

  if (level === 'recommended') {
    if (max > 2500) {
      return 0.70;
    }
    return 0.85;
  }

  if (max > 2500) {
    return 0.50;
  }

  return 0.65;
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

private getAdaptiveQuality(pageAnalysis: PageAnalysis, level: 'light' | 'recommended' | 'strong'): number {
  switch (level) {
    case 'light':
      return pageAnalysis.type === 'scanned' ? 0.82 : 0.88;

    case 'recommended':
      return pageAnalysis.type === 'scanned' ? 0.68 : 0.78;

    case 'strong':
      return pageAnalysis.type === 'scanned' ? 0.52 : 0.65;
  }
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
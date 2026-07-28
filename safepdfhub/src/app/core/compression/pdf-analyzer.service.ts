import { Injectable } from '@angular/core';
import { PdfAnalysis, PdfFileAnalysis, PageAnalysis } from './pdf-analysis.models';

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

@Injectable({
    providedIn: 'root'
})

export class PdfAnalyzer {

    async analyzeFile(file: File): Promise<PdfFileAnalysis> {
        const pdfjs = await loadPdfJs();
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({data: buffer}).promise;
        const type = await this.detectPdfType(pdf);
        const analysis = await this.analyzePdfStructure(pdf);
        const pages = pdf.numPages;
        pdf.destroy();
        return {type,analysis,pages};
    }

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
                }
                else {
                    scannedPages++;
                }
            }
            catch {
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

    async analyzePdfStructure(pdf: any): Promise<PdfAnalysis> {

        let textItems = 0;
        let largePages = false;
        let imageHeavyPages = 0;
        const pagesToCheck = Math.min(5, pdf.numPages);

        for (let i = 1; i <= pagesToCheck; i++) {

            const page = await pdf.getPage(i);

            const viewport = page.getViewport({scale: 1});

            if (viewport.width > 1000 || viewport.height > 1400) {
                largePages = true;
            }

            try {
                const text = await page.getTextContent();
                textItems += text.items.length;
                if (text.items.length < 50) {
                    imageHeavyPages++;
                }
            }
            catch { }

            page.cleanup();
        }

        const avgTextDensity = textItems / pagesToCheck;
        const estimatedDpi = largePages ? 300 : avgTextDensity > 150 ? 200 : 150;
        const imageRatio = imageHeavyPages / pagesToCheck;
        let type:
            | 'text'
            | 'scanned'
            | 'mixed';

        if (avgTextDensity > 120 && imageRatio < 0.15) {
            type = 'text';
        }
        else if (avgTextDensity < 30) {
            type = 'scanned';
        }
        else {
            type = 'mixed';
        }

        return {type, avgTextDensity, estimatedDpi, largePages, imageHeavy: imageRatio > 0.4, imageRatio};

    }

    async analyzePage(page: any): Promise<PageAnalysis> {
        let textItems = 0;
        try {
            const text = await page.getTextContent();
            textItems = text.items.length;
        }
        catch { }

        const viewport = page.getViewport({scale: 1});
        const pageArea = viewport.width * viewport.height;
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

        let type:
            | 'text'
            | 'mixed'
            | 'scanned';

        if (textItems > 120) {
            type = 'text';
        }
        else if (textItems < 30) {
            type = 'scanned';
        }
        else {
            type = 'mixed';
        }

        return {
            type,
            textDensity: textItems,
            estimatedImageArea,
            estimatedPhotoPage: estimatedImageArea > pageArea * 0.5,
            shouldRasterize: type !== 'text'
        };
    }

}
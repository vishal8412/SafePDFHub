import { Injectable, inject } from '@angular/core';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import type { WordPreview } from './word-to-pdf.service';

export interface WordExportCheck {
  pages: number;
  wrongSizePages: number;
  hasSelectableText: boolean;
  issues: string[];
}

export function matchesWordPaper(width: number, height: number, expected: WordPreview['pageDimensions']) {
  // PDF printer rounding is commonly a fraction of a point. Do not accept
  // swapped axes: portrait/landscape is part of the source layout.
  return expected.some(p => Math.abs(p.width - width) <= 2 && Math.abs(p.height - height) <= 2);
}

@Injectable({ providedIn: 'root' })
export class WordExportCheckService {
  private readonly loader = inject(PdfJsLoaderService);

  async check(file: File, source: WordPreview, signal: AbortSignal, progress: (page: number, total: number) => void): Promise<WordExportCheck> {
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 200_000_000)
      throw Error('Choose a non-empty saved PDF up to 200 MB.');
    signal.throwIfAborted();
    const pdfjs = await this.loader.load();
    signal.throwIfAborted();
    const data = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    const cancel = () => { void task.destroy().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    task.onPassword = () => { cancel(); };
    try {
      const pdf = await task.promise;
      let wrongSizePages = 0;
      let hasSelectableText = false;
      for (let i = 1; i <= pdf.numPages; i++) {
        signal.throwIfAborted();
        progress(i, pdf.numPages);
        const page = await pdf.getPage(i);
        try {
          const viewport = page.getViewport({ scale: 1 });
          if (!matchesWordPaper(viewport.width, viewport.height, source.pageDimensions)) wrongSizePages++;
          if (!hasSelectableText) {
            const text = await page.getTextContent();
            hasSelectableText = text.items.some(item => 'str' in item && /[\p{L}\p{N}]/u.test(item.str));
          }
        } finally { page.cleanup(); }
      }
      signal.throwIfAborted();
      const issues: string[] = [];
      if (!source.pageDimensions.length) issues.push('The Word page size could not be determined; compare paper sizes manually.');
      else if (wrongSizePages) issues.push(`${wrongSizePages} page(s) use a different paper size or orientation. Save again using ${source.paperSizes.join(', ')} and 100% scale.`);
      if (source.hasText && !hasSelectableText) issues.push('No selectable text was found. This PDF may have been printed as images. Use your browser’s Save as PDF destination.');
      return { pages: pdf.numPages, wrongSizePages, hasSelectableText, issues };
    } finally {
      signal.removeEventListener('abort', cancel);
      await task.destroy().catch(() => undefined);
    }
  }
}

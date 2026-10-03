import { captureDocumentFacts, sourceFactsFor, PdfDocumentFacts } from './pdf-document-facts';
import { PdfVisualFidelityService } from './pdf-visual-fidelity.service';
import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { throwIfCompressionCancelled } from './compression-cancellation';
import {
  PdfFinalIntegrityPageResult,
  PdfFinalIntegrityResult,
} from './pdf-final-integrity.models';

/**
 * V2.6 final candidate certification.
 *
 * V2.5 uses a bounded sample to cheaply reject obviously unsafe candidates.
 * V2.6 performs the expensive, fail-closed certification only on candidates
 * that are already smaller and have a chance to become the final output.
 *
 * The comparison is page-by-page so we do not retain all extracted page data
 * in memory at once. This is intentionally a final-gate operation, not a
 * first-pass candidate generator.
 */
@Injectable({ providedIn: 'root' })
export class PdfFinalIntegrityService {
  constructor(
    private readonly pdfJsLoader: PdfJsLoaderService,
    private readonly visualFidelity: PdfVisualFidelityService,
  ) {}

  async certify(
    source: File,
    candidate: File,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    level: 'light' | 'recommended' | 'strong' = 'light',
  ): Promise<PdfFinalIntegrityResult> {
    const startedAt = performance.now();
    let sourceJs: any = null;
    let candidateJs: any = null;
    const loadingTasks: any[] = [];
    const onAbort = () => {
      for (const task of loadingTasks) { try { void task.destroy().catch(() => undefined); } catch { /* best effort */ } }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      throwIfCompressionCancelled(signal);
      const [sourceBytes, candidateBytes] = await Promise.all([
        source.arrayBuffer(),
        candidate.arrayBuffer(),
      ]);

      const cachedSourceFacts = sourceFactsFor(source);
      const [sourcePdf, candidatePdf] = await Promise.all([
        cachedSourceFacts ? Promise.resolve(null) : PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: 5000 }),
        PDFDocument.load(candidateBytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: 5000 }),
      ]);

      try {
        const sourceFacts = cachedSourceFacts ?? captureDocumentFacts(sourcePdf!);
        const candidateFacts = captureDocumentFacts(candidatePdf);
        const sourcePageCount = sourceFacts.pages.length;
        const candidatePageCount = candidatePdf.getPageCount();
        const pageCountMatched = sourcePageCount === candidatePageCount;

        if (!pageCountMatched) {
          return this.rejected(
            sourcePageCount,
            0,
            false,
            false,
            false,
            'Candidate page count differs from the source.',
            startedAt,
          );
        }

        const pageGeometryMatched = this.comparePageGeometry(sourceFacts, candidateFacts);
        if (!pageGeometryMatched) {
          return this.rejected(
            sourcePageCount,
            0,
            false,
            false,
            true,
            'Candidate page geometry or rotation differs from the source.',
            startedAt,
          );
        }

        const metadataMatched = this.compareMetadata(sourceFacts, candidateFacts);
        if (!metadataMatched) {
          return this.rejected(
            sourcePageCount,
            0,
            false,
            true,
            true,
            'Candidate document metadata differs from the source.',
            startedAt,
          );
        }

        const pdfjs = await this.pdfJsLoader.load();
        throwIfCompressionCancelled(signal);
        loadingTasks.push(pdfjs.getDocument({ data: new Uint8Array(sourceBytes) }));
        loadingTasks.push(pdfjs.getDocument({ data: new Uint8Array(candidateBytes) }));
        const [sourceDocument, candidateDocument] = await Promise.all(loadingTasks.map(task => task.promise));
        sourceJs = sourceDocument;
        candidateJs = candidateDocument;

        const pages: PdfFinalIntegrityPageResult[] = [];

        for (let pageNumber = 1; pageNumber <= sourcePageCount; pageNumber += 1) {
          throwIfCompressionCancelled(signal);
          const pageResult = await this.comparePage(sourceJs, candidateJs, pageNumber, signal);
          pages.push(pageResult);

          if (!pageResult.passed) {
            return {
              status: 'rejected',
              pagesChecked: pageNumber,
              totalPages: sourcePageCount,
              metadataMatched,
              pageGeometryMatched,
              pageCountMatched,
              pages,
              durationMs: performance.now() - startedAt,
              reason: `Semantic content differs on page ${pageNumber}.`,
            };
          }

          onProgress?.(Math.round((pageNumber / sourcePageCount) * 95));
        }

        throwIfCompressionCancelled(signal);
        const visual = await this.visualFidelity.validateDocuments(sourceJs, candidateJs, level, signal);
        if (visual.status !== 'passed') {
          return this.rejected(sourcePageCount, sourcePageCount, true, true, true,
            'Visual fidelity failed: ' + (visual.reason ?? 'validation unavailable'), startedAt);
        }
        return {
          status: 'passed',
          pagesChecked: sourcePageCount,
          totalPages: sourcePageCount,
          metadataMatched,
          pageGeometryMatched,
          pageCountMatched,
          pages,
          durationMs: performance.now() - startedAt,
          reason: null,
        };
      } finally {
        sourcePdf?.flush?.();
        candidatePdf.flush?.();
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        status: 'rejected',
        pagesChecked: 0,
        totalPages: 0,
        metadataMatched: false,
        pageGeometryMatched: false,
        pageCountMatched: false,
        pages: [],
        durationMs: performance.now() - startedAt,
        reason: `Final integrity certification could not be completed: ${this.errorMessage(error)}`,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await Promise.all(loadingTasks.map(async task => { try { await task.destroy(); } catch { /* best effort */ } }));
      if (sourceJs) {
        try { await sourceJs.destroy?.(); } catch { /* best effort */ }
      }
      if (candidateJs) {
        try { await candidateJs.destroy?.(); } catch { /* best effort */ }
      }
    }
  }

  private async comparePage(
    sourceDocument: any,
    candidateDocument: any,
    pageNumber: number,
    signal?: AbortSignal,
  ): Promise<PdfFinalIntegrityPageResult> {
    const [sourcePage, candidatePage] = await Promise.all([
      sourceDocument.getPage(pageNumber),
      candidateDocument.getPage(pageNumber),
    ]);

    try {
      throwIfCompressionCancelled(signal);
      const [sourceText, candidateText, sourceAnnotations, candidateAnnotations] = await Promise.all([
        sourcePage.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }),
        candidatePage.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }),
        sourcePage.getAnnotations({ intent: 'display' }),
        candidatePage.getAnnotations({ intent: 'display' }),
      ]);

      const sourceNormalizedText = this.normalizeText(sourceText.items);
      const candidateNormalizedText = this.normalizeText(candidateText.items);
      const sourceAnnotationSignature = this.annotationSignature(sourceAnnotations);
      const candidateAnnotationSignature = this.annotationSignature(candidateAnnotations);

      const textMatched = sourceNormalizedText === candidateNormalizedText;
      const annotationsMatched = sourceAnnotationSignature === candidateAnnotationSignature;

      return {
        pageNumber,
        textMatched,
        annotationsMatched,
        sourceTextLength: sourceNormalizedText.length,
        candidateTextLength: candidateNormalizedText.length,
        sourceAnnotationCount: sourceAnnotations.length,
        candidateAnnotationCount: candidateAnnotations.length,
        passed: textMatched && annotationsMatched,
      };
    } finally {
      try { sourcePage.cleanup?.(); } catch { /* best effort */ }
      try { candidatePage.cleanup?.(); } catch { /* best effort */ }
    }
  }

  private normalizeText(items: any[]): string {
    return items
      .map(item => typeof item?.str === 'string' ? item.str : '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private annotationSignature(annotations: any[]): string {
    return annotations
      .map(annotation => ({
        subtype: String(annotation?.subtype ?? ''),
        fieldType: String(annotation?.fieldType ?? ''),
        fieldName: String(annotation?.fieldName ?? ''),
        fieldValue: String(annotation?.fieldValue ?? ''),
        url: String(annotation?.url ?? ''),
        dest: Array.isArray(annotation?.dest)
          ? JSON.stringify(annotation.dest)
          : String(annotation?.dest ?? ''),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      .map(value => JSON.stringify(value))
      .join('|');
  }

  private comparePageGeometry(source: PdfDocumentFacts, candidate: PdfDocumentFacts): boolean {
    return source.pages.length === candidate.pages.length && source.pages.every((page, i) => {
      const other = candidate.pages[i];
      return Math.abs(page.width - other.width) <= 0.01 && Math.abs(page.height - other.height) <= 0.01 && page.rotation === other.rotation;
    });
  }

  private compareMetadata(source: PdfDocumentFacts, candidate: PdfDocumentFacts): boolean {
    return source.metadata.length === candidate.metadata.length &&
      source.metadata.every((value, i) => value === candidate.metadata[i]);
  }

  private rejected(
    totalPages: number,
    pagesChecked: number,
    metadataMatched: boolean,
    pageGeometryMatched: boolean,
    pageCountMatched: boolean,
    reason: string,
    startedAt: number,
  ): PdfFinalIntegrityResult {
    return {
      status: 'rejected',
      pagesChecked,
      totalPages,
      metadataMatched,
      pageGeometryMatched,
      pageCountMatched,
      pages: [],
      durationMs: performance.now() - startedAt,
      reason,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}

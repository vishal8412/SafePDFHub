import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import { PdfJsLoaderService } from '../pdf/pdfjs-loader.service';
import { PdfForensicAnalysis } from './pdf-forensic.models';
import { PdfSemanticIntegrityResult, PdfSemanticPageResult } from './pdf-semantic-integrity.models';

/**
 * V2.5 semantic/document-integrity guard.
 *
 * Structural and image candidates are allowed to win only when they preserve
 * document semantics on a deterministic bounded sample: page geometry,
 * metadata, extracted text, and annotation/form signatures.
 *
 * This service is intentionally independent from visual fidelity. A PDF can
 * look similar while losing selectable text or form/link annotations, so the
 * two guards cover different failure modes.
 */
@Injectable({ providedIn: 'root' })
export class PdfSemanticIntegrityService {
  private readonly maxSamplePages = 8;

  constructor(private readonly pdfJsLoader: PdfJsLoaderService) {}

  async validate(
    source: File,
    candidate: File,
    forensic: PdfForensicAnalysis | undefined,
  ): Promise<PdfSemanticIntegrityResult> {
    try {
      const [sourceBytes, candidateBytes] = await Promise.all([
        source.arrayBuffer(),
        candidate.arrayBuffer(),
      ]);

      const [sourcePdf, candidatePdf] = await Promise.all([
        PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false }),
        PDFDocument.load(candidateBytes, { ignoreEncryption: true, updateMetadata: false }),
      ]);

      try {
        const sampledPages = this.selectSamplePages(forensic, sourcePdf.getPageCount());
        const pageCountMatched = sourcePdf.getPageCount() === candidatePdf.getPageCount();
        if (!pageCountMatched) {
          return this.rejected(sampledPages, 'Candidate page count differs from the source.');
        }

        const pageGeometryMatched = this.comparePageGeometry(sourcePdf, candidatePdf);
        if (!pageGeometryMatched) {
          return this.rejected(sampledPages, 'Candidate page geometry or rotation differs from the source.');
        }

        const metadataMatched = this.compareMetadata(sourcePdf, candidatePdf);
        if (!metadataMatched) {
          return this.rejected(sampledPages, 'Candidate document metadata differs from the source.');
        }

        const pdfjs = await this.pdfJsLoader.load();
        const [sourceJs, candidateJs] = await Promise.all([
          pdfjs.getDocument({ data: new Uint8Array(sourceBytes) }).promise,
          pdfjs.getDocument({ data: new Uint8Array(candidateBytes) }).promise,
        ]);

        try {
          const pages: PdfSemanticPageResult[] = [];
          for (const pageNumber of sampledPages) {
            pages.push(await this.comparePage(sourceJs, candidateJs, pageNumber));
          }

          const passed = pages.length > 0 && pages.every(page => page.passed);
          return {
            status: passed ? 'passed' : 'rejected',
            sampledPages,
            pages,
            metadataMatched,
            pageGeometryMatched,
            pageCountMatched,
            reason: passed ? null : 'Text or annotation/form semantics differed on one or more sampled pages.',
          };
        } finally {
          try { await sourceJs.destroy?.(); } catch { /* best effort */ }
          try { await candidateJs.destroy?.(); } catch { /* best effort */ }
        }
      } finally {
        sourcePdf.flush?.();
        candidatePdf.flush?.();
      }
    } catch (error) {
      return {
        status: 'rejected',
        sampledPages: this.selectSamplePages(forensic, 1),
        pages: [],
        metadataMatched: false,
        pageGeometryMatched: false,
        pageCountMatched: false,
        reason: `Semantic validation could not be completed: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  private async comparePage(sourcePdf: any, candidatePdf: any, pageNumber: number): Promise<PdfSemanticPageResult> {
    const [sourcePage, candidatePage] = await Promise.all([
      sourcePdf.getPage(pageNumber),
      candidatePdf.getPage(pageNumber),
    ]);

    try {
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
        sourceTextLength: sourceNormalizedText.length,
        candidateTextLength: candidateNormalizedText.length,
        sourceAnnotationCount: sourceAnnotations.length,
        candidateAnnotationCount: candidateAnnotations.length,
        sourceAnnotationSignature,
        candidateAnnotationSignature,
        textMatched,
        annotationsMatched,
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
        dest: Array.isArray(annotation?.dest) ? JSON.stringify(annotation.dest) : String(annotation?.dest ?? ''),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      .map(value => JSON.stringify(value))
      .join('|');
  }

  private comparePageGeometry(sourcePdf: PDFDocument, candidatePdf: PDFDocument): boolean {
    const sourcePages = sourcePdf.getPages();
    const candidatePages = candidatePdf.getPages();
    if (sourcePages.length !== candidatePages.length) return false;

    for (let index = 0; index < sourcePages.length; index += 1) {
      const sourcePage = sourcePages[index];
      const candidatePage = candidatePages[index];
      const sourceRotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
      const candidateRotation = ((candidatePage.getRotation().angle % 360) + 360) % 360;
      if (
        Math.abs(sourcePage.getWidth() - candidatePage.getWidth()) > 0.01 ||
        Math.abs(sourcePage.getHeight() - candidatePage.getHeight()) > 0.01 ||
        sourceRotation !== candidateRotation
      ) return false;
    }
    return true;
  }

  private compareMetadata(sourcePdf: PDFDocument, candidatePdf: PDFDocument): boolean {
    return [
      sourcePdf.getTitle() === candidatePdf.getTitle(),
      sourcePdf.getAuthor() === candidatePdf.getAuthor(),
      sourcePdf.getSubject() === candidatePdf.getSubject(),
      sourcePdf.getCreator() === candidatePdf.getCreator(),
      sourcePdf.getProducer() === candidatePdf.getProducer(),
      sourcePdf.getKeywords() === candidatePdf.getKeywords(),
    ].every(Boolean);
  }

  private selectSamplePages(forensic: PdfForensicAnalysis | undefined, pageCount: number): number[] {
    const sourcePages = forensic?.sampledPages ?? [];
    if (sourcePages.length === 0) return pageCount > 0 ? [1] : [];

    const ranked = [...sourcePages].sort((a, b) =>
      ((b.imageAreaRatio * 100) + Math.min(b.imageOperatorCount, 20)) -
      ((a.imageAreaRatio * 100) + Math.min(a.imageOperatorCount, 20)) ||
      a.pageNumber - b.pageNumber,
    );

    const selected: number[] = [];
    const add = (pageNumber: number) => {
      if (selected.length >= this.maxSamplePages || selected.includes(pageNumber)) return;
      selected.push(pageNumber);
    };

    add(sourcePages[0].pageNumber);
    add(sourcePages[Math.floor(sourcePages.length / 2)].pageNumber);
    add(sourcePages[sourcePages.length - 1].pageNumber);
    for (const page of ranked) add(page.pageNumber);

    return selected.slice(0, this.maxSamplePages).sort((a, b) => a - b);
  }

  private rejected(sampledPages: number[], reason: string): PdfSemanticIntegrityResult {
    return {
      status: 'rejected',
      sampledPages,
      pages: [],
      metadataMatched: false,
      pageGeometryMatched: false,
      pageCountMatched: false,
      reason,
    };
  }
}

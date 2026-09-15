import { Injectable } from '@angular/core';
import { PDFDocument } from 'pdf-lib';
import type {
  QpdfOutputValidation,
  QpdfPageGeometry,
  QpdfSmokeComparison,
  QpdfSmokeResult
} from './qpdf-fidelity.types';
import { QpdfWasmPrototypeService } from './qpdf-wasm-prototype.service';
import { MergeEngine } from '../engines/merge.engine';

@Injectable({ providedIn: 'root' })
export class QpdfFidelityService {
  constructor(
    private readonly qpdfService: QpdfWasmPrototypeService,
    private readonly mergeEngine: MergeEngine
  ) {}

  async runSmokeTest(
    files: readonly File[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<QpdfSmokeResult> {
    if (files.length < 2) {
      throw new Error('Select at least 2 PDF files for the qpdf smoke test.');
    }

    const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
    const inputPageCount = await this.readInputPageCount(files);

    onProgress?.(5, 'Running qpdf WASM merge...');
    const qpdfStarted = performance.now();

    let qpdfOutput: File;
    let qpdfDurationMs: number | null = null;

    try {
      qpdfOutput = await this.qpdfService.merge(
        files,
        progress =>
          onProgress?.(
            5 + Math.round(progress * 0.55),
            'qpdf WASM merge in progress...'
          )
      );

      qpdfDurationMs = performance.now() - qpdfStarted;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'qpdf WASM merge failed.';

      return this.failedResult(
        files.length,
        inputBytes,
        inputPageCount,
        message,
        qpdfDurationMs
      );
    }

    onProgress?.(65, 'Validating qpdf output...');
    const qpdfValidation = await this.validateOutput(qpdfOutput);

    onProgress?.(75, 'Running pdf-lib Worker comparison...');

    let pdfLibOutput: File;

    try {
      pdfLibOutput = await this.mergeEngine.merge(
        [...files],
        progress =>
          onProgress?.(
            75 + Math.round(progress * 0.2),
            'pdf-lib Worker merge in progress...'
          ),
        [],
        { executionMode: 'worker' }
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'pdf-lib Worker merge failed.';

      return {
        status: 'failed',
        inputFileCount: files.length,
        inputBytes,
        inputPageCount,
        qpdfDurationMs,
        qpdfOutput: qpdfValidation,
        pdfLibOutput: {
          parseable: false,
          pageCount: null,
          pageGeometries: [],
          outputBytes: 0,
          errorMessage: message
        },
        comparison: this.createComparison(
          inputPageCount,
          qpdfValidation,
          null
        ),
        errorMessage: message
      };
    }

    onProgress?.(95, 'Validating pdf-lib output...');

    const pdfLibValidation = await this.validateOutput(pdfLibOutput);

    const comparison = this.createComparison(
      inputPageCount,
      qpdfValidation,
      pdfLibValidation
    );

    const passed =
      qpdfValidation.parseable &&
      pdfLibValidation.parseable &&
      comparison.pageCountMatch &&
      comparison.pageGeometryMatch;

    onProgress?.(
      100,
      passed
        ? 'qpdf smoke test passed.'
        : 'qpdf fidelity comparison needs review.'
    );

    return {
      status: passed ? 'passed' : 'failed',
      inputFileCount: files.length,
      inputBytes,
      inputPageCount,
      qpdfDurationMs,
      qpdfOutput: qpdfValidation,
      pdfLibOutput: pdfLibValidation,
      comparison,
      errorMessage: passed
        ? undefined
        : 'The qpdf output requires fidelity review against the pdf-lib Worker output.'
    };
  }

  private async readInputPageCount(
    files: readonly File[]
  ): Promise<number> {
    let total = 0;

    for (const file of files) {
      const bytes = await file.arrayBuffer();

      const document = await PDFDocument.load(bytes, {
        updateMetadata: false
      });

      total += document.getPageCount();
    }

    return total;
  }

  private async validateOutput(
    file: File
  ): Promise<QpdfOutputValidation> {
    try {
      const bytes = await file.arrayBuffer();

      const document = await PDFDocument.load(bytes, {
        updateMetadata: false
      });

      const pageGeometries = document.getPages().map(page => {
        const size = page.getSize();

        return {
          width: this.roundGeometry(size.width),
          height: this.roundGeometry(size.height)
        } satisfies QpdfPageGeometry;
      });

      return {
        parseable: true,
        pageCount: document.getPageCount(),
        pageGeometries,
        outputBytes: file.size
      };
    } catch (error) {
      return {
        parseable: false,
        pageCount: null,
        pageGeometries: [],
        outputBytes: file.size,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Output PDF could not be parsed.'
      };
    }
  }

  private createComparison(
    inputPageCount: number,
    qpdfOutput: QpdfOutputValidation,
    pdfLibOutput: QpdfOutputValidation | null
  ): QpdfSmokeComparison {
    const pageCountMatch =
      qpdfOutput.pageCount === inputPageCount &&
      pdfLibOutput?.pageCount === inputPageCount;

    const pageGeometryMatch =
      pdfLibOutput !== null &&
      this.geometriesEqual(
        qpdfOutput.pageGeometries,
        pdfLibOutput.pageGeometries
      );

    return {
      pageCountMatch,
      pageGeometryMatch,
      qpdfOutputParseable: qpdfOutput.parseable,
      pdfLibOutputParseable: pdfLibOutput?.parseable ?? false,
      inputPageCount,
      qpdfPageCount: qpdfOutput.pageCount,
      pdfLibPageCount: pdfLibOutput?.pageCount ?? null
    };
  }

  private geometriesEqual(
    left: readonly QpdfPageGeometry[],
    right: readonly QpdfPageGeometry[]
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((geometry, index) => {
      const other = right[index];

      return (
        geometry.width === other.width &&
        geometry.height === other.height
      );
    });
  }

  private roundGeometry(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private failedResult(
    inputFileCount: number,
    inputBytes: number,
    inputPageCount: number,
    errorMessage: string,
    qpdfDurationMs: number | null
  ): QpdfSmokeResult {
    const qpdfOutput: QpdfOutputValidation = {
      parseable: false,
      pageCount: null,
      pageGeometries: [],
      outputBytes: 0,
      errorMessage
    };

    return {
      status: 'failed',
      inputFileCount,
      inputBytes,
      inputPageCount,
      qpdfDurationMs,
      qpdfOutput,
      pdfLibOutput: {
        parseable: false,
        pageCount: null,
        pageGeometries: [],
        outputBytes: 0
      },
      comparison: this.createComparison(
        inputPageCount,
        qpdfOutput,
        null
      ),
      errorMessage
    };
  }
}
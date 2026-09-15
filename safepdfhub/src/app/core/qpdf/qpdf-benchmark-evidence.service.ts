import { Injectable } from '@angular/core';
import type { QpdfBenchmarkResult } from './qpdf-benchmark.types';
import type {
  QpdfBenchmarkEvidenceExport,
  QpdfBenchmarkEvidenceRecord,
  QpdfBenchmarkEvidenceSummary,
  QpdfEvidenceDeviceClass
} from './qpdf-benchmark-evidence.types';

const STORAGE_KEY = 'safepdfhub.qpdf-benchmark.evidence.v1';
const MAX_RECORDS = 100;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class QpdfBenchmarkEvidenceService {
  load(): QpdfBenchmarkEvidenceRecord[] {
    if (!this.canUseStorage()) return [];

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((record): record is QpdfBenchmarkEvidenceRecord => this.isRecord(record))
        .slice(-MAX_RECORDS)
        .reverse();
    } catch {
      return [];
    }
  }

  save(report: QpdfBenchmarkResult): QpdfBenchmarkEvidenceRecord | null {
    if (!this.canUseStorage() || report.status !== 'completed') return null;

    const record = this.createRecord(report);
    const records = this.load().reverse();
    records.push(record);

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(records.slice(-MAX_RECORDS))
      );
      return record;
    } catch {
      return null;
    }
  }

  remove(id: string): void {
    if (!this.canUseStorage()) return;

    const records = this.load().filter(record => record.id !== id);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.reverse()));
    } catch {
      // Evidence persistence is best-effort and must never affect PDF processing.
    }
  }

  clear(): void {
    if (!this.canUseStorage()) return;

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  summarize(records: readonly QpdfBenchmarkEvidenceRecord[]): QpdfBenchmarkEvidenceSummary {
    const complexityClasses = this.unique(records.map(record => record.complexity));
    const deviceClasses = this.unique(records.map(record => record.deviceClass));
    const successfulRecords = records.filter(
      record => record.qpdfSuccess && record.pdfLibWorkerSuccess
    );
    const memoryTelemetryRecordCount = successfulRecords.filter(record =>
      record.report.qpdf.memory?.supported && record.report.pdfLibWorker.memory?.supported
    ).length;
    const longTaskTelemetryRecordCount = successfulRecords.filter(record =>
      record.report.qpdf.longTasks?.supported && record.report.pdfLibWorker.longTasks?.supported
    ).length;
    const maxObservedQpdfLongTaskMs = this.maximum(
      successfulRecords
        .map(record => record.report.qpdf.longTasks?.maxDurationMs ?? null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );
    const maxObservedPdfLibLongTaskMs = this.maximum(
      successfulRecords
        .map(record => record.report.pdfLibWorker.longTasks?.maxDurationMs ?? null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
    );

    return {
      recordCount: records.length,
      successfulRecordCount: records.filter(
        record => record.qpdfSuccess && record.pdfLibWorkerSuccess
      ).length,
      complexityClasses,
      deviceClasses,
      totalInputBytes: records.reduce((sum, record) => sum + record.inputBytes, 0),
      totalInputPages: records.reduce(
        (sum, record) => sum + (record.inputPages ?? 0),
        0
      ),
      memoryTelemetryRecordCount,
      longTaskTelemetryRecordCount,
      maxObservedQpdfLongTaskMs,
      maxObservedPdfLibLongTaskMs,
      note:
        'Evidence is stored only in this browser. It contains benchmark metadata and results, not PDF bytes. Export/import can be used to combine evidence from representative devices. This ledger never promotes qpdf or raises public capacity automatically.'
    };
  }

  async importJson(file: File): Promise<number> {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error('Evidence import is limited to 5 MB.');
    }

    const text = await file.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The selected evidence file is not valid JSON.');
    }

    const incoming = this.readExport(parsed);
    const existing = this.load().reverse();
    const byId = new Map(existing.map(record => [record.id, record]));

    for (const record of incoming) {
      byId.set(record.id, record);
    }

    const merged = Array.from(byId.values())
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .slice(-MAX_RECORDS);

    if (this.canUseStorage()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        throw new Error('The browser could not store the imported evidence.');
      }
    }

    return incoming.length;
  }

  exportJson(records: readonly QpdfBenchmarkEvidenceRecord[]): void {
    const payload: QpdfBenchmarkEvidenceExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      records: [...records]
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-qpdf-evidence-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  deviceClass(
    deviceMemoryGiB: number | null,
    hardwareConcurrency: number | null,
    userAgent: string
  ): QpdfEvidenceDeviceClass {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
    if (mobile && /iPad|Tablet/i.test(userAgent)) return 'tablet';
    if (mobile) return 'mobile';

    if (
      (deviceMemoryGiB !== null && deviceMemoryGiB >= 16) ||
      (hardwareConcurrency !== null && hardwareConcurrency >= 12)
    ) {
      return 'desktop-high-end';
    }

    if (
      (deviceMemoryGiB !== null && deviceMemoryGiB >= 4) ||
      (hardwareConcurrency !== null && hardwareConcurrency >= 4)
    ) {
      return 'desktop-standard';
    }

    return 'unknown';
  }

  private createRecord(report: QpdfBenchmarkResult): QpdfBenchmarkEvidenceRecord {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const deviceMemoryGiB = this.readDeviceMemory();
    const hardwareConcurrency =
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null;

    return {
      id: this.createId(),
      recordedAt: new Date().toISOString(),
      deviceClass: this.deviceClass(
        deviceMemoryGiB,
        hardwareConcurrency,
        userAgent
      ),
      deviceMemoryGiB,
      hardwareConcurrency,
      complexity: report.complexity,
      inputFileCount: report.inputFileCount,
      inputBytes: report.inputBytes,
      inputPages: report.inputPages,
      qpdfSuccess: report.qpdf.success,
      pdfLibWorkerSuccess: report.pdfLibWorker.success,
      qpdfElapsedMs: report.qpdf.elapsedMs,
      pdfLibWorkerElapsedMs: report.pdfLibWorker.elapsedMs,
      qpdfSpeedup: report.qpdfSpeedup,
      qpdfMainThreadGapReduction: report.qpdfMainThreadGapReduction,
      pageCountMatch: report.pageCountMatch,
      pageGeometryMatch: report.pageGeometryMatch,
      annotationsMatch: report.annotationsMatch,
      linksMatch: report.linksMatch,
      widgetsMatch: report.widgetsMatch,
      outlinesMatch: report.outlinesMatch,
      fieldsMatch: report.fieldsMatch,
      firstPageRenderMatch: report.firstPageRenderMatch,
      report
    };
  }

  private readExport(value: unknown): QpdfBenchmarkEvidenceRecord[] {
    if (
      !this.isObject(value) ||
      value['schemaVersion'] !== 1 ||
      !Array.isArray(value['records'])
    ) {
      throw new Error('Unsupported qpdf evidence export format.');
    }

    const records = value['records'].filter(
      (record): record is QpdfBenchmarkEvidenceRecord => this.isRecord(record)
    );

    if (records.length === 0) {
      throw new Error('The evidence file does not contain valid benchmark records.');
    }

    return records;
  }

  private isRecord(value: unknown): value is QpdfBenchmarkEvidenceRecord {
    if (!this.isObject(value)) return false;

    return (
      typeof value['id'] === 'string' &&
      typeof value['recordedAt'] === 'string' &&
      typeof value['complexity'] === 'string' &&
      typeof value['inputFileCount'] === 'number' &&
      typeof value['inputBytes'] === 'number' &&
      'report' in value
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private maximum(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return Math.max(...values);
  }

  private unique<T extends string>(values: readonly T[]): T[] {
    return Array.from(new Set(values));
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  private readDeviceMemory(): number | null {
    if (typeof navigator === 'undefined') return null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
      ? nav.deviceMemory
      : null;
  }

  private createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private fileDateStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

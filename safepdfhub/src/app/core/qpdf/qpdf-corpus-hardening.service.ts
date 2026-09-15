import { Injectable } from '@angular/core';
import type { QpdfBenchmarkComplexity } from './qpdf-benchmark.types';
import type { QpdfBenchmarkEvidenceRecord } from './qpdf-benchmark-evidence.types';
import type {
  QpdfCorpusHardeningEvaluationInput,
  QpdfCorpusHardeningExport,
  QpdfCorpusHardeningRequirement,
  QpdfCorpusHardeningResult,
  QpdfCorpusHardeningStatus,
  QpdfCorpusBandCoverage,
  QpdfCorpusWorkloadSignature
} from './qpdf-corpus-hardening.types';

const POSITIVE_COMPLEXITIES: readonly QpdfBenchmarkComplexity[] = [
  'text-light',
  'font-heavy',
  'image-heavy',
  'scanned',
  'mixed'
];

const NEGATIVE_COMPLEXITIES: readonly QpdfBenchmarkComplexity[] = [
  'encrypted',
  'malformed'
];

const POSITIVE_RUNS_PER_CLASS = 3;
const NEGATIVE_RUNS_PER_CLASS = 2;
const REQUIRED_DEVICE_CLASSES = 3;
const LARGE_WORKLOAD_BYTES = 250 * 1024 * 1024;
const HIGH_PAGE_COUNT = 1000;
const VERY_HIGH_PAGE_COUNT = 5000;

const SIZE_BANDS = [
  { id: 'size-small', label: '<25 MiB total', min: 0, maxExclusive: 25 * 1024 * 1024 },
  { id: 'size-medium', label: '25–100 MiB total', min: 25 * 1024 * 1024, maxExclusive: 100 * 1024 * 1024 },
  { id: 'size-large', label: '100–250 MiB total', min: 100 * 1024 * 1024, maxExclusive: 250 * 1024 * 1024 },
  { id: 'size-upper', label: '≥250 MiB total', min: 250 * 1024 * 1024, maxExclusive: Number.POSITIVE_INFINITY }
] as const;

const PAGE_BANDS = [
  { id: 'pages-low', label: '1–99 pages', min: 1, maxExclusive: 100 },
  { id: 'pages-medium', label: '100–999 pages', min: 100, maxExclusive: 1000 },
  { id: 'pages-high', label: '1,000–4,999 pages', min: 1000, maxExclusive: 5000 },
  { id: 'pages-upper', label: '≥5,000 pages', min: 5000, maxExclusive: Number.POSITIVE_INFINITY }
] as const;
const MIN_REPEATED_WORKLOAD_RUNS = 3;

@Injectable({ providedIn: 'root' })
export class QpdfCorpusHardeningService {
  evaluate(input: QpdfCorpusHardeningEvaluationInput): QpdfCorpusHardeningResult {
    const records = [...input.records];
    const positiveRecords = records.filter(record => this.isPositive(record.complexity));
    const negativeRecords = records.filter(record => this.isNegative(record.complexity));
    const advancedFidelityCompleteCount = positiveRecords.filter(record => this.hasCompleteAdvancedFidelity(record)).length;
    const qpdfFailureCountOnPositiveCases = positiveRecords.filter(record => !record.qpdfSuccess).length;
    const negativeCaseFailureCount = negativeRecords.filter(record => !record.qpdfSuccess).length;
    const negativeCaseSuccessCount = negativeRecords.filter(record => record.qpdfSuccess).length;
    const largeWorkloadRecordCount = positiveRecords.filter(record => record.inputBytes >= LARGE_WORKLOAD_BYTES).length;
    const highPageCountRecordCount = positiveRecords.filter(record => (record.inputPages ?? 0) >= HIGH_PAGE_COUNT).length;
    const veryHighPageCountRecordCount = positiveRecords.filter(record => (record.inputPages ?? 0) >= VERY_HIGH_PAGE_COUNT).length;
    const sizeBandCoverage = this.buildBandCoverage(positiveRecords, SIZE_BANDS, record => record.inputBytes);
    const pageBandCoverage = this.buildBandCoverage(positiveRecords, PAGE_BANDS, record => record.inputPages ?? 0);

    const positiveHardFidelityPassRate = positiveRecords.length === 0
      ? null
      : positiveRecords.filter(record => this.hasHardFidelityPass(record)).length / positiveRecords.length;
    const positiveSuccessRate = positiveRecords.length === 0
      ? null
      : positiveRecords.filter(record => record.qpdfSuccess && record.pdfLibWorkerSuccess).length / positiveRecords.length;

    const signatures = this.buildSignatures(positiveRecords);
    const repeatedWorkloadCount = signatures.filter(signature => signature.repeatedRuns >= MIN_REPEATED_WORKLOAD_RUNS).length;

    const requirements: QpdfCorpusHardeningRequirement[] = [];

    for (const complexity of POSITIVE_COMPLEXITIES) {
      const observed = positiveRecords.filter(record => record.complexity === complexity).length;
      requirements.push({
        id: `positive-${complexity}`,
        kind: 'positive-class',
        label: this.label(complexity),
        description: `At least ${POSITIVE_RUNS_PER_CLASS} representative successful-class runs, with complete fidelity evidence.`,
        target: POSITIVE_RUNS_PER_CLASS,
        observed: this.countPassingPositiveRuns(positiveRecords, complexity),
        covered: this.countPassingPositiveRuns(positiveRecords, complexity) >= POSITIVE_RUNS_PER_CLASS,
        blocking: true,
        nextAction: observed < POSITIVE_RUNS_PER_CLASS
          ? `Collect ${POSITIVE_RUNS_PER_CLASS - observed} more ${this.label(complexity)} run(s).`
          : undefined
      });
    }

    for (const complexity of NEGATIVE_COMPLEXITIES) {
      const observed = negativeRecords.filter(record => record.complexity === complexity).length;
      const safelyRecorded = negativeRecords.filter(record =>
        record.complexity === complexity &&
        (!record.qpdfSuccess ? Boolean(record.report.qpdf.errorMessage) : true)
      ).length;
      requirements.push({
        id: `negative-${complexity}`,
        kind: 'negative-class',
        label: this.label(complexity),
        description: `At least ${NEGATIVE_RUNS_PER_CLASS} observed cases with explicit terminal behavior; success is not automatically considered a failure.`,
        target: NEGATIVE_RUNS_PER_CLASS,
        observed: Math.min(observed, safelyRecorded),
        covered: observed >= NEGATIVE_RUNS_PER_CLASS && safelyRecorded >= NEGATIVE_RUNS_PER_CLASS,
        blocking: true,
        nextAction: observed < NEGATIVE_RUNS_PER_CLASS
          ? `Collect ${NEGATIVE_RUNS_PER_CLASS - observed} more ${this.label(complexity)} negative-test run(s).`
          : safelyRecorded < NEGATIVE_RUNS_PER_CLASS
            ? `Re-run ${this.label(complexity)} cases and capture explicit qpdf failure/error evidence where applicable.`
            : undefined
      });
    }

    const deviceClasses = new Set(positiveRecords.map(record => record.deviceClass));
    requirements.push({
      id: 'devices',
      kind: 'device',
      label: 'Representative device classes',
      description: `Evidence from at least ${REQUIRED_DEVICE_CLASSES} distinct device classes.`,
      target: REQUIRED_DEVICE_CLASSES,
      observed: deviceClasses.size,
      covered: deviceClasses.size >= REQUIRED_DEVICE_CLASSES,
      blocking: true,
      nextAction: deviceClasses.size < REQUIRED_DEVICE_CLASSES
        ? `Collect evidence on ${REQUIRED_DEVICE_CLASSES - deviceClasses.size} additional device class(es).`
        : undefined
    });

    requirements.push({
      id: 'large-workload',
      kind: 'size-band',
      label: 'Large workload',
      description: 'At least one positive workload at or above 250 MiB total input, within the existing public engine ceiling.',
      target: 1,
      observed: largeWorkloadRecordCount,
      covered: largeWorkloadRecordCount >= 1,
      blocking: true,
      nextAction: largeWorkloadRecordCount < 1 ? 'Collect a representative positive workload at or above 250 MiB total input.' : undefined
    });

    for (const band of sizeBandCoverage) {
      requirements.push({
        id: band.id,
        kind: 'size-band',
        label: band.label,
        description: 'At least one positive workload in this total-input-size band.',
        target: band.target,
        observed: band.observed,
        covered: band.covered,
        blocking: true,
        nextAction: band.covered ? undefined : `Collect at least one positive workload in the ${band.label} band.`
      });
    }

    for (const band of pageBandCoverage) {
      requirements.push({
        id: band.id,
        kind: 'page-band',
        label: band.label,
        description: 'At least one positive workload in this page-count band.',
        target: band.target,
        observed: band.observed,
        covered: band.covered,
        blocking: true,
        nextAction: band.covered ? undefined : `Collect at least one positive workload in the ${band.label} band.`
      });
    }

    requirements.push({
      id: 'high-page-count',
      kind: 'page-band',
      label: 'High page count',
      description: 'At least one positive workload with 1,000 or more pages.',
      target: 1,
      observed: highPageCountRecordCount,
      covered: highPageCountRecordCount >= 1,
      blocking: true,
      nextAction: highPageCountRecordCount < 1 ? 'Collect a positive workload with at least 1,000 pages.' : undefined
    });

    requirements.push({
      id: 'very-high-page-count',
      kind: 'page-band',
      label: 'Very high page count',
      description: 'At least one positive workload with 5,000 or more pages to exercise the upper page-budget region.',
      target: 1,
      observed: veryHighPageCountRecordCount,
      covered: veryHighPageCountRecordCount >= 1,
      blocking: true,
      nextAction: veryHighPageCountRecordCount < 1 ? 'Collect a positive workload with at least 5,000 pages, if a representative fixture is available.' : undefined
    });

    requirements.push({
      id: 'repeatability',
      kind: 'repeatability',
      label: 'Repeatable identical workload',
      description: `At least one positive workload signature repeated ${MIN_REPEATED_WORKLOAD_RUNS} or more times.`,
      target: 1,
      observed: repeatedWorkloadCount,
      covered: repeatedWorkloadCount >= 1,
      blocking: true,
      nextAction: repeatedWorkloadCount < 1
        ? 'Repeat the exact same PDF selection and classification at least three times to establish reproducibility.'
        : undefined
    });

    requirements.push({
      id: 'fidelity',
      kind: 'fidelity',
      label: 'Complete positive fidelity',
      description: 'All positive records used for hardening must pass page, geometry, annotations, links, widgets, outlines, fields, and render checks.',
      target: positiveRecords.length,
      observed: positiveRecords.filter(record => this.hasHardFidelityPass(record)).length,
      covered: positiveRecords.length > 0 && positiveRecords.every(record => this.hasHardFidelityPass(record)),
      blocking: true,
      nextAction: positiveRecords.some(record => !this.hasHardFidelityPass(record))
        ? 'Reproduce every positive fidelity mismatch before any production-engine review.'
        : positiveRecords.length === 0
          ? 'Collect positive benchmark evidence before evaluating fidelity.'
          : undefined
    });

    const blockingFailures = qpdfFailureCountOnPositiveCases > 0;
    const uncoveredBlocking = requirements.some(requirement => requirement.blocking && !requirement.covered);
    const status: QpdfCorpusHardeningStatus = blockingFailures
      ? 'blocked'
      : uncoveredBlocking
        ? 'not-ready'
        : 'review-ready';

    const nextActions = requirements
      .filter(requirement => requirement.nextAction)
      .map(requirement => requirement.nextAction as string);

    if (blockingFailures) {
      nextActions.unshift(`Investigate ${qpdfFailureCountOnPositiveCases} qpdf failure(s) from positive workloads before production review.`);
    }

    if (positiveRecords.length === 0) {
      nextActions.unshift('Collect representative positive benchmark evidence; no production conclusion can be drawn from an empty corpus.');
    }

    if (negativeCaseSuccessCount > 0) {
      nextActions.push('Review encrypted/malformed successes individually; negative-test success is not automatically a defect, but it must be understood before production fallback semantics are chosen.');
    }

    nextActions.push('Export the hardening report after the corpus is complete so the evidence set can be reviewed or archived without PDF bytes.');

    return {
      status,
      title: status === 'review-ready'
        ? 'Corpus hardening complete — ready for final review'
        : status === 'blocked'
          ? 'Corpus hardening blocked by positive-case failures'
          : 'Corpus hardening requires more evidence',
      summary: status === 'review-ready'
        ? 'The final corpus requirements are covered by the current evidence ledger. This is a review milestone only; it does not change the production engine or capacity.'
        : status === 'blocked'
          ? 'At least one positive workload failed in qpdf. Resolve and reproduce the affected case before treating the corpus as production-review ready.'
          : 'The evidence ledger does not yet cover the final representative corpus and boundary requirements.',
      totalRecords: records.length,
      positiveRecords: positiveRecords.length,
      negativeRecords: negativeRecords.length,
      positiveSuccessRate,
      positiveHardFidelityPassRate,
      requirements,
      workloadSignatures: signatures,
      repeatedWorkloadCount,
      largeWorkloadRecordCount,
      highPageCountRecordCount,
      veryHighPageCountRecordCount,
      sizeBandCoverage,
      pageBandCoverage,
      qpdfFailureCountOnPositiveCases,
      negativeCaseFailureCount,
      negativeCaseSuccessCount,
      advancedFidelityCompleteCount,
      nextActions: this.unique(nextActions),
      privacyNote: 'The hardening report contains benchmark metadata, classifications, workload dimensions, and record IDs only. PDF bytes are never stored or exported by this hardening layer.'
    };
  }

  exportJson(result: QpdfCorpusHardeningResult, records: readonly QpdfBenchmarkEvidenceRecord[]): void {
    if (typeof window === 'undefined') return;

    const payload: QpdfCorpusHardeningExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      result,
      workloadSignatures: result.workloadSignatures,
      recordIds: records.map(record => record.id),
      note: 'SafePDFHub Phase 0D.14 corpus hardening report. Metadata only; PDF bytes are not included.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `safepdfhub-qpdf-corpus-hardening-${this.fileDateStamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private isPositive(complexity: QpdfBenchmarkComplexity): boolean {
    return POSITIVE_COMPLEXITIES.includes(complexity);
  }

  private isNegative(complexity: QpdfBenchmarkComplexity): boolean {
    return NEGATIVE_COMPLEXITIES.includes(complexity);
  }

  private countPassingPositiveRuns(
    records: readonly QpdfBenchmarkEvidenceRecord[],
    complexity: QpdfBenchmarkComplexity
  ): number {
    return records.filter(record =>
      record.complexity === complexity &&
      record.qpdfSuccess &&
      record.pdfLibWorkerSuccess &&
      this.hasHardFidelityPass(record)
    ).length;
  }

  private hasHardFidelityPass(record: QpdfBenchmarkEvidenceRecord): boolean {
    return record.qpdfSuccess &&
      record.pdfLibWorkerSuccess &&
      record.pageCountMatch === true &&
      record.pageGeometryMatch === true &&
      record.annotationsMatch === true &&
      record.linksMatch === true &&
      record.widgetsMatch === true &&
      record.outlinesMatch === true &&
      record.fieldsMatch === true &&
      record.firstPageRenderMatch === true &&
      record.report.qpdf.fidelity?.parseable === true;
  }

  private hasCompleteAdvancedFidelity(record: QpdfBenchmarkEvidenceRecord): boolean {
    return record.annotationsMatch !== null &&
      record.linksMatch !== null &&
      record.widgetsMatch !== null &&
      record.outlinesMatch !== null &&
      record.fieldsMatch !== null &&
      record.firstPageRenderMatch !== null;
  }

  private buildSignatures(records: readonly QpdfBenchmarkEvidenceRecord[]): QpdfCorpusWorkloadSignature[] {
    const counts = new Map<string, QpdfCorpusWorkloadSignature>();

    for (const record of records) {
      const key = [
        record.complexity,
        record.inputFileCount,
        record.inputBytes,
        record.inputPages ?? 'unknown'
      ].join('|');
      const existing = counts.get(key);
      if (existing) {
        existing.repeatedRuns += 1;
      } else {
        counts.set(key, {
          complexity: record.complexity,
          inputFileCount: record.inputFileCount,
          inputBytes: record.inputBytes,
          inputPages: record.inputPages,
          repeatedRuns: 1
        });
      }
    }

    return Array.from(counts.values()).sort((a, b) => b.repeatedRuns - a.repeatedRuns || b.inputBytes - a.inputBytes);
  }

  private buildBandCoverage<T extends { id: string; label: string; min: number; maxExclusive: number }>(
    records: readonly QpdfBenchmarkEvidenceRecord[],
    bands: readonly T[],
    valueOf: (record: QpdfBenchmarkEvidenceRecord) => number
  ): QpdfCorpusBandCoverage[] {
    return bands.map(band => {
      const observed = records.filter(record => {
        const value = valueOf(record);
        return value >= band.min && value < band.maxExclusive;
      }).length;
      return {
        id: band.id,
        label: band.label,
        observed,
        target: 1,
        covered: observed >= 1
      };
    });
  }

  private label(complexity: QpdfBenchmarkComplexity): string {
    switch (complexity) {
      case 'text-light': return 'Text-light';
      case 'font-heavy': return 'Font-heavy';
      case 'image-heavy': return 'Image-heavy';
      case 'scanned': return 'Scanned / image-based';
      case 'mixed': return 'Mixed real-world';
      case 'encrypted': return 'Encrypted / password-protected';
      case 'malformed': return 'Malformed / intentionally invalid';
      default: return 'Unknown / exploratory';
    }
  }

  private unique(values: readonly string[]): string[] {
    return Array.from(new Set(values));
  }

  private fileDateStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

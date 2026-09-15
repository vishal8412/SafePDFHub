import { Injectable } from '@angular/core';
import type {
  QpdfBenchmarkComplexity
} from './qpdf-benchmark.types';
import type {
  QpdfBenchmarkEvidenceRecord,
  QpdfEvidenceDeviceClass
} from './qpdf-benchmark-evidence.types';
import type {
  QpdfBenchmarkPlanCoverage,
  QpdfBenchmarkPlanDeviceCoverage,
  QpdfBenchmarkPlanDeviceItem,
  QpdfBenchmarkPlanEvaluationInput,
  QpdfBenchmarkPlanItem,
  QpdfBenchmarkPlanResult
} from './qpdf-benchmark-plan.types';

const TOTAL_RECORD_TARGET = 20;

const PLAN_ITEMS: readonly QpdfBenchmarkPlanItem[] = [
  {
    id: 'text-light',
    label: 'Text-light',
    description: 'Ordinary text-oriented PDFs with modest resource usage.',
    complexity: 'text-light',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'font-heavy',
    label: 'Font-heavy',
    description: 'Documents with many embedded fonts, subsets, or complex typography.',
    complexity: 'font-heavy',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'image-heavy',
    label: 'Image-heavy',
    description: 'PDFs containing large or numerous raster images.',
    complexity: 'image-heavy',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'scanned',
    label: 'Scanned / image-based',
    description: 'Scanned documents where page content is predominantly raster imagery.',
    complexity: 'scanned',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'mixed',
    label: 'Mixed real-world',
    description: 'Representative business PDFs combining text, images, fonts, and varied page layouts.',
    complexity: 'mixed',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'encrypted',
    label: 'Encrypted / password-protected',
    description: 'Known encrypted inputs. Record the actual behavior; do not classify failures as successes.',
    complexity: 'encrypted',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'malformed',
    label: 'Malformed / intentionally invalid',
    description: 'Known invalid or damaged PDFs used to evaluate safe failure behavior.',
    complexity: 'malformed',
    minimumRuns: 2,
    priority: 'required'
  },
  {
    id: 'unknown',
    label: 'Unknown / exploratory',
    description: 'Unclassified PDFs useful for exploratory runs but not sufficient for required coverage.',
    complexity: 'unknown',
    minimumRuns: 1,
    priority: 'recommended'
  }
];

const DEVICE_ITEMS: readonly QpdfBenchmarkPlanDeviceItem[] = [
  {
    deviceClass: 'desktop-standard',
    label: 'Desktop standard',
    minimumRuns: 1,
    priority: 'required'
  },
  {
    deviceClass: 'desktop-high-end',
    label: 'Desktop high-end',
    minimumRuns: 1,
    priority: 'required'
  },
  {
    deviceClass: 'mobile',
    label: 'Mobile',
    minimumRuns: 1,
    priority: 'required'
  },
  {
    deviceClass: 'tablet',
    label: 'Tablet',
    minimumRuns: 1,
    priority: 'recommended'
  }
];

@Injectable({ providedIn: 'root' })
export class QpdfBenchmarkPlanService {
  readonly items = PLAN_ITEMS;
  readonly devices = DEVICE_ITEMS;
  readonly totalRecordTarget = TOTAL_RECORD_TARGET;

  evaluate(input: QpdfBenchmarkPlanEvaluationInput): QpdfBenchmarkPlanResult {
    const records = [...input.records];
    const itemCoverage = PLAN_ITEMS.map(item => this.coverItem(item, records));
    const deviceCoverage = DEVICE_ITEMS.map(item => this.coverDevice(item, records));

    const requiredRecordTarget = PLAN_ITEMS
      .filter(item => item.priority === 'required')
      .reduce((sum, item) => sum + item.minimumRuns, 0);

    const requiredRecordCount = itemCoverage
      .filter(item => item.priority === 'required')
      .reduce((sum, item) => sum + Math.min(item.observedRuns, item.minimumRuns), 0);

    const requiredTargetCoverage = requiredRecordTarget > 0
      ? requiredRecordCount / requiredRecordTarget
      : 1;

    const deviceCoverageCount = deviceCoverage
      .filter(item => item.priority === 'required')
      .filter(item => item.covered)
      .length;
    const requiredDeviceCount = DEVICE_ITEMS.filter(item => item.priority === 'required').length;
    const deviceCoverageRatio = requiredDeviceCount > 0
      ? deviceCoverageCount / requiredDeviceCount
      : 1;

    const recordVolumeRatio = Math.min(records.length / TOTAL_RECORD_TARGET, 1);
    const coveragePercent = Math.round(
      ((requiredTargetCoverage * 0.7) + (deviceCoverageRatio * 0.2) + (recordVolumeRatio * 0.1)) * 100
    );

    const nextActions = this.createNextActions(
      records,
      itemCoverage,
      deviceCoverage
    );

    return {
      totalRecordTarget: TOTAL_RECORD_TARGET,
      totalRecordCount: records.length,
      requiredRecordCount,
      requiredRecordTarget,
      coveragePercent,
      items: itemCoverage,
      devices: deviceCoverage,
      nextActions,
      note: 'The matrix guides evidence collection; it does not promote qpdf, change the production engine, or raise capacity. Only classify PDFs according to their actual characteristics.'
    };
  }

  private coverItem(
    item: QpdfBenchmarkPlanItem,
    records: readonly QpdfBenchmarkEvidenceRecord[]
  ): QpdfBenchmarkPlanCoverage {
    const observedRuns = records.filter(
      record => record.complexity === item.complexity
    ).length;

    return {
      ...item,
      observedRuns,
      remainingRuns: Math.max(0, item.minimumRuns - observedRuns),
      covered: observedRuns >= item.minimumRuns
    };
  }

  private coverDevice(
    item: QpdfBenchmarkPlanDeviceItem,
    records: readonly QpdfBenchmarkEvidenceRecord[]
  ): QpdfBenchmarkPlanDeviceCoverage {
    const observedRuns = records.filter(
      record => record.deviceClass === item.deviceClass
    ).length;

    return {
      ...item,
      observedRuns,
      remainingRuns: Math.max(0, item.minimumRuns - observedRuns),
      covered: observedRuns >= item.minimumRuns
    };
  }

  private createNextActions(
    records: readonly QpdfBenchmarkEvidenceRecord[],
    items: readonly QpdfBenchmarkPlanCoverage[],
    devices: readonly QpdfBenchmarkPlanDeviceCoverage[]
  ): string[] {
    const actions: string[] = [];

    const missingRequiredItems = items.filter(
      item => item.priority === 'required' && !item.covered
    );

    for (const item of missingRequiredItems.slice(0, 4)) {
      actions.push(
        `Collect ${item.remainingRuns} more ${item.label} benchmark run${item.remainingRuns === 1 ? '' : 's'}.`
      );
    }

    const missingRequiredDevices = devices.filter(
      device => device.priority === 'required' && !device.covered
    );

    for (const device of missingRequiredDevices.slice(0, 3)) {
      actions.push(`Collect at least one benchmark run on ${device.label}.`);
    }

    if (records.length < TOTAL_RECORD_TARGET) {
      actions.push(`Collect ${TOTAL_RECORD_TARGET - records.length} more completed run${TOTAL_RECORD_TARGET - records.length === 1 ? '' : 's'} to reach the ${TOTAL_RECORD_TARGET}-run target.`);
    }

    if (actions.length === 0) {
      actions.push('Required matrix coverage is complete. Review failures, fidelity evidence, responsiveness, and memory/stability before any production-engine decision.');
    }

    return actions;
  }

  static labelForComplexity(complexity: QpdfBenchmarkComplexity): string {
    const item = PLAN_ITEMS.find(candidate => candidate.complexity === complexity);
    return item?.label ?? complexity;
  }

  static labelForDevice(deviceClass: QpdfEvidenceDeviceClass): string {
    const item = DEVICE_ITEMS.find(candidate => candidate.deviceClass === deviceClass);
    return item?.label ?? 'Unknown';
  }
}

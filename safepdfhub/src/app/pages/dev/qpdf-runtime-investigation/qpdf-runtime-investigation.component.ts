import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';

import {
  QpdfRuntimeInvestigationService,
  QpdfRuntimeInvestigationReport,
} from '../../../core/qpdf/qpdf-runtime-investigation.service';

@Component({
  selector: 'app-qpdf-runtime-investigation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './qpdf-runtime-investigation.component.html',
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #061727;
      color: #eaf7ff;
      padding: 32px;
      font-family: Inter, system-ui, sans-serif;
    }
    .shell { max-width: 1100px; margin: 0 auto; }
    h1 { margin: 0 0 8px; }
    h2 { margin-top: 0; }
    p { color: #9eb4c7; line-height: 1.6; }
    .panel {
      margin-top: 24px;
      padding: 24px;
      border: 1px solid rgba(89,191,255,.22);
      border-radius: 16px;
      background: rgba(10,31,48,.86);
    }
    input { width: 100%; margin: 16px 0; }
    button {
      border: 0;
      border-radius: 10px;
      padding: 11px 16px;
      cursor: pointer;
      background: #19ead3;
      color: #061727;
      font-weight: 700;
      margin-right: 8px;
    }
    button.secondary { background: #17364d; color: #eaf7ff; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .progress {
      margin-top: 18px;
      height: 8px;
      overflow: hidden;
      border-radius: 99px;
      background: #102d42;
    }
    .progress > div {
      height: 100%;
      background: #19ead3;
      transition: width .15s ease;
    }
    .result { margin-top: 22px; }
    .pass { color: #19ead3; }
    .fail { color: #ff9d9d; }
    .warn { color: #ffc66d; }
    .workload {
      margin-top: 20px;
      padding: 18px;
      border: 1px solid rgba(89,191,255,.15);
      border-radius: 12px;
      background: rgba(6,23,39,.55);
    }
    dl {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px 20px;
    }
    dt { color: #9eb4c7; }
    dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
    .status { font-weight: 700; }
    .note { font-size: 13px; margin-top: 18px; }
    .actions { margin-top: 14px; }
  `]
})
export class QpdfRuntimeInvestigationComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly service = inject(QpdfRuntimeInvestigationService);

  selectedFile: File | null = null;
  readonly running = signal(false);
  readonly progress = signal(0);
  readonly statusMessage = signal('Select the authoritative PDF to begin.');
  readonly report = signal<QpdfRuntimeInvestigationReport | null>(null);

  get browserAvailable(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.report.set(null);
    this.progress.set(0);
    this.statusMessage.set(
      this.selectedFile
        ? `${this.selectedFile.name} selected.`
        : 'Select the authoritative PDF to begin.',
    );
  }

  async run(forceRerun = false): Promise<void> {
    const file = this.selectedFile;
    if (!this.browserAvailable || !file || this.running()) return;

    this.running.set(true);
    this.report.set(null);
    this.progress.set(0);
    this.statusMessage.set(forceRerun ? 'Starting a fresh QPDF-R5 investigation...' : 'Starting QPDF-R5 investigation...');

    try {
      const report = await this.service.investigate(
        file,
        (progress, message) => {
          this.progress.set(progress);
          this.statusMessage.set(message);
        },
        { forceRerun },
      );
      this.report.set(report);
    } catch (error) {
      this.statusMessage.set(
        error instanceof Error
          ? error.message
          : 'QPDF-R5 investigation failed.',
      );
    } finally {
      this.running.set(false);
    }
  }

  async cancel(): Promise<void> {
    if (!this.running()) return;
    this.statusMessage.set('Cancelling investigation...');
    await this.service.cancel();
    this.running.set(false);
  }

  formatDuration(durationMs: number | null | undefined): string {
    return durationMs == null ? '—' : `${durationMs.toFixed(0)} ms`;
  }

  downloadReport(): void {
    const report = this.report();
    if (!report || typeof document === 'undefined') return;

    const reportJson = JSON.stringify(report, null, 2);
    const blob = new Blob(
      [reportJson],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'qpdf-r5-runtime-boundary-investigation.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { QpdfFidelityService } from '../../../core/qpdf/qpdf-fidelity.service';
import type { QpdfSmokeResult } from '../../../core/qpdf/qpdf-fidelity.types';

@Component({
  selector: 'app-qpdf-smoke',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './qpdf-smoke.component.html',
  styles: [`
    :host { display: block; min-height: 100vh; background: #061727; color: #eaf7ff; padding: 32px; font-family: Inter, system-ui, sans-serif; }
    .shell { max-width: 920px; margin: 0 auto; }
    h1 { margin: 0 0 8px; }
    p { color: #9eb4c7; line-height: 1.6; }
    .panel { margin-top: 24px; padding: 24px; border: 1px solid rgba(89,191,255,.22); border-radius: 16px; background: rgba(10,31,48,.86); }
    input { width: 100%; margin: 16px 0; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; cursor: pointer; background: #19ead3; color: #061727; font-weight: 700; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .progress { margin-top: 18px; height: 8px; overflow: hidden; border-radius: 99px; background: #102d42; }
    .progress > div { height: 100%; background: #19ead3; transition: width .15s ease; }
    .result { margin-top: 22px; }
    .pass { color: #19ead3; }
    .fail { color: #ff9d9d; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; }
    dt { color: #9eb4c7; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    .note { font-size: 13px; margin-top: 18px; }
  `]
})
export class QpdfSmokeComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly fidelityService = inject(QpdfFidelityService);

  selectedFiles: File[] = [];
  progress = 0;
  statusMessage = 'Select at least two PDFs.';
  running = false;
  result: QpdfSmokeResult | null = null;

  get browserAvailable(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
    this.result = null;
    this.progress = 0;
    this.statusMessage = this.selectedFiles.length >= 2
      ? `${this.selectedFiles.length} PDFs selected.`
      : 'Select at least two PDFs.';
  }

  async run(): Promise<void> {
    if (!this.browserAvailable || this.selectedFiles.length < 2 || this.running) return;

    this.running = true;
    this.result = null;
    this.progress = 0;

    try {
      this.result = await this.fidelityService.runSmokeTest(
        this.selectedFiles,
        (progress, message) => {
          this.progress = progress;
          this.statusMessage = message;
        }
      );
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Smoke test failed.';
    } finally {
      this.running = false;
    }
  }
}

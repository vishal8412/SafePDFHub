import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, PLATFORM_ID, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SigningPdfRendererService } from '../../../core/signing/services/signing-pdf-renderer.service';
import { SigningPdfExportService } from '../../../core/signing/services/signing-pdf-export.service';
import type { SigningField } from '../../../core/signing/models/signing.models';

interface BenchmarkScenario {
  readonly id: string;
  readonly label: string;
  readonly pages: number;
  readonly payloadCharsPerPage: number;
}

interface BenchmarkResult {
  readonly scenario: string;
  readonly inputBytes: number;
  readonly pages: number;
  readonly generationMs: number;
  readonly openMs: number;
  readonly renderMs: number;
  readonly exportMs: number;
  readonly totalMs: number;
  readonly peakHeapBytes: number | null;
  readonly heapDeltaBytes: number | null;
  readonly maxEventLoopGapMs: number;
  readonly outputBytes: number;
  readonly status: 'PASS' | 'FAIL';
  readonly error: string | null;
}

interface PerformanceMemory extends Performance {
  memory?: {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
  };
}

@Component({
  selector: 'app-sign-pdf-benchmark',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sign-pdf-benchmark.component.html',
  styles: [`
    :host { display:block; min-height:100vh; padding:32px; box-sizing:border-box; background:#061727; color:#eaf7ff; font-family:Inter,system-ui,sans-serif; }
    .shell { max-width:1100px; margin:0 auto; }
    .panel { margin-top:20px; padding:22px; border:1px solid rgba(89,191,255,.2); border-radius:16px; background:rgba(10,31,48,.86); }
    h1,h2 { margin:0 0 10px; }
    p, li { color:#9eb4c7; line-height:1.55; }
    button { border:0; border-radius:10px; padding:11px 16px; cursor:pointer; background:#19ead3; color:#061727; font-weight:700; margin-right:8px; }
    button.secondary { background:#17384e; color:#eaf7ff; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .metric { padding:12px; border-radius:11px; background:rgba(6,23,39,.72); border:1px solid rgba(89,191,255,.12); }
    .metric span { display:block; color:#9eb4c7; font-size:12px; margin-bottom:4px; }
    .metric strong { font-variant-numeric:tabular-nums; }
    .pass { color:#19ead3; }
    .fail { color:#ff9d9d; }
    .warn { color:#ffd58a; }
    table { width:100%; border-collapse:collapse; margin-top:14px; }
    th,td { padding:9px 8px; border-bottom:1px solid rgba(89,191,255,.12); text-align:left; font-variant-numeric:tabular-nums; }
    th { color:#9eb4c7; font-size:12px; }
    code { color:#bcecff; }
    .status { margin-top:14px; }
    @media (max-width:760px) { :host { padding:18px; } .grid { grid-template-columns:1fr 1fr; } }
  `]
})
export class SignPdfBenchmarkComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly renderer = inject(SigningPdfRendererService);
  private readonly exporter = inject(SigningPdfExportService);
  private readonly cd = inject(ChangeDetectorRef);

  readonly scenarios: readonly BenchmarkScenario[] = [
    { id: '10p', label: '10 pages / light', pages: 10, payloadCharsPerPage: 20_000 },
    { id: '50p', label: '50 pages / medium', pages: 50, payloadCharsPerPage: 40_000 },
    { id: '100p', label: '100 pages / heavy', pages: 100, payloadCharsPerPage: 100_000 },
    { id: '250p', label: '250 pages / large', pages: 250, payloadCharsPerPage: 120_000 },
    { id: '500p', label: '500 pages / ceiling', pages: 500, payloadCharsPerPage: 180_000 },
  ];

  selectedScenario = '10p';
  running = false;
  status = 'Ready. This development-only benchmark exercises the real Sign PDF renderer and exporter.';
  results: BenchmarkResult[] = [];
  private autoStarted = false;
  private loopTimer: number | null = null;
  private lastLoopTick = 0;
  private maxLoopGap = 0;
  private memoryPeak: number | null = null;
  private memoryInitial: number | null = null;

  get browserAvailable(): boolean { return isPlatformBrowser(this.platformId); }

  ngOnInit(): void {
    if (!this.browserAvailable) return;
    const auto = this.route.snapshot.queryParamMap.get('auto');
    const profile = this.route.snapshot.queryParamMap.get('profile');
    if (auto === '1' && !this.autoStarted) {
      this.autoStarted = true;
      if (profile === 'full') {
        void this.runAll();
      } else {
        void this.runScenario();
      }
    }
  }

  async runScenario(): Promise<void> {
    const scenario = this.scenarios.find(item => item.id === this.selectedScenario) ?? this.scenarios[0];
    await this.execute(scenario);
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.results = [];
    for (const scenario of this.scenarios) {
      await this.execute(scenario);
      if (this.results.at(-1)?.status === 'FAIL') break;
    }
  }

  private async execute(scenario: BenchmarkScenario): Promise<void> {
    if (!this.browserAvailable || this.running) return;
    this.running = true;
    this.status = `Generating ${scenario.label} PDF…`;
    this.cd.detectChanges();

    const started = performance.now();
    let generationMs = 0;
    let openMs = 0;
    let renderMs = 0;
    let exportMs = 0;
    let outputBytes = 0;
    let session: Awaited<ReturnType<SigningPdfRendererService['open']>> | null = null;
    this.startSampling();

    try {
      const generationStart = performance.now();
      const file = await this.createSyntheticPdf(scenario);
      generationMs = performance.now() - generationStart;
      this.status = `Opening ${this.formatBytes(file.size)} / ${scenario.pages}-page PDF…`;
      this.cd.detectChanges();

      const openStart = performance.now();
      session = await this.renderer.open(file);
      openMs = performance.now() - openStart;
      if (session.pageCount !== scenario.pages) {
        throw new Error(`Renderer reported ${session.pageCount} pages; expected ${scenario.pages}.`);
      }

      const renderStart = performance.now();
      for (let page = 1; page <= scenario.pages; page += 1) {
        if (page === 1 || page === scenario.pages || page % Math.max(1, Math.floor(scenario.pages / 10)) === 0) {
          this.status = `Rendering page ${page}/${scenario.pages}…`;
          this.cd.detectChanges();
        }
        const rendered = await session.renderPage(page, 1.15);
        if (!rendered.imageUrl.startsWith('data:image/webp')) {
          throw new Error(`Page ${page} did not produce a WebP preview.`);
        }
      }
      renderMs = performance.now() - renderStart;

      const fields: SigningField[] = Array.from({ length: scenario.pages }, (_, index) => ({
        id: `bench-${scenario.id}-${index + 1}`,
        pageNumber: index + 1,
        kind: 'text',
        bounds: { x: 0.08, y: 0.08, width: 0.34, height: 0.08 },
        value: `SafePDFHub benchmark page ${index + 1}`,
        fontSize: 14,
        color: '#0f766e',
        opacity: 1,
      }));

      this.status = `Exporting ${scenario.pages} pages with ${fields.length} native text fields…`;
      this.cd.detectChanges();
      const exportStart = performance.now();
      const output = await this.exporter.export(file, fields);
      exportMs = performance.now() - exportStart;
      outputBytes = output.size;

      const result: BenchmarkResult = {
        scenario: scenario.label,
        inputBytes: file.size,
        pages: scenario.pages,
        generationMs,
        openMs,
        renderMs,
        exportMs,
        totalMs: performance.now() - started,
        peakHeapBytes: this.memoryPeak,
        heapDeltaBytes: this.memoryInitial === null || this.memoryPeak === null ? null : this.memoryPeak - this.memoryInitial,
        maxEventLoopGapMs: this.maxLoopGap,
        outputBytes,
        status: 'PASS',
        error: null,
      };
      this.results = [...this.results, result];
      this.status = `${scenario.label}: PASS`;
    } catch (error) {
      this.results = [...this.results, {
        scenario: scenario.label,
        inputBytes: 0,
        pages: scenario.pages,
        generationMs,
        openMs,
        renderMs,
        exportMs,
        totalMs: performance.now() - started,
        peakHeapBytes: this.memoryPeak,
        heapDeltaBytes: this.memoryInitial === null || this.memoryPeak === null ? null : this.memoryPeak - this.memoryInitial,
        maxEventLoopGapMs: this.maxLoopGap,
        outputBytes,
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
      }];
      this.status = `${scenario.label}: FAIL — ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (session) {
        try { await session.destroy(); } catch { /* benchmark cleanup */ }
      }
      this.stopSampling();
      this.running = false;
      this.cd.detectChanges();
    }
  }

  private async createSyntheticPdf(scenario: BenchmarkScenario): Promise<File> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    for (let pageIndex = 0; pageIndex < scenario.pages; pageIndex += 1) {
      const page = pdf.addPage([612, 792]);
      page.drawText(`SafePDFHub Sign PDF stress scenario: ${scenario.id} / page ${pageIndex + 1}`, {
        x: 42,
        y: 748,
        size: 12,
        font,
        color: rgb(0.06, 0.46, 0.38),
      });

      // Unique, non-compressible-ish page content exercises PDF parsing without
      // relying on a fake/invalid file. The exact byte size is workload-dependent.
      let payload = '';
      let seed = (pageIndex + 1) * 2654435761;
      while (payload.length < scenario.payloadCharsPerPage) {
        seed = (seed ^ (seed >>> 13)) * 1597334677;
        seed >>>= 0;
        payload += alphabet[(seed >>> 0) % alphabet.length];
      }
      page.drawText(payload.slice(0, scenario.payloadCharsPerPage), {
        x: 42,
        y: 700,
        size: 5,
        font,
        maxWidth: 520,
        lineHeight: 6,
      });
    }

    const bytes = await pdf.save({ useObjectStreams: true });

    // TypeScript 5.9+ models Uint8Array as Uint8Array<ArrayBufferLike>.
    // File/BlobPart requires an ArrayBuffer-backed view in this build.
    // Copy into a concrete ArrayBuffer so the benchmark remains strictly typed
    // without weakening the project's compiler settings.
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);

    return new File(
      [fileBuffer],
      `sign-pdf-benchmark-${scenario.id}.pdf`,
      { type: 'application/pdf' },
    );
  }

  private startSampling(): void {
    this.stopSampling();
    this.maxLoopGap = 0;
    this.memoryPeak = this.readHeap();
    this.memoryInitial = this.memoryPeak;
    this.lastLoopTick = performance.now();
    this.loopTimer = window.setInterval(() => {
      const now = performance.now();
      const gap = now - this.lastLoopTick;
      this.maxLoopGap = Math.max(this.maxLoopGap, gap);
      this.lastLoopTick = now;
      const heap = this.readHeap();
      if (heap !== null) this.memoryPeak = Math.max(this.memoryPeak ?? heap, heap);
    }, 50);
  }

  private stopSampling(): void {
    if (this.loopTimer !== null) window.clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  private readHeap(): number | null {
    const memory = performance as PerformanceMemory;
    return typeof memory.memory?.usedJSHeapSize === 'number' ? memory.memory.usedJSHeapSize : null;
  }

  formatBytes(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  formatMs(value: number): string { return `${Math.round(value).toLocaleString('en-US')} ms`; }
}

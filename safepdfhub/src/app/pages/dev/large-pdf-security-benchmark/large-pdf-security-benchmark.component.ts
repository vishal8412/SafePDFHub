import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, PLATFORM_ID, inject } from '@angular/core';
import { LargePdfSecurityEngine, LargePdfSecurityEngineError } from '../../../core/security/large-file/large-pdf-security.engine';
import { LargePdfSecurityCapabilityService } from '../../../core/security/large-file/large-pdf-security-capability.service';
import { LargePdfSecurityF2R2Engine } from '../../../core/security/f2r2/large-pdf-security-f2r2.engine';
import type { LargePdfSecurityF2R2Result } from '../../../core/security/f2r2/large-pdf-security-f2r2.protocol';
import type { PdfLargeFilePerformanceMode, PdfSecurityResult } from '../../../core/security/pdf-security.types';
import type { LargePdfSecurityF3CryptoProvider, LargePdfSecurityF3RawAesBenchmarkResult, LargePdfSecurityPhaseTiming, LargePdfSecurityProgressPhase, LargePdfSecurityRuntimeInfo } from '../../../core/security/large-file/large-pdf-security.protocol';
import type { LargePdfSecurityPerformanceProfile, LargePdfSecurityWasmRuntime } from '../../../core/security/large-file/large-pdf-security.performance.config';

interface MemorySample {
  readonly timestampMs: number;
  readonly usedJsHeapBytes: number | null;
  readonly totalJsHeapBytes: number | null;
}

interface MainThreadPhaseProfile {
  phase: LargePdfSecurityPhaseTiming['phase'];
  durationMs: number;
  maxEventLoopGapMs: number;
  peakJsHeapBytes: number | null;
  initialJsHeapBytes: number | null;
  jsHeapDeltaBytes: number | null;
}

interface BenchmarkReport {
  readonly status: 'passed' | 'failed';
  readonly inputName: string;
  readonly inputBytes: number;
  readonly outputName: string | null;
  readonly outputBytes: number | null;
  readonly engineDurationMs: number | null;
  readonly wallClockDurationMs: number;
  readonly maxEventLoopGapMs: number;
  readonly initialJsHeapBytes: number | null;
  readonly peakJsHeapBytes: number | null;
  readonly jsHeapDeltaBytes: number | null;
  readonly deviceMemoryGb: number | null;
  readonly hardwareConcurrency: number | null;
  readonly errorMessage: string | null;
  readonly outputHeaderValid: boolean;
  readonly notes: readonly string[];
  readonly workerPhaseTimings: readonly LargePdfSecurityPhaseTiming[];
  readonly mainThreadPhaseTimings: readonly LargePdfSecurityPhaseTiming[];
  readonly mainThreadPhaseProfiles: readonly MainThreadPhaseProfile[];
  readonly performanceProfile: LargePdfSecurityPerformanceProfile | null;
  readonly wasmRuntime: LargePdfSecurityWasmRuntime | null;
  readonly runtimeInfo: LargePdfSecurityRuntimeInfo | null;
  readonly encryptionBits: 128 | 256;
  readonly largeFilePerformance: PdfLargeFilePerformanceMode;
}

type PerformanceMemory = Performance & {
  memory?: {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
  };
};

@Component({
  selector: 'app-large-pdf-security-benchmark',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './large-pdf-security-benchmark.component.html',
  styles: [`
    :host { display: block; min-height: 100vh; background: #061727; color: #eaf7ff; padding: 32px; font-family: Inter, system-ui, sans-serif; }
    .shell { max-width: 1080px; margin: 0 auto; }
    h1 { margin: 0 0 8px; }
    h2 { margin: 0 0 12px; }
    p { color: #9eb4c7; line-height: 1.6; }
    .panel { margin-top: 24px; padding: 24px; border: 1px solid rgba(89,191,255,.22); border-radius: 16px; background: rgba(10,31,48,.86); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .live-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
    .metric { padding: 14px; border: 1px solid rgba(89,191,255,.16); border-radius: 12px; background: rgba(6,23,39,.7); }
    .metric span { display: block; color: #9eb4c7; font-size: 12px; margin-bottom: 5px; }
    .metric strong { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    input[type='file'] { width: 100%; margin: 16px 0; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; cursor: pointer; background: #19ead3; color: #061727; font-weight: 700; margin-right: 8px; }
    button.secondary { background: #17384e; color: #eaf7ff; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .progress { margin-top: 18px; height: 8px; overflow: hidden; border-radius: 99px; background: #102d42; }
    .progress > div { height: 100%; background: #19ead3; transition: width .15s ease; }
    .pass { color: #19ead3; }
    .fail { color: #ff9d9d; }
    .warn { color: #ffd58a; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; margin: 0; }
    dt { color: #9eb4c7; }
    dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
    .note { font-size: 13px; margin-top: 18px; }
    .profile-panel { margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(89,191,255,.14); }
    .profile-table-wrap { overflow-x: auto; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 10px 12px; border-bottom: 1px solid rgba(89,191,255,.12); text-align: left; }
    th { color: #9eb4c7; font-size: 12px; font-weight: 600; }
    td:nth-child(2), td:nth-child(3), th:nth-child(2), th:nth-child(3) { text-align: right; white-space: nowrap; }
    code { color: #bcecff; }
    ul { color: #9eb4c7; line-height: 1.6; }
    @media (max-width: 760px) { .grid, .metric-grid, .live-grid { grid-template-columns: 1fr; } :host { padding: 18px; } dd { text-align: left; } }
  `]
})
export class LargePdfSecurityBenchmarkComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly engine = inject(LargePdfSecurityEngine);
  readonly f2r2Engine = inject(LargePdfSecurityF2R2Engine);
  readonly capability = inject(LargePdfSecurityCapabilityService);

  selectedFile: File | null = null;
  progress = 0;
  running = false;
  statusMessage = 'Select a PDF to benchmark the dedicated large-file browser security engine.';
  report: BenchmarkReport | null = null;
  outputFile: File | null = null;
  private eventLoopTimer: number | null = null;
  private lastEventLoopTick = 0;
  protected maxEventLoopGap = 0;
  liveOutputBytes: number | null = null;
  liveOutputName: string | null = null;
  liveOutputHeaderValid: boolean | null = null;
  liveOutputBytesWritten: number | null = null;
  private memorySamples: MemorySample[] = [];
  private mainThreadPhaseTimings: LargePdfSecurityPhaseTiming[] = [];
  private mainThreadPhaseProfiles: MainThreadPhaseProfile[] = [];
  private activeMainThreadPhase: LargePdfSecurityProgressPhase = 'starting';
  private activeMainThreadPhaseStartedAt = 0;
  private workerPhaseTimings: readonly LargePdfSecurityPhaseTiming[] = [];
  private performanceProfile: LargePdfSecurityPerformanceProfile | null = null;
  private wasmRuntime: LargePdfSecurityWasmRuntime | null = null;
  private runtimeInfo: LargePdfSecurityRuntimeInfo | null = null;
  largeFilePerformance: PdfLargeFilePerformanceMode = 'fast';
  f3DiagnosticsRunning = false;
  f3DiagnosticsResults: LargePdfSecurityF3RawAesBenchmarkResult[] = [];
  f3DiagnosticsError: string | null = null;
  f3ConcurrencyResults: readonly { concurrency: number; elapsedMs: number; throughputMiBPerSecond: number }[] = [];
  f2r2Running = false;
  f2r2Result: LargePdfSecurityF2R2Result | null = null;
  f2r2Error: string | null = null;

  setBenchmarkPerformanceMode(mode: PdfLargeFilePerformanceMode): void {
    if (this.running) return;
    this.largeFilePerformance = mode;
    this.report = null;
    this.outputFile = null;
  }

  elapsedMs = 0;
  currentJsHeapBytes: number | null = null;
  currentJsHeapTotalBytes: number | null = null;
  currentPhase: LargePdfSecurityProgressPhase = 'starting';
  private runStartedAt = 0;

  get browserAvailable(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  get engineAvailable(): boolean {
    return this.browserAvailable && this.engine.supported;
  }

  get capabilitySummary(): string {
    const c = this.capability.current;
    return `${c.maxFileBytes / (1024 * 1024 * 1024)} GiB input target • Worker ${c.worker ? 'yes' : 'no'} • File API ${c.fileApi ? 'yes' : 'no'} • OPFS ${c.opfs ? 'yes' : 'no'}`;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.report = null;
    this.outputFile = null;
    this.progress = 0;
    this.statusMessage = this.selectedFile
      ? `Selected ${this.selectedFile.name} (${this.formatBytes(this.selectedFile.size)}).`
      : 'Select a PDF to benchmark the dedicated large-file browser security engine.';
  }

  async runF2R2(): Promise<void> {
    const file = this.selectedFile;
    if (!file || this.running || this.f3DiagnosticsRunning || this.f2r2Running || !this.f2r2Engine.supported) return;

    this.f2r2Running = true;
    this.f2r2Result = null;
    this.f2r2Error = null;
    this.statusMessage = 'Running F2-R.2 isolated reference vs bulk PDF pipeline…';

    try {
      this.f2r2Result = await this.f2r2Engine.run(file, 256);
      this.statusMessage = this.f2r2Result.encryptedOutputsByteExact
        && this.f2r2Result.referenceCheckPassed
        && this.f2r2Result.candidateCheckPassed
        ? 'F2-R.2 PASS — isolated bulk PDF output matched the reference byte-for-byte.'
        : 'F2-R.2 REVIEW — the isolated candidate did not meet every correctness gate.';
    } catch (error) {
      this.f2r2Error = error instanceof Error ? error.message : String(error);
      this.statusMessage = 'F2-R.2 failed — candidate remains isolated and production runtime is unchanged.';
    } finally {
      this.f2r2Running = false;
      this.changeDetector.markForCheck();
    }
  }

  async run(): Promise<void> {
    const file = this.selectedFile;
    if (!file || this.running || !this.engineAvailable) return;

    const wallStart = performance.now();

    this.running = true;
    this.report = null;
    this.progress = 0;
    this.statusMessage = 'Starting dedicated Worker benchmark…';
    this.currentPhase = 'starting';
    this.elapsedMs = 0;
    this.memorySamples = [];
    this.mainThreadPhaseTimings = [];
    this.mainThreadPhaseProfiles = [];
    this.workerPhaseTimings = [];
    this.performanceProfile = null;
    this.wasmRuntime = null;
    this.runtimeInfo = null;
    this.activeMainThreadPhase = 'starting';
    this.activeMainThreadPhaseStartedAt = wallStart;
    this.maxEventLoopGap = 0;
    this.liveOutputBytes = null;
    this.liveOutputName = null;
    this.liveOutputHeaderValid = null;
    this.liveOutputBytesWritten = null;
    this.lastEventLoopTick = wallStart;
    this.runStartedAt = wallStart;
    const initialMemory = this.readMemory();
    this.currentJsHeapBytes = initialMemory?.usedJsHeapBytes ?? null;
    this.currentJsHeapTotalBytes = initialMemory?.totalJsHeapBytes ?? null;
    this.zone.runOutsideAngular(() => this.startTelemetry());

    let result: PdfSecurityResult | null = null;
    let errorMessage: string | null = null;

    try {
      result = await this.engine.protect(
        file,
        {
          userPassword: 'SafePDFHub!Bench2026',
          permissions: {
            allowPrinting: true,
            allowCopying: true,
            allowModifying: false,
            allowAnnotations: true,
            allowForms: true,
            allowAssembly: false
          },
          // Dev benchmark intentionally opts into the large-file speed profile.
          // The profile uses AES-128 for >=64 MiB when bits are not explicitly forced,
          // plus stream-data preservation. This does NOT change the production default.
          largeFilePerformance: this.largeFilePerformance,
          // Normal Protect benchmark must remain performance-neutral. F3 profiling is opt-in.
          enableF3Diagnostics: false
        },
        (progress: number, phase?: LargePdfSecurityProgressPhase, outputSize?: number, outputName?: string, outputHeaderValid?: boolean, phaseTimings?: readonly LargePdfSecurityPhaseTiming[], performanceProfile?: LargePdfSecurityPerformanceProfile, wasmRuntime?: LargePdfSecurityWasmRuntime, outputBytesWritten?: number, runtimeInfo?: LargePdfSecurityRuntimeInfo) => {
          this.zone.run(() => {
            this.progress = progress;
            if (phase) {
              this.recordMainThreadPhaseTransition(phase);
              this.currentPhase = phase;
            }
            if (outputSize !== undefined) this.liveOutputBytes = outputSize;
            if (outputName !== undefined) this.liveOutputName = outputName;
            if (outputHeaderValid !== undefined) this.liveOutputHeaderValid = outputHeaderValid;
            if (phaseTimings) this.workerPhaseTimings = phaseTimings;
            if (performanceProfile) this.performanceProfile = performanceProfile;
            if (wasmRuntime) this.wasmRuntime = wasmRuntime;
            if (runtimeInfo) this.runtimeInfo = runtimeInfo;
            if (outputBytesWritten !== undefined) this.liveOutputBytesWritten = outputBytesWritten;
            this.statusMessage = `${this.phaseLabel(this.currentPhase)}… ${progress}%`;
            this.changeDetector.markForCheck();
          });
        }
      );
      this.statusMessage = 'Benchmark completed. Capturing final telemetry…';
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof LargePdfSecurityEngineError) {
        this.workerPhaseTimings = error.phaseTimings;
        this.performanceProfile = error.performanceProfile;
        this.wasmRuntime = error.wasmRuntime ?? this.wasmRuntime;
        this.runtimeInfo = error.runtimeInfo ?? this.runtimeInfo;
        const diagnostics = [...error.stderr, ...error.stdout]
          .map(line => line.trim())
          .filter(Boolean)
          .slice(-6);

        if (diagnostics.length > 0) {
          errorMessage = `${errorMessage} ${diagnostics.join(' | ')}`;
        }
      }
      this.statusMessage = 'Benchmark failed.';
    } finally {
      this.stopTelemetry();
    }

    const wallClockDurationMs = performance.now() - wallStart;
    this.closeMainThreadPhase(performance.now());
    this.elapsedMs = wallClockDurationMs;
    const finalMemory = this.readMemory();
    this.currentJsHeapBytes = finalMemory?.usedJsHeapBytes ?? this.currentJsHeapBytes;
    this.currentJsHeapTotalBytes = finalMemory?.totalJsHeapBytes ?? this.currentJsHeapTotalBytes;
    if (initialMemory) this.memorySamples.unshift(initialMemory);
    if (finalMemory) this.memorySamples.push(finalMemory);

    const peakJsHeapBytes = this.memorySamples.reduce<number | null>((peak, sample) => {
      if (sample.usedJsHeapBytes === null) return peak;
      return peak === null ? sample.usedJsHeapBytes : Math.max(peak, sample.usedJsHeapBytes);
    }, null);
    const initialJsHeapBytes = initialMemory?.usedJsHeapBytes ?? null;
    const jsHeapDeltaBytes = peakJsHeapBytes !== null && initialJsHeapBytes !== null
      ? peakJsHeapBytes - initialJsHeapBytes
      : null;

    // The large-file Worker validates the PDF signature before the output is handed
    // off through OPFS. Do not call File.text()/arrayBuffer() here: the returned File
    // may be backed by an OPFS entry that the engine has already cleaned up.
    const outputHeaderValid = result ? this.liveOutputHeaderValid === true : false;
    const passed = !!result && result.file.size > 0 && outputHeaderValid && !errorMessage;

    this.outputFile = result?.file ?? null;

    this.report = {
      status: passed ? 'passed' : 'failed',
      inputName: file.name,
      inputBytes: file.size,
      outputName: result?.file.name ?? null,
      outputBytes: result?.file.size ?? null,
      engineDurationMs: result?.durationMs ?? null,
      wallClockDurationMs,
      maxEventLoopGapMs: this.maxEventLoopGap,
      initialJsHeapBytes,
      peakJsHeapBytes,
      jsHeapDeltaBytes,
      deviceMemoryGb: typeof navigator !== 'undefined' && 'deviceMemory' in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || null
        : null,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
      errorMessage,
      outputHeaderValid,
      notes: [
        'JS heap telemetry measures the browser main thread only; it does not measure qpdf WASM Worker memory.',
        'Worker phase timings measure time inside the dedicated qpdf Worker; main-thread phase timings measure the browser-side interval between phase callbacks.',
        'The benchmark intentionally does not download or retain a 1 GiB ArrayBuffer in Angular.',
        'A PASS proves this browser completed this input successfully; it is not a universal 1 GiB production guarantee.'
      ],
      workerPhaseTimings: this.workerPhaseTimings,
      mainThreadPhaseTimings: [...this.mainThreadPhaseTimings],
      mainThreadPhaseProfiles: [...this.mainThreadPhaseProfiles],
      performanceProfile: this.performanceProfile,
      wasmRuntime: this.wasmRuntime,
      runtimeInfo: this.runtimeInfo,
      encryptionBits: this.performanceProfile === 'fast-aes-128' ? 128 : 256,
      largeFilePerformance: this.largeFilePerformance
    };

    this.running = false;
    this.currentPhase = passed ? 'finalizing' : this.currentPhase;
    this.progress = passed ? 100 : this.progress;
    this.statusMessage = passed ? 'PASS — browser security engine completed the PDF.' : 'REVIEW / FAIL — inspect the error and telemetry.';
    this.changeDetector.markForCheck();
  }

  async runF3Diagnostics(): Promise<void> {
    if (this.running || this.f3DiagnosticsRunning || !this.engineAvailable) return;
    this.f3DiagnosticsRunning = true;
    this.f3DiagnosticsResults = [];
    this.f3DiagnosticsError = null;
    this.f3ConcurrencyResults = [];
    this.statusMessage = 'Running F3 raw AES provider/buffer diagnostics…';
    this.changeDetector.markForCheck();

    const matrix: readonly {
      provider: LargePdfSecurityF3CryptoProvider;
      bits: 128 | 256;
      bulk: boolean;
    }[] = [
      { provider: 'openssl', bits: 128, bulk: false },
      { provider: 'openssl', bits: 128, bulk: true },
      { provider: 'openssl', bits: 256, bulk: false },
      { provider: 'openssl', bits: 256, bulk: true },
      { provider: 'native', bits: 128, bulk: false },
      { provider: 'native', bits: 128, bulk: true },
      { provider: 'native', bits: 256, bulk: false },
      { provider: 'native', bits: 256, bulk: true }
    ];

    try {
      for (const item of matrix) {
        const result = await this.engine.runF3RawAesBenchmark({
          ...item,
          bufferBytes: 262144,
          totalMiB: 32
        });
        this.f3DiagnosticsResults = [...this.f3DiagnosticsResults, result];
        this.changeDetector.markForCheck();
      }

      for (const bufferBytes of [16384, 65536, 1048576, 4194304]) {
        const result = await this.engine.runF3RawAesBenchmark({
          provider: 'openssl',
          bits: 128,
          bufferBytes,
          totalMiB: 16,
          bulk: true
        });
        this.f3DiagnosticsResults = [...this.f3DiagnosticsResults, result];
        this.changeDetector.markForCheck();
      }

      for (const concurrency of [2, 4]) {
        const started = performance.now();
        const results = await Promise.all(
          Array.from({ length: concurrency }, () => this.engine.runF3RawAesBenchmark({
            provider: 'openssl',
            bits: 128,
            bufferBytes: 262144,
            totalMiB: 16,
            bulk: true
          }))
        );
        const elapsedMs = performance.now() - started;
        const totalMiB = results.reduce((sum, result) => sum + result.totalMiB, 0);
        this.f3ConcurrencyResults = [
          ...this.f3ConcurrencyResults,
          { concurrency, elapsedMs, throughputMiBPerSecond: totalMiB / (elapsedMs / 1000) }
        ];
        this.changeDetector.markForCheck();
      }

      this.statusMessage = 'F3 diagnostics completed. Raw AES results are independent of the PDF writer benchmark.';
    } catch (error: unknown) {
      this.f3DiagnosticsError = error instanceof Error ? error.message : String(error);
      this.statusMessage = 'F3 diagnostics failed.';
    } finally {
      this.f3DiagnosticsRunning = false;
      this.changeDetector.markForCheck();
    }
  }

  async downloadResult(): Promise<void> {
    const file = this.outputFile;
    if (!file || typeof window === 'undefined') return;

    const savePickerWindow = window as Window & {
      showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: readonly {
          description?: string;
          accept: Record<string, readonly string[]>;
        }[];
      }) => Promise<{
        createWritable: () => Promise<WritableStream<Uint8Array> & {
          abort?: () => Promise<void>;
        }>;
      }>;
    };

    // On Chromium/Edge, stream the OPFS-backed File directly into a user-selected
    // destination. This avoids turning a large result into an ArrayBuffer and
    // avoids an additional Blob copy. Other browsers keep the zero-copy-friendly
    // blob URL fallback.
    if (savePickerWindow.showSaveFilePicker) {
      try {
        this.statusMessage = 'Saving output directly to disk…';
        const handle = await savePickerWindow.showSaveFilePicker({
          suggestedName: file.name,
          types: [{
            description: 'PDF document',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });

        const writable = await handle.createWritable();
        try {
          await file.stream().pipeTo(writable);
        } catch (error) {
          if (writable.abort) {
            await writable.abort().catch(() => undefined);
          }
          throw error;
        }

        this.statusMessage = 'Output saved successfully.';
        this.changeDetector.markForCheck();
        return;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.statusMessage = 'Save cancelled.';
          this.changeDetector.markForCheck();
          return;
        }
        // Fall through to the standard browser download path. The fallback
        // still uses a Blob URL and does not call arrayBuffer()/text().
      }
    }

    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Keep the URL alive long enough for the browser's download/navigation
    // machinery to acquire the Blob. Do not revoke it synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  cancel(): void {
    if (!this.running) return;
    this.engine.cancel();
    this.statusMessage = 'Cancellation requested…';
  }

  private recordMainThreadPhaseTransition(nextPhase: LargePdfSecurityProgressPhase): void {
    if (nextPhase === this.activeMainThreadPhase) return;

    const now = performance.now();
    this.closeMainThreadPhase(now);
    this.activeMainThreadPhase = nextPhase;
    this.activeMainThreadPhaseStartedAt = now;

    if (this.isMeasurablePhase(nextPhase)) {
      const memory = this.readMemory();
      this.mainThreadPhaseProfiles.push({
        phase: nextPhase,
        durationMs: 0,
        maxEventLoopGapMs: 0,
        peakJsHeapBytes: memory?.usedJsHeapBytes ?? null,
        initialJsHeapBytes: memory?.usedJsHeapBytes ?? null,
        jsHeapDeltaBytes: 0
      });
    }
  }

  private closeMainThreadPhase(now: number): void {
    if (!this.activeMainThreadPhaseStartedAt) return;

    const durationMs = Math.max(0, now - this.activeMainThreadPhaseStartedAt);
    if (this.isMeasurablePhase(this.activeMainThreadPhase)) {
      const existingTiming = this.mainThreadPhaseTimings.find(
        timing => timing.phase === this.activeMainThreadPhase
      );
      if (existingTiming) {
        this.mainThreadPhaseTimings = this.mainThreadPhaseTimings.map(timing =>
          timing.phase === this.activeMainThreadPhase
            ? { ...timing, durationMs: timing.durationMs + durationMs }
            : timing
        );
      } else {
        this.mainThreadPhaseTimings.push({
          phase: this.activeMainThreadPhase,
          durationMs
        });
      }

      const existingProfile = this.mainThreadPhaseProfiles.find(
        profile => profile.phase === this.activeMainThreadPhase
      );
      if (existingProfile) {
        existingProfile.durationMs += durationMs;
        existingProfile.jsHeapDeltaBytes =
          existingProfile.peakJsHeapBytes !== null && existingProfile.initialJsHeapBytes !== null
            ? existingProfile.peakJsHeapBytes - existingProfile.initialJsHeapBytes
            : null;
      }
    }

    this.activeMainThreadPhaseStartedAt = now;
  }

  private updateActiveMainThreadProfile(
    gapMs: number,
    memory: MemorySample | null
  ): void {
    if (!this.isMeasurablePhase(this.activeMainThreadPhase)) return;

    const profile = this.mainThreadPhaseProfiles.find(
      item => item.phase === this.activeMainThreadPhase
    );
    if (!profile) return;

    profile.maxEventLoopGapMs = Math.max(profile.maxEventLoopGapMs, gapMs);

    const usedJsHeapBytes = memory?.usedJsHeapBytes ?? null;
    if (usedJsHeapBytes !== null) {
      profile.peakJsHeapBytes = profile.peakJsHeapBytes === null
        ? usedJsHeapBytes
        : Math.max(profile.peakJsHeapBytes, usedJsHeapBytes);
      profile.jsHeapDeltaBytes = profile.initialJsHeapBytes === null
        ? null
        : profile.peakJsHeapBytes - profile.initialJsHeapBytes;
    }
  }

  private isMeasurablePhase(
    phase: LargePdfSecurityProgressPhase
  ): phase is Exclude<LargePdfSecurityProgressPhase, 'starting'> {
    return phase !== 'starting';
  }

  private startTelemetry(): void {
    this.lastEventLoopTick = performance.now();
    this.eventLoopTimer = window.setInterval(() => {
      const now = performance.now();
      const gap = now - this.lastEventLoopTick;
      this.maxEventLoopGap = Math.max(this.maxEventLoopGap, gap);
      this.lastEventLoopTick = now;
      this.elapsedMs = now - this.runStartedAt;
      const memory = this.readMemory();
      if (memory) {
        this.memorySamples.push(memory);
        this.currentJsHeapBytes = memory.usedJsHeapBytes;
        this.currentJsHeapTotalBytes = memory.totalJsHeapBytes;
      }
      this.updateActiveMainThreadProfile(gap, memory);

      // Telemetry must not itself become a 20 Hz Angular change-detection workload.
      // Keep sampling outside Angular, then refresh the benchmark UI at a lower rate.
      if (Math.floor(this.elapsedMs / 250) !== Math.floor((this.elapsedMs - 50) / 250)) {
        this.zone.run(() => this.changeDetector.markForCheck());
      }
    }, 50);
  }

  private stopTelemetry(): void {
    if (this.eventLoopTimer !== null) {
      window.clearInterval(this.eventLoopTimer);
      this.eventLoopTimer = null;
    }
  }

  private readMemory(): MemorySample | null {
    const memory = (performance as PerformanceMemory).memory;
    if (!memory) return null;
    return {
      timestampMs: performance.now(),
      usedJsHeapBytes: memory.usedJSHeapSize,
      totalJsHeapBytes: memory.totalJSHeapSize
    };
  }


  wasmRuntimeLabel(runtime: LargePdfSecurityWasmRuntime | null): string {
    switch (runtime) {
      case 'performance': return 'Custom performance qpdf WASM';
      case 'published': return 'Published qpdf-wasm runtime';
      default: return '—';
    }
  }

  f3ProfileLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    if (!info?.f3ProfileEnabled) return 'Not captured';
    return `${info.f3AesCalls ?? 0} calls • ${this.formatBytes(info.f3AesBytes ?? 0)} • ${this.formatMs(info.f3AesElapsedUs === undefined ? null : info.f3AesElapsedUs / 1000)}`;
  }

  f3NonCryptoLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    return info?.f3NonCryptoEncryptMs === undefined ? 'Not captured' : this.formatMs(info.f3NonCryptoEncryptMs);
  }

  f3ThroughputLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    return info?.f3AesThroughputMiBPerSecond === undefined ? 'Not captured' : `${info.f3AesThroughputMiBPerSecond.toFixed(2)} MiB/s`;
  }

  f3ParallelismLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    return info?.f3ParallelismExperiment === 'experimental' ? 'Experimental' : 'Safe default: disabled';
  }

  runtimeValidationLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    if (!info) return '—';
    if (!info.strictValidation) return 'Not strict-validated';
    return `${info.qpdfVersion} • ${info.defaultCryptoProvider ?? 'unknown'} • WASM header ${info.wasmHeaderValid ? 'valid' : 'invalid'}`;
  }

  bulkAesLabel(info: LargePdfSecurityRuntimeInfo | null): string {
    if (!info?.bulkAesEnabled) return 'Disabled';
    const bytes = info.bulkAesBufferBytes;
    if (!bytes) return 'Enabled';
    if (bytes >= 1024 * 1024) return `Enabled • ${bytes / (1024 * 1024)} MiB`;
    return `Enabled • ${Math.round(bytes / 1024)} KiB`;
  }

  performanceProfileLabel(profile: LargePdfSecurityPerformanceProfile | null): string {
    switch (profile) {
      case 'fast-write': return 'Fast-write: stream data preserved';
      case 'fast-aes-128': return 'Fast large-file: AES-128 + stream preserve';
      case 'default': return 'Default qpdf writer';
      default: return '—';
    }
  }

  phaseLabel(phase: LargePdfSecurityProgressPhase): string {
    switch (phase) {
      case 'starting': return 'Starting Worker';
      case 'loading-engine': return 'Loading qpdf WASM';
      case 'mounting-input': return 'Mounting PDF input';
      case 'encrypting': return 'Encrypting in Worker';
      case 'writing-output': return 'Writing output to OPFS';
      case 'finalizing': return 'Finalizing benchmark';
      case 'retrieving-output': return 'Retrieving output from OPFS';
    }
  }

  phaseLabelShort(phase: LargePdfSecurityProgressPhase): string {
    return this.phaseLabel(phase);
  }

  workerPhaseDuration(report: BenchmarkReport, phase: LargePdfSecurityPhaseTiming['phase']): number | null {
    return report.workerPhaseTimings.find(timing => timing.phase === phase)?.durationMs ?? null;
  }

  mainThreadPhaseDuration(report: BenchmarkReport, phase: LargePdfSecurityPhaseTiming['phase']): number | null {
    return report.mainThreadPhaseTimings.find(timing => timing.phase === phase)?.durationMs ?? null;
  }

  mainThreadPhaseProfile(report: BenchmarkReport, phase: LargePdfSecurityPhaseTiming['phase']): MainThreadPhaseProfile | null {
    return report.mainThreadPhaseProfiles.find(profile => profile.phase === phase) ?? null;
  }

  isRegressionReport(report: BenchmarkReport): boolean {
    return report.inputName === '15-MB.pdf' && report.inputBytes === 15_513_995;
  }

  profilePhases(report: BenchmarkReport): readonly LargePdfSecurityPhaseTiming['phase'][] {
    const phases: LargePdfSecurityPhaseTiming['phase'][] = [
      'loading-engine',
      'mounting-input',
      'encrypting',
      'writing-output',
      'finalizing',
      'retrieving-output'
    ];

    return phases.filter(phase =>
      report.workerPhaseTimings.some(timing => timing.phase === phase)
      || report.mainThreadPhaseTimings.some(timing => timing.phase === phase)
    );
  }

  unaccountedWallClockMs(report: BenchmarkReport): number {
    const mainPhaseTotal = report.mainThreadPhaseTimings.reduce(
      (total, timing) => total + timing.durationMs,
      0
    );
    return Math.max(0, report.wallClockDurationMs - mainPhaseTotal);
  }

  unaccountedWorkerMs(report: BenchmarkReport): number {
    const workerPhaseTotal = report.workerPhaseTimings.reduce(
      (total, timing) => total + timing.durationMs,
      0
    );
    return Math.max(0, (report.engineDurationMs ?? 0) - workerPhaseTotal);
  }

  formatFileSize(bytes: number): string {
    return `${this.formatBytes(bytes)} • ${this.formatDecimalMegabytes(bytes)} MB • ${bytes.toLocaleString('en-US')} bytes`;
  }

  private formatDecimalMegabytes(bytes: number): string {
    return (bytes / 1_000_000).toFixed(3);
  }

  formatBytes(bytes: number | null): string {
    if (bytes === null || !Number.isFinite(bytes)) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  formatMs(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ms`;
  }
}

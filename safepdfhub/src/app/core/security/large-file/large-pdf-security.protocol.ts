import type { LargePdfSecurityPerformanceProfile, LargePdfSecurityWasmRuntime } from './large-pdf-security.performance.config';

export type LargePdfSecurityMode = 'protect' | 'unlock' | 'remove-password';

export type LargePdfSecurityF3CryptoProvider = 'openssl' | 'native';

export interface LargePdfSecurityF3RawAesBenchmarkRequest {
  readonly type: 'RUN-F3-RAW-AES';
  readonly provider: LargePdfSecurityF3CryptoProvider;
  readonly bits: 128 | 256;
  readonly bufferBytes: number;
  readonly totalMiB: number;
  readonly bulk: boolean;
  readonly wasmUrl?: string;
  readonly qpdfJsUrl?: string;
  readonly wasmRuntime: LargePdfSecurityWasmRuntime;
}

export interface LargePdfSecurityF3RawAesBenchmarkResult {
  readonly provider: LargePdfSecurityF3CryptoProvider;
  readonly bits: 128 | 256;
  readonly bufferBytes: number;
  readonly totalMiB: number;
  readonly bulk: boolean;
  readonly elapsedMs: number;
  readonly throughputMiBPerSecond: number;
  readonly checksum: number;
  readonly qpdfVersion: string;
}

export type LargePdfSecurityProgressPhase =
  | 'starting'
  | 'loading-engine'
  | 'mounting-input'
  | 'encrypting'
  | 'writing-output'
  | 'finalizing'
  | 'retrieving-output';

export interface LargePdfSecurityRuntimeInfo {
  readonly qpdfVersion: string;
  readonly cryptoProviders: readonly string[];
  readonly defaultCryptoProvider: string | null;
  readonly expectedQpdfVersion: string | null;
  readonly expectedCryptoProvider: string | null;
  readonly wasmHeaderValid: boolean;
  readonly strictValidation: boolean;
  /** F2 build metadata; optional for backward-compatible diagnostics. */
  readonly bulkAesEnabled?: boolean;
  readonly bulkAesBufferBytes?: number;
  readonly f3ProfileEnabled?: boolean;
  readonly f3AesCalls?: number;
  readonly f3AesBytes?: number;
  readonly f3AesElapsedUs?: number;
  readonly f3AesThroughputMiBPerSecond?: number;
  readonly f3NonCryptoEncryptMs?: number;
  readonly f3ParallelismExperiment?: 'disabled-safe-default' | 'experimental';
}

export interface LargePdfSecurityPhaseTiming {
  readonly phase: Exclude<LargePdfSecurityProgressPhase, 'starting'>;
  readonly durationMs: number;
}

export interface LargePdfSecurityPermissions {
  readonly allowPrinting: boolean;
  readonly allowCopying: boolean;
  readonly allowModifying: boolean;
  readonly allowAnnotations: boolean;
  readonly allowForms: boolean;
  readonly allowAssembly: boolean;
}

export interface LargePdfSecurityWorkerRequest {
  readonly type: 'RUN';
  readonly file: File;
  readonly outputName: string;
  readonly mode: LargePdfSecurityMode;
  readonly password?: string;
  readonly userPassword?: string;
  readonly ownerPassword?: string;
  readonly permissions?: LargePdfSecurityPermissions;
  readonly bits?: 128 | 256;
  /** Absolute browser URL for the standalone qpdf-performance.wasm binary. */
  readonly wasmUrl?: string;
  /** Standalone qpdf-performance.js ESM asset used by the module Worker. */
  readonly qpdfJsUrl?: string;
  /** Legacy published URL retained for diagnostics/backward protocol compatibility. */
  readonly publishedWasmUrl?: string;
  readonly wasmRuntime: LargePdfSecurityWasmRuntime;
  /** qpdf writer profile selected for this workload. */
  readonly performanceProfile: LargePdfSecurityPerformanceProfile;
  /** Opt-in development diagnostics. Disabled for normal Protect operations. */
  readonly enableF3Diagnostics?: boolean;
}

export interface LargePdfSecurityCancelMessage {
  readonly type: 'CANCEL';
}

export type LargePdfSecurityWorkerMessage =
  | LargePdfSecurityWorkerRequest
  | LargePdfSecurityF3RawAesBenchmarkRequest
  | LargePdfSecurityCancelMessage;

export type LargePdfSecurityWorkerResponse =
  | {
      readonly type: 'F3_RAW_AES_COMPLETE';
      readonly result: LargePdfSecurityF3RawAesBenchmarkResult;
    }
  | {
      readonly type: 'PROGRESS';
      readonly progress: number;
      readonly phase?: LargePdfSecurityProgressPhase;
      readonly outputSize?: number;
      readonly outputName?: string;
      /** qpdf/OPFS output bytes written so far, when available. */
      readonly outputBytesWritten?: number;
      readonly wasmRuntime?: LargePdfSecurityWasmRuntime;
      readonly runtimeInfo?: LargePdfSecurityRuntimeInfo;
    }
  | {
      readonly type: 'COMPLETE';
      readonly outputPath: string;
      readonly outputName: string;
      readonly outputSize: number;
      readonly outputHeaderValid: boolean;
      readonly durationMs: number;
      /** Worker-side wall-clock duration for each measurable processing phase. */
      readonly phaseTimings: readonly LargePdfSecurityPhaseTiming[];
      readonly performanceProfile: LargePdfSecurityPerformanceProfile;
      readonly wasmRuntime: LargePdfSecurityWasmRuntime;
      readonly runtimeInfo: LargePdfSecurityRuntimeInfo;
    }
  | {
      readonly type: 'ERROR';
      readonly message: string;
      readonly stderr: readonly string[];
      readonly stdout: readonly string[];
      readonly exitCode: number | null;
      /** Partial Worker-side phase timings, when available. */
      readonly phaseTimings?: readonly LargePdfSecurityPhaseTiming[];
      readonly performanceProfile?: LargePdfSecurityPerformanceProfile;
      readonly wasmRuntime?: LargePdfSecurityWasmRuntime;
      readonly runtimeInfo?: LargePdfSecurityRuntimeInfo;
    }
  | {
      readonly type: 'CANCELLED';
    };

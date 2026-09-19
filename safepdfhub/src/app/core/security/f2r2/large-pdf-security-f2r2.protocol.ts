export interface LargePdfSecurityF2R2Request {
  readonly type: 'RUN-F2R2-PDF';
  readonly file: File;
  readonly bits: 128 | 256;
  readonly userPassword: string;
  readonly ownerPassword: string;
  readonly referenceJsUrl: string;
  readonly referenceWasmUrl: string;
  readonly candidateJsUrl: string;
  readonly candidateWasmUrl: string;
}

export interface LargePdfSecurityF2R2Result {
  readonly inputBytes: number;
  readonly bits: 128 | 256;
  readonly referenceElapsedMs: number;
  readonly candidateElapsedMs: number;
  readonly speedup: number;
  readonly referenceOutputBytes: number;
  readonly candidateOutputBytes: number;
  readonly encryptedOutputsByteExact: boolean;
  readonly firstMismatchOffset: number | null;
  readonly referenceCheckPassed: boolean;
  readonly candidateCheckPassed: boolean;
  readonly qpdfVersion: string;
  readonly notes: readonly string[];
}

export type LargePdfSecurityF2R2Response =
  | { readonly type: 'F2R2_COMPLETE'; readonly result: LargePdfSecurityF2R2Result }
  | { readonly type: 'F2R2_ERROR'; readonly message: string; readonly stderr: readonly string[]; readonly stdout: readonly string[] }
  | { readonly type: 'F2R2_PROGRESS'; readonly progress: number; readonly phase: 'loading' | 'reference' | 'candidate' | 'compare' | 'check' };

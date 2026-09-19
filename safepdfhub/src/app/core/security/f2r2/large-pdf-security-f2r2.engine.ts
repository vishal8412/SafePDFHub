import { Injectable } from '@angular/core';
import { LargePdfSecurityCapabilityService } from '../large-file/large-pdf-security-capability.service';
import type {
  LargePdfSecurityF2R2Request,
  LargePdfSecurityF2R2Response,
  LargePdfSecurityF2R2Result
} from './large-pdf-security-f2r2.protocol';

@Injectable({ providedIn: 'root' })
export class LargePdfSecurityF2R2Engine {
  private worker: Worker | null = null;

  constructor(private readonly capability: LargePdfSecurityCapabilityService) {}

  get supported(): boolean {
    return this.capability.supported;
  }

  async run(file: File, bits: 128 | 256 = 256): Promise<LargePdfSecurityF2R2Result> {
    if (!this.supported) throw new Error('The large-file Worker capability is unavailable.');
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('F2-R.2 currently accepts files up to 100 MiB. Larger workloads are enabled only after the isolated candidate passes correctness gates.');
    }

    this.worker?.terminate();
    const worker = new Worker(new URL('./large-pdf-security-f2r2.worker', import.meta.url), { type: 'module' });
    this.worker = worker;

    const url = (name: string) => typeof document !== 'undefined'
      ? new URL(`assets/qpdf/f2r2/${name}`, document.baseURI).toString()
      : '';

    const request: LargePdfSecurityF2R2Request = {
      type: 'RUN-F2R2-PDF',
      file,
      bits,
      userPassword: 'SafePDFHub!F2R2User2026',
      ownerPassword: 'SafePDFHub!F2R2Owner2026',
      referenceJsUrl: url('qpdf-reference.js'),
      referenceWasmUrl: url('qpdf-reference.wasm'),
      candidateJsUrl: url('qpdf-f2r2-candidate.js'),
      candidateWasmUrl: url('qpdf-f2r2-candidate.wasm')
    };

    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<LargePdfSecurityF2R2Response>) => {
        const message = event.data;
        if (message.type === 'F2R2_COMPLETE') {
          worker.terminate();
          this.worker = null;
          resolve(message.result);
        } else if (message.type === 'F2R2_ERROR') {
          worker.terminate();
          this.worker = null;
          reject(new Error(`${message.message}${message.stderr.length ? `\n${message.stderr.join('\n')}` : ''}`));
        }
      };
      worker.onerror = event => {
        worker.terminate();
        this.worker = null;
        reject(new Error(event.message || 'F2-R.2 Worker failed.'));
      };
      worker.postMessage(request);
    });
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

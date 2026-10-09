import type { SafePdfJs } from '../pdf/pdfjs-loader.service';

/** Read only requested ranges. No main-thread copy of the complete 200 MB input. */
export function pdfFileRange(pdfjs: SafePdfJs, file: File, failed: (error: unknown) => void) {
  return new (class extends pdfjs.PDFDataRangeTransport {
    private stopped = false;
    constructor() {
      super(file.size, new Uint8Array(0), true);
    }
    override requestDataRange(begin: number, end: number) {
      void file
        .slice(begin, end)
        .arrayBuffer()
        .then((buffer) => {
          if (!this.stopped) this.onDataRange(begin, new Uint8Array(buffer));
        })
        .catch((error) => {
          if (!this.stopped) failed(error);
        });
    }
    override abort() {
      this.stopped = true;
    }
  })();
}

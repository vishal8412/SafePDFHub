import { Injectable } from "@angular/core";
import { validateWordSelection, wordPdfName } from "./word-to-pdf.service";
export interface WordPdfResult {
  file: File;
  pages: number;
  durationMs: number;
  warnings: string[];
}
@Injectable({ providedIn: "root" })
export class WordDirectPdfService {
  convert(
    file: File,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<WordPdfResult> {
    const invalid = validateWordSelection(file);
    if (invalid) return Promise.reject(Error(invalid));
    if (signal.aborted)
      return Promise.reject(
        new DOMException("Conversion cancelled.", "AbortError"),
      );
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(
          new URL("./local-word-pdf.worker", import.meta.url),
          { type: "module" },
        );
      } catch {
        reject(
          Error(
            "Local conversion is unavailable in this browser. Please use a current desktop browser.",
          ),
        );
        return;
      }
      const cleanup = () => {
        worker.terminate();
        signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        cleanup();
        reject(new DOMException("Conversion cancelled.", "AbortError"));
      };
      signal.addEventListener("abort", cancel, { once: true });
      worker.onerror = () => {
        cleanup();
        reject(
          Error(
            "Conversion stopped unexpectedly. The document may exceed this device’s available memory.",
          ),
        );
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          progress(data.message);
          return;
        }
        cleanup();
        if (data.type === "error") {
          reject(Error(data.message));
          return;
        }
        if (
          data.type !== "complete" ||
          !(data.bytes instanceof Uint8Array) ||
          new TextDecoder().decode(data.bytes.subarray(0, 5)) !== "%PDF-" ||
          !(data.pages > 0)
        ) {
          reject(
            Error(
              "The converted PDF could not be validated. Please try again.",
            ),
          );
          return;
        }
        resolve({
          file: new File([data.bytes], wordPdfName(file.name), {
            type: "application/pdf",
          }),
          pages: data.pages,
          warnings: data.warnings || [],
          durationMs: performance.now() - started,
        });
      };
      worker.postMessage({
        file,
        assetsBase: new URL("assets/fonts/", document.baseURI).href,
      });
    });
  }
}

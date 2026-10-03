/// <reference lib="webworker" />
import { PdfForensicAnalyzerCore } from '../compression/pdf-forensic-analyzer-core';
import { PdfForensicPageObservation } from '../compression/pdf-forensic.models';

addEventListener('message', async ({ data }: MessageEvent<{ file: File; sampledPageObservations: PdfForensicPageObservation[] }>) => {
  try {
    const analysis = await new PdfForensicAnalyzerCore().analyzeDirect(
      data.file, null, undefined, data.sampledPageObservations,
    );
    postMessage({ analysis });
  } catch {
    postMessage({});
  }
});

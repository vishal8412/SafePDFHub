/// <reference lib="webworker" />
import { PDFDocument } from 'pdf-lib';

// One immutable source parse per worker; page copies are independent of it.
let source: Promise<PDFDocument> | undefined;
let queue = Promise.resolve();
addEventListener('message', ({ data }: MessageEvent<{ id: number; file: File; page: number }>) => {
  queue = queue.then(async () => {
    try {
      source ??= data.file.arrayBuffer().then(bytes => PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 10000 }));
      const original = await source;
      const output = await PDFDocument.create();
      const [page] = await output.copyPages(original, [data.page - 1]);
      output.addPage(page);
      const bytes = await output.save({ useObjectStreams: true, objectsPerTick: 10000 });
      postMessage({ id: data.id, bytes }, [bytes.buffer]);
    } catch (error) {
      postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Unable to prepare PDF page.' });
    }
  });
});

/// <reference lib="webworker" />
import { PdfDocumentFacts } from '../compression/pdf-document-facts';
import { optimizeNativeCandidates, NativeOptimizationOptions } from '../compression/pdf-native-optimization';
addEventListener('message', async ({ data }: MessageEvent<{ file: File; options: NativeOptimizationOptions }>) => {
  try {
    let facts: PdfDocumentFacts | undefined;
    const candidates = await optimizeNativeCandidates(new Uint8Array(await data.file.arrayBuffer()), data.options, value => { facts = value; });
    const buffers = candidates.map(bytes => new Uint8Array(bytes).buffer);
    postMessage({ buffers, facts }, buffers);
  } catch { postMessage({ buffers: [] }); }
});

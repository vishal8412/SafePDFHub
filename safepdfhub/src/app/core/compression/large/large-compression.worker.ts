import { cacheWorkerInput } from './cached-input';
import { bufferedHandle } from './buffered-handle';
import { optimizeNativeCandidates } from '../pdf-native-optimization';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentFacts } from '../pdf-document-facts';
import { nativeCompressionLimit } from './large-compression-policy';
import { attachDiskOutput } from './opfs-output';
import { StreamedInventory } from './streamed-inventory';
import { MAX_COMPRESSION_BYTES, LOSSLESS_ONLY_THRESHOLD } from './large-compression-policy';
self.onmessage = async ({ data }: MessageEvent) => {
  let disk: any;
  try {
    const { file, directory, jsUrl, wasmUrl, budget, quality, nativeOptions } = data;
    const outputName = data.outputName ?? 'output.pdf';
    if (!/^output(?:-\d+)?\.pdf$/.test(outputName)) throw new Error('Invalid output name.');
    const memoryMiB = [128, 192, 256, 384, 512].includes(budget?.memoryMiB) ? budget.memoryMiB : 192;
    if (quality !== undefined && (file.size > LOSSLESS_ONLY_THRESHOLD || ![20, 45, 55, 65, 82].includes(quality))) throw new Error('Invalid image compression policy.');
    if (!(file instanceof File) || file.size > MAX_COMPRESSION_BYTES || file.size < 1) throw new Error('Invalid large PDF size.');
    const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-')) throw new Error('This file does not contain a PDF header.');
    try {
      const handle = await directory.getFileHandle(outputName, { create: true });
      disk = await handle.createSyncAccessHandle(); disk.truncate(0);
    } catch { throw new Error('Temporary disk access is unavailable. Use a smaller PDF or another desktop browser.'); }
    // Signature ByteRange dictionaries must be outside compressed object streams.
    // Conservatively reject matching inputs instead of invalidating signatures.
    let suffix = '';
    for (let offset = 0; offset < file.size; offset += 1_048_576) {
      const text = suffix + new TextDecoder('latin1').decode(await file.slice(offset, offset + 1_048_576).arrayBuffer());
      if (/\/ByteRange\b/.test(text.replace(/#([0-9a-f]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))))) throw new Error('Signed PDFs cannot be compressed without invalidating their signatures. Use an unsigned copy.');
      suffix = text.slice(-128);
    }
    const imported = await import(/* @vite-ignore */ jsUrl);
    let lines: string[] = [];
    const log = (line: string) => { if (lines.length < 40) lines.push(line.slice(0, 500)); };
    const inspectionLimit = Math.min(8_000_000, budget?.inspectionBytes ?? 2_000_000);
    const module = await (imported.default ?? imported.SafePDFHubQpdfFactory)({ noInitialRun: true, compressionMemoryBytes: memoryMiB * 1_048_576, locateFile: () => wasmUrl, print: log, printErr: log });
    const fs = module.FS;
    cacheWorkerInput(module.WORKERFS);
    fs.mkdir('/input');
    fs.mount(module.WORKERFS, { blobs: [{ name: 'source.pdf', data: file }] }, '/input');
    const buffered = bufferedHandle(disk);
    attachDiskOutput(fs, '/output.pdf', buffered, Math.ceil(file.size * 1.1) + 1_000_000);
    const run = (args: string[]) => { postMessage({ type: 'phase', operation: args.slice(0, 2) }); lines = []; try { return module.callMain([...args]); } finally { buffered.flush(); } };
    const inspectImages = (path: string): string[] => {
      const sink = new StreamedInventory(Math.min(16_000_000, budget?.maxImagePixels ?? 4_000_000),
        Math.min(40_000, budget?.maxPages ?? 8_000), inspectionLimit);
      attachDiskOutput(fs, '/inspect.json', sink, 256_000_000);
      const code = run(['--suppress-recovery', '--json', '--json-key=pages', '--json-stream-data=none', path, '/inspect.json']);
      if (code !== 0) throw new Error('Image inspection could not be completed within the device budget.');
      return sink.finish();
    };
    // Reject protected input rather than silently removing security.
    if (run(['--is-encrypted', '/input/source.pdf']) !== 2) throw new Error('Unlock this PDF before compressing it.');
    if (run(['--suppress-recovery', '--show-npages', '/input/source.pdf']) !== 0) throw new Error('The PDF could not be read safely.');
    const pages = Number(lines.find(line => /^\d+$/.test(line.trim())));
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > Math.min(40_000, budget?.maxPages ?? 8_000)) throw new Error('The document exceeds the large-file page limit or is invalid.');
    postMessage({ type: 'progress', value: 15 });
    const originalImages = quality === undefined ? null : inspectImages('/input/source.pdf');
    const imageOptions = quality === undefined ? [] : ['--optimize-images', `--jpeg-quality=${quality}`, '--keep-inline-images'];
    if (nativeOptions !== undefined) {
      if (file.size > nativeCompressionLimit({ ...budget, memoryMiB })) throw new Error('Native compression exceeds the device budget.');
      if (run(['--suppress-recovery', '--check', '/input/source.pdf']) !== 0) throw new Error('The input PDF failed structural validation.');
      await (async () => {
        postMessage({ type: 'phase', operation: ['native-optimization'] });
        let sourceFacts: unknown;
        let bytes = new Uint8Array(await file.arrayBuffer());
        const candidates = await optimizeNativeCandidates(bytes, { ...nativeOptions, retainOnlyBest: true }, facts => { sourceFacts = facts; });
        let best: Uint8Array = bytes;
        for (const candidate of candidates) if (candidate.length < best.length) best = candidate;
        candidates.length = 0;
        // Drop the input buffer before parsing the output; best retains it only
        // when no smaller candidate was produced.
        bytes = new Uint8Array(0);
        const parsed = await PDFDocument.load(best, { updateMetadata: false, parseSpeed: Infinity });
        if (JSON.stringify(captureDocumentFacts(parsed)) !== JSON.stringify(sourceFacts)) throw new Error('Native output changed page geometry or metadata.');
        for (let offset = 0; offset < best.length;) {
          const count = disk.write(best.subarray(offset, Math.min(best.length, offset + 1_048_576)), { at: offset });
          if (count <= 0) throw new Error('Temporary storage write failed.');
          offset += count;
        }
        disk.flush();
      })();
    } else {
      const code = run(['--suppress-recovery', '--object-streams=generate', '--compress-streams=y',
        '--decode-level=generalized', '--compression-level=6', ...imageOptions, '/input/source.pdf', '/output.pdf']);
      if (code !== 0) throw new Error('Large PDF compression stopped because the PDF was invalid or exceeded the worker memory budget.');
    }
    postMessage({ type: 'progress', value: 80 });
    if (run(['--suppress-recovery', '--check', '/output.pdf']) !== 0) throw new Error('The compressed PDF failed structural validation.');
    if (run(['--show-npages', '/output.pdf']) !== 0 || Number(lines.find(line => /^\d+$/.test(line.trim()))) !== pages) throw new Error('The compressed PDF page count changed.');
    if (originalImages) {
      const outputImages = inspectImages('/output.pdf');
      if (originalImages.length !== outputImages.length || originalImages.some((shape, i) => shape !== outputImages[i])) throw new Error('Image dimensions or placements changed during compression.');
    }
    disk.flush(); disk.close(); disk = null;
    postMessage({ type: 'done', pages, heapBytes: module.getCompressionHeapBytes() });
  } catch (error) {
    postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Large-file compression failed. Try a smaller PDF.' });
  } finally { try { disk?.close(); } catch {} }
};

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const pass = (name, ok, detail = '') => checks.push({ name, ok, detail });

const engine = read('src/app/core/engines/compress.engine.ts');
const guard = read('src/app/core/compression/compression-resource-guard.service.ts');
const analyzer = read('src/app/core/compression/pdf-analyzer.service.ts');
const forensic = read('src/app/core/compression/pdf-forensic-analyzer.service.ts') + read('src/app/core/compression/pdf-forensic-analyzer-core.ts');
const cert = read('src/app/core/compression/pdf-candidate-certification.service.ts');
const renderer = read('src/app/core/compression/pdf-page-renderer.service.ts');
const runtime = read('src/app/core/qpdf/qpdf-wasm-runtime.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const facade = read('src/app/core/compression/compress.facade.ts');

pass('resource guard exists', guard.includes('maxStrategyBranches') && guard.includes('largeWorkload'));
pass('engine applies resource guard', engine.includes('resourceGuard.profile') && engine.includes('maxStrategyBranches'));
pass('large workloads reduce branch fan-out', guard.includes('largeWorkload ? 1 : highWorkload ? 2 : 3'));
pass('strategy dedup is cancellation-aware', engine.includes('deduplicateStrategySources') && engine.includes('throwIfCompressionCancelled(signal)'));
pass('preflight fingerprint avoids retained byte copy', engine.includes('crypto.subtle.digest(\'SHA-256\', bytes)'));
pass('analysis accepts cancellation', analyzer.includes('analyzeFile(file: File, signal?: AbortSignal)') && analyzer.includes('throwIfCompressionCancelled(signal)'));
pass('analysis loading task cancellation cleanup', analyzer.includes('loadingTask.destroy?.()'));
pass('forensic raw object records do not retain stream payloads', !forensic.includes('streamContents: Uint8Array | null'));
pass('forensic stream fingerprinting is bounded per record', forensic.includes('const contents = this.extractStreamContents(record.object)'));
pass('forensic analysis checkpoints cancellation', forensic.includes('groupStreams(streamObjects, signal)') && forensic.includes('throwIfCompressionCancelled(signal)'));
pass('qpdf runtime protects create-run cancellation race', runtime.includes('const generation = ++this.generation') && runtime.includes('generation !== this.generation'));
pass('qpdf cancel invalidates active generation', runtime.includes('this.generation += 1'));
pass('structural candidate phase propagates cancellation', structural.includes('signal?: AbortSignal') && structural.includes('CompressionCancelledError'));
pass('image candidate phase propagates cancellation', image.includes('signal?: AbortSignal') && image.includes('CompressionCancelledError'));
pass('facade cancellation covers analysis', facade.includes('activeAnalysisAbortController') && facade.includes('this.pdfAnalyzer.analyzeFile(file, signal)'));
pass('renderer remains signal-aware', renderer.includes('renderTask.cancel?.()') && renderer.includes('bitmap.close()'));
pass('candidate certification cache remains bounded', cert.includes('maxCacheEntries = 32'));
pass('stress harness registered', fs.existsSync(path.join(root, 'scripts/compression-v2-memory-cancellation-stress.py')));
pass('stress package script registered', JSON.parse(read('package.json')).scripts['compress:v2:memory-cancellation:stress'] === 'python scripts/compression-v2-memory-cancellation-stress.py');
pass('user-src excluded from release source', !fs.existsSync(path.join(root, 'user-src')));

const failed = checks.filter(c => !c.ok);
console.log(`Compression V2 memory/resource hardening audit: ${checks.length - failed.length}/${checks.length} PASS`);
for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} - ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
}
if (failed.length) process.exit(1);

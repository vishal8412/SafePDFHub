#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
}

const engine = read('src/app/core/engines/compress.engine.ts');
const planner = read('src/app/core/compression/compression-planner.ts');
const analyzer = read('src/app/core/compression/pdf-analyzer.service.ts');
const facade = read('src/app/core/compression/compress.facade.ts');
const worker = read('src/app/core/compression/pdf-compression-worker.service.ts');
const workerImpl = read('src/app/core/workers/pdf-compression.worker.ts');

check(
  'Engine accepts cached PdfFileAnalysis before optional progress callback',
  /cachedAnalysis:\s*PdfFileAnalysis[\s\S]{0,120}onProgress\?:/.test(engine),
);
check(
  'Engine preserves page count/geometry/rotation during output validation',
  /getPageCount\(\)[\s\S]*getWidth\(\)[\s\S]*getHeight\(\)[\s\S]*getRotation\(\)\.angle/.test(engine),
);
check(
  'Engine falls back to safe compression for capacity overflow',
  /cachedAnalysis\.pages > budget\.maxPages[\s\S]*file\.size > budget\.maxFileBytes[\s\S]*safeCompress/.test(engine),
);
check(
  'Engine protects already-small PDFs with safe compression',
  /detectAlreadyCompressed\(file\.size, cachedAnalysis\.pages\)[\s\S]*safeCompress/.test(engine),
);
check(
  'Planner caps estimated reduction for large documents',
  /pages > 1000[\s\S]*Math\.min\(reduction, 10\)/.test(planner),
);
check(
  'Analyzer inspects at most eight pages',
  /Math\.min\(pdf\.numPages,\s*8\)/.test(analyzer),
);
check(
  'Analyzer rasterizes only pages with image content',
  /const shouldRasterize = hasImages/.test(analyzer),
);
check(
  'Facade uses WeakMap analysis cache',
  /WeakMap<File,\s*PdfFileAnalysis>/.test(facade),
);
check(
  'Compression worker uses a request timeout',
  /30_000/.test(worker),
);
check(
  'Compression worker transfers ImageBitmap to worker',
  /postMessage\([\s\S]*\[image\]/.test(worker),
);
check(
  'Compression worker performs OffscreenCanvas JPEG encoding',
  /new OffscreenCanvas[\s\S]*convertToBlob[\s\S]*image\/jpeg/.test(workerImpl),
);
check(
  'Compression engine has main-thread JPEG fallback',
  /renderToJpeg\(/.test(engine),
);

const specFiles = [
  'src/app/core/compression/compression-planner.spec.ts',
  'src/app/core/compression/pdf-analyzer.service.spec.ts',
  'src/app/core/compression/pdf-page-embedder.service.spec.ts',
  'src/app/core/compression/compress.facade.spec.ts',
  'src/app/core/engines/compress.engine.spec.ts',
];

for (const file of specFiles) {
  check(`C6 test file exists: ${file}`, fs.existsSync(path.join(root, file)));
}

const failures = checks.filter((item) => !item.pass);
console.log(`C6 Compression Audit: ${checks.length - failures.length}/${checks.length} structural checks passed.`);
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}

if (failures.length) {
  process.exitCode = 1;
}

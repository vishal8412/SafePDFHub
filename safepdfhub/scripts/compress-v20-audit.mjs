#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
}

const models = read('src/app/core/compression/compression.models.ts');
const state = read('src/app/core/compression/compression.state.ts');
const facade = read('src/app/core/compression/compress.facade.ts');
const engine = read('src/app/core/engines/compress.engine.ts');
const analyzer = read('src/app/core/compression/pdf-analyzer.service.ts');
const qpdf = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');

check(
  'CompressionResult contains authoritative byte-level result fields',
  /originalSize:\s*number[\s\S]*finalSize:\s*number[\s\S]*reductionBytes:\s*number[\s\S]*reduction:\s*number/.test(models),
);
check(
  'CompressionResult records the selected strategy and original-file fallback',
  /strategy:\s*'safe' \| 'smart' \| 'strong'[\s\S]*returnedOriginal:\s*boolean/.test(models),
);
check(
  'CompressionState keeps planner estimates separate from actual results',
  /estimatedReduction = 0[\s\S]*estimatedFinalSize = 0[\s\S]*reductionBytes = 0[\s\S]*compressionResult:\s*CompressionResult \| null/.test(state),
);
check(
  'Facade creates the authoritative execution result from actual File.size',
  /finalSize:\s*compressed\.size[\s\S]*reductionBytes[\s\S]*pagesTotal:\s*result\.pages/.test(facade),
);
check(
  'Facade does not overwrite estimate fields after compression',
  /Keep estimatedFinalSize\/estimatedReduction untouched/.test(facade) && !/estimatedFinalSize = compressed\.size/.test(facade),
);
check(
  'Analyzer uses the loaded operator list during whole-document analysis',
  /const \[text, operatorList\] = await Promise\.all/.test(analyzer),
);
check(
  'Raster finalization receives an explicit progress callback',
  /finalizeAndValidate\([\s\S]*onProgress\?/.test(engine),
);
check(
  'qpdf JPEG quality is derived from the selected compression level',
  /getQpdfJpegQuality\(level\)[\s\S]*optimizeForCompression\(file, jpegQuality/.test(engine),
);
check(
  'Compression engine no longer hardcodes qpdf quality 72',
  !/optimizeForCompression\(file, 72/.test(engine),
);
check(
  'Existing qpdf service still exposes configurable JPEG quality',
  /optimizeForCompression\([\s\S]*jpegQuality = 72/.test(qpdf),
);
check(
  'Facade regression spec covers estimate/result separation',
  fs.existsSync(path.join(root, 'src/app/core/compression/compress.facade.spec.ts')) &&
    /keeps planner estimates separate/.test(read('src/app/core/compression/compress.facade.spec.ts')),
);
check(
  'Analyzer regression spec covers whole-document operator-list usage',
  /uses the loaded operator list/.test(read('src/app/core/compression/pdf-analyzer.service.spec.ts')),
);
check(
  'Engine regression spec covers qpdf quality propagation',
  /selected compression level to control qpdf JPEG quality/.test(read('src/app/core/engines/compress.engine.spec.ts')),
);

const failures = checks.filter((item) => !item.pass);
console.log(`Compress V2.0 Audit: ${checks.length - failures.length}/${checks.length} structural checks passed.`);
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}

if (failures.length) process.exitCode = 1;

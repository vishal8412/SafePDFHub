import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const engine = read('src/app/core/engines/compress.engine.ts');
const inspect = read('scripts/compression-v2-qpdf-runtime-inspect.mjs');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['guard accepts explicit page count', guard.includes('pages = 0')],
  ['15 MB / 842-page rule remains high-risk', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.fileBytes') && guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.pages')],
  ['structural optimizer accepts authoritative page count', structural.includes('pageCount = forensic?.pageCount ?? 0')],
  ['engine passes Pdf.js page count to structural optimizer', engine.includes('cachedAnalysis.pages,')],
  ['image optimizer accepts authoritative page count', image.includes('pageCount = forensic?.pageCount ?? 0')],
  ['engine carries page count into image branch', engine.includes('pageCount: cachedAnalysis.pages') && engine.includes('imageSource.pageCount')],
  ['high-risk disables image optimization', guard.includes('allowImageOptimization: false')],
  ['qpdf runtime inspector exists', fs.existsSync(path.join(root, 'scripts/compression-v2-qpdf-runtime-inspect.mjs'))],
  ['runtime inspector parses WASM memory section', inspect.includes('sectionId === 5') && inspect.includes('maximumPages')],
  ['runtime inspector reports WASM SHA-256', inspect.includes('wasmSha256') && inspect.includes('sha256(')],
  ['runtime inspector distinguishes static inspection from peak memory', inspect.includes('does not measure peak worker WASM memory')],
  ['inspection npm script registered', pkg.scripts['compress:v2:qpdf-runtime:inspect'] === 'node scripts/compression-v2-qpdf-runtime-inspect.mjs'],
  ['R1/R2/R3 audit script registered', pkg.scripts['compress:v2:qpdf-runtime:r123:audit'] === 'node scripts/compression-v2-qpdf-runtime-r123-audit.mjs'],
  ['no user-src in release tree', !fs.existsSync(path.join(root, 'user-src'))],
];

const passed = checks.filter(([, ok]) => ok).length;
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
console.log(`QPDF R1/R2/R3 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

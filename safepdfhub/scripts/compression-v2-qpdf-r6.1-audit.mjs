import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const pass = (name, ok, detail = '') => checks.push({ name, ok, detail });

const engine = read('src/app/core/engines/compress.engine.ts');
const spec = read('src/app/core/engines/compress.engine.spec.ts');
const qpdfGuard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const pkg = JSON.parse(read('package.json'));

pass(
  'R6.1 derives the qpdf resource profile before legacy strategy execution',
  /const qpdfResourceProfile = this\.qpdfResourceGuard\.profile\(/.test(engine),
);
pass(
  'R6.1 gates the expensive legacy strategy on high-risk qpdf output disablement',
  /const skipExpensiveLegacyStrategy =\s*qpdfResourceProfile\.risk === 'high' && !qpdfResourceProfile\.allowPdfOutput/.test(engine) && /useUnknownSafeFallback/.test(engine),
);
pass(
  'R6.1 records an explicit skipped-strategy telemetry label',
  /skipped\/\$\{qpdfResourceProfile\.risk\}-qpdf-output-disabled/.test(engine),
);
pass(
  'R6.1 avoids building strategy sources when the gate is active',
  /const strategySources = skipExpensiveLegacyStrategy\s*\?\s*\[\]\s*:\s*useUnknownSafeFallback/.test(engine) && /deduplicateStrategySources/.test(engine),
);
pass(
  'R6.1 preserves the final certification gate',
  /await this\.candidateCertification\.certifySmallest\(/.test(engine),
);
pass(
  'high-risk qpdf profile disables PDF output',
  /risk: 'high'[\s\S]{0,700}allowPdfOutput: false/.test(qpdfGuard),
);
pass(
  'structural qpdf execution remains independently gated',
  /if \(!resourceProfile\.allowPdfOutput\)/.test(structural),
);
pass(
  'image qpdf optimization remains independently gated',
  /qpdfProfile\.allowImageOptimization/.test(image),
);
pass(
  'R6.1 regression test covers high-risk strategy skip',
  /skips the expensive legacy strategy for a high-risk qpdf-output-disabled workload/.test(spec),
);
pass(
  'R6.1 regression test verifies smart strategy is not invoked',
  /expect\(smart\)\.not\.toHaveBeenCalled\(\)/.test(spec),
);
pass(
  'R6.1 package audit script is registered',
  pkg.scripts?.['compress:v2:qpdf:r6.1:audit'] === 'node scripts/compression-v2-qpdf-r6.1-audit.mjs',
);
pass(
  'user-src is absent from the release tree',
  !fs.existsSync(path.join(root, 'user-src')),
);

const failed = checks.filter(x => !x.ok);
for (const [i, check] of checks.entries()) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${i + 1}. ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}
console.log(`\nQPDF R6.1 audit: ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);

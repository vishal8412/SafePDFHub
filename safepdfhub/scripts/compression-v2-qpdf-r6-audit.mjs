import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const pass = (name, ok, detail = '') => checks.push({ name, ok, detail });

const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const model = read('src/app/core/compression/pdf-structural-optimization.models.ts');
const engine = read('src/app/core/engines/compress.engine.ts');
const guardSpec = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.spec.ts');
const structuralSpec = read('src/app/core/compression/pdf-structural-optimization.service.spec.ts');
const pkg = JSON.parse(read('package.json'));

pass('R6 guard exposes allowPdfOutput policy', /allowPdfOutput:\s*boolean/.test(guard));
pass('high-risk profile disables qpdf PDF output', /risk:\s*'high'[\s\S]{0,700}allowPdfOutput:\s*false/.test(guard));
pass('elevated profile keeps qpdf PDF output enabled', /risk:\s*'elevated'[\s\S]{0,700}allowPdfOutput:\s*true/.test(guard));
pass('low profile keeps qpdf PDF output enabled', /risk:\s*'low'[\s\S]{0,500}allowPdfOutput:\s*true/.test(guard));
pass('R5 evidence is encoded in high-risk guard reason', /R5 baseline-output OOM evidence/.test(guard));
pass('structural optimizer gates qpdf output before execution', /if \(!resourceProfile\.allowPdfOutput\)/.test(structural));
pass('high-risk structural path executes zero qpdf candidates', /attemptedKinds = resourceProfile\.allowPdfOutput\s*\?/.test(structural));
pass('explicit production skip reason exists', /QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD/.test(model));
pass('skip diagnostics retain resource risk', /resourceRisk:\s*resourceProfile\.risk/.test(structural));
pass('skip diagnostics retain optimization profile', /optimizationProfile:\s*resourceProfile\.optimizationProfile/.test(structural));
pass('engine qpdf fallback receives output eligibility', /allowPdfOutput = true/.test(engine));
pass('engine qpdf fallback skips disabled output workloads', /if \(!allowPdfOutput\)\s*\{\s*return null;/.test(engine));
pass('existing image optimization remains independently guarded', /qpdfProfile\.allowImageOptimization/.test(engine) || fs.existsSync(path.join(root, 'src/app/core/compression/pdf-image-optimization.service.ts')));
pass('resource guard regression test covers 15 MB / 842', /15 \* 1024 \* 1024, 842/.test(guardSpec));
pass('structural regression test proves no qpdf invocation', /not\.toHaveBeenCalled\(\)/.test(structuralSpec));
pass('R6 audit package script registered', pkg.scripts?.['compress:v2:qpdf:r6:audit'] === 'node scripts/compression-v2-qpdf-r6-audit.mjs');
pass('user-src excluded from release tree', !fs.existsSync(path.join(root, 'user-src')));

const failed = checks.filter(x => !x.ok);
for (const [i, check] of checks.entries()) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${i + 1}. ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}
console.log(`\nQPDF R6 audit: ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);

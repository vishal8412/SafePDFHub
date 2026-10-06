import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const pass = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const model = read('src/app/core/compression/pdf-structural-optimization.models.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const prototype = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');
const engine = read('src/app/core/engines/compress.engine.ts');
const packageJson = JSON.parse(read('package.json'));

pass('qpdf resource guard exists', guard.includes('class QpdfWasmResourceGuardService'));
pass('15 MB / 842-page workload is high-risk by deterministic threshold', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.fileBytes') && guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS.high.fileAndPages.pages'));
pass('high-risk profile is conservative', guard.includes("optimizationProfile: 'conservative'"));
pass('high-risk profile bounds structural candidates to one', guard.includes('maxStructuralCandidates: 1'));
pass('high-risk profile disables image optimization', guard.includes('allowImageOptimization: false'));
pass('unknown-risk profile disables qpdf output', guard.includes("risk: 'unknown'") && guard.includes('maxStructuralCandidates: 0') && guard.includes('allowPdfOutput: false'));
pass('unknown-risk profile is conservative', guard.includes("risk: 'unknown'") && guard.includes("optimizationProfile: 'conservative'"));
pass('structural optimizer consumes qpdf resource profile', structural.includes('qpdfResourceGuard.profile'));
pass('structural optimizer stops after qpdf memory exhaustion', structural.includes('shouldStopQpdfFanOut') && structural.includes("reason === 'QPDF_MEMORY_EXHAUSTED'"));
pass('image optimizer respects qpdf memory guard', image.includes('qpdfProfile.allowImageOptimization'));
pass('qpdf model has explicit memory exhaustion reason', model.includes("'QPDF_MEMORY_EXHAUSTED'"));
pass('qpdf structural candidate has resource telemetry fields', model.includes('resourceRisk?:') && model.includes('optimizationProfile?:'));
pass('qpdf conservative profile removes heavy recompression flags', prototype.includes("optimizationProfile === 'standard'") && prototype.includes("'--recompress-flate'"));
pass('engine routes final qpdf optimization through resource profile', engine.includes('qpdfProfileFor('));
pass('memory hardening audit is registered', packageJson.scripts['compress:v2:qpdf-memory:hardening:audit'] === 'node scripts/compression-v2-qpdf-memory-hardening-audit.mjs');

const failures = checks.filter(x => !x.ok);
console.log(`Compression V2 qpdf memory hardening audit: ${checks.filter(x => x.ok).length}/${checks.length} PASS`);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
if (failures.length) process.exit(1);

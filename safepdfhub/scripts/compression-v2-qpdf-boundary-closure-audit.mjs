import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];
const pass = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const runtimeInvestigation = read('src/app/core/qpdf/qpdf-runtime-investigation.service.ts');
const runtimeComponent = read('src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.html');
const prototype = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const prototypeSpec = read('src/app/core/qpdf/qpdf-wasm-prototype.service.spec.ts');
const guardSpec = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.spec.ts');
const pkg = JSON.parse(read('package.json'));

pass('boundary closure audit is registered', pkg.scripts['compress:v2:qpdf:boundary:closure:audit'] === 'node scripts/compression-v2-qpdf-boundary-closure-audit.mjs');
pass('R5 investigation schema is v4', runtimeInvestigation.includes('schemaVersion: 4'));
pass('R5 reports source SHA-256', runtimeInvestigation.includes('sourceSha256'));
pass('R5 caches exact-PDF boundary evidence', runtimeInvestigation.includes('reportCache') && runtimeInvestigation.includes('No qpdf OOM probe was repeated'));
pass('R5 supports explicit fresh rerun', runtimeInvestigation.includes('forceRerun') && runtimeComponent.includes('Run fresh probe'));
pass('R5 classifies OOM explicitly', runtimeInvestigation.includes('QPDF_MEMORY_EXHAUSTED') && runtimeInvestigation.includes('STOP_QPDF_OUTPUT_FOR_WORKLOAD'));
pass('R5 does not mislabel skipped probes as failures', runtimeInvestigation.includes('Intentionally skipped after'));
pass('production qpdf OOM circuit breaker exists', prototype.includes('outputOomBlockedFiles') && prototype.includes('throwIfOutputOomBlocked'));
pass('structural qpdf OOM is converted into a hard memory diagnostic', prototype.includes("reason === 'QPDF_MEMORY_EXHAUSTED'") && prototype.includes('this.outputOomBlockedFiles.add(file)'));
pass('partial forensic evidence is conservative', guard.includes("evidenceQuality: QpdfWasmResourceEvidenceQuality") && guard.includes("evidenceQuality === 'complete' ? 'standard' : 'conservative'"));
pass('unknown forensic signals are explicit', guard.includes("unknownSignals") && guard.includes("streamBytes', 'imageBytes', 'objectCount"));
pass('partial forensic signals are not marked measured', structural.includes("forensic && !forensic.partial ? this.signalStatus(resourceSignals.streamBytes) : 'unavailable'"));
pass('OOM circuit breaker regression test exists', prototypeSpec.includes('blocks repeated PDF-output attempts after an observed OOM'));
pass('partial forensic regression test exists', guardSpec.includes('does not treat partial forensic zeros as measured resource evidence'));
pass('production thresholds remain centralized', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
pass('high-risk PDF output remains disabled', guard.includes("allowPdfOutput: false"));

const failures = checks.filter(c => !c.ok);
console.log(`QPDF boundary closure audit: ${checks.length - failures.length}/${checks.length} PASS`);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
if (failures.length) process.exit(1);

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];
const pass = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const prototype = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');
const prototypeSpec = read('src/app/core/qpdf/qpdf-wasm-prototype.service.spec.ts');
const investigation = read('src/app/core/qpdf/qpdf-runtime-investigation.service.ts');
const component = read('src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.html');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const pkg = JSON.parse(read('package.json'));

pass('R7.4.2 validation audit is registered', pkg.scripts['compress:v2:qpdf:r7.4.2:audit'] === 'node scripts/compression-v2-qpdf-r7.4.2-validation-audit.mjs');
pass('R7.4.1 literal-schema compile fix is present', investigation.includes('const report: QpdfRuntimeInvestigationReport = {') && !investigation.includes('return report;;'));
pass('R5 report schema remains v4', investigation.includes('schemaVersion: 4;') && investigation.includes('schemaVersion: 4,'));
pass('R5 exact-PDF SHA-256 cache remains enabled', investigation.includes('sourceSha256') && investigation.includes('reportCache.get(sourceSha256)'));
pass('R5 cache hit bypasses output probes', investigation.includes('No qpdf OOM probe was repeated') && investigation.includes('return { ...cached, cacheHit: true }'));
pass('R5 explicit fresh rerun remains available', investigation.includes('forceRerun') && component.includes('Run fresh probe'));
pass('R5 stops later probes after first output boundary', investigation.includes('skippedResult') && investigation.includes('operations.push(...skipped)'));
pass('R5 OOM has explicit stop diagnostic', investigation.includes('QPDF_MEMORY_EXHAUSTED') && investigation.includes('STOP_QPDF_OUTPUT_FOR_WORKLOAD'));
pass('R5 skipped probes are not mislabeled as failures', investigation.includes('Intentionally skipped after') && investigation.includes("status: 'skipped'"));
pass('compression qpdf path checks OOM circuit breaker', prototype.includes('async optimizeForCompression') && prototype.slice(prototype.indexOf('async optimizeForCompression'), prototype.indexOf('async optimizeStructuralCandidate')).includes('this.throwIfOutputOomBlocked(file)'));
pass('generic optimize qpdf path checks OOM circuit breaker', prototype.includes('async optimize(') && prototype.slice(prototype.indexOf('async optimize('), prototype.indexOf('async optimizeStructuralCandidate')).includes('this.throwIfOutputOomBlocked(file)'));
pass('structural qpdf path checks OOM circuit breaker', prototype.includes('async optimizeStructuralCandidate') && prototype.slice(prototype.indexOf('async optimizeStructuralCandidate'), prototype.indexOf('async optimizeImageCandidate')).includes('this.throwIfOutputOomBlocked(file)'));
pass('image qpdf path checks OOM circuit breaker', prototype.includes('async optimizeImageCandidate') && prototype.slice(prototype.indexOf('async optimizeImageCandidate'), prototype.indexOf('private throwIfOutputOomBlocked')).includes('this.throwIfOutputOomBlocked(file)'));
pass('generic optimize records OOM from runtime errors', prototype.includes('async optimize(') && prototype.slice(prototype.indexOf('async optimize('), prototype.indexOf('async optimizeStructuralCandidate')).includes('this.outputOomBlockedFiles.add(file)'));
pass('generic optimize records OOM from non-throwing qpdf results', prototype.includes('if (this.isMemoryExhaustion(result)) {\n      this.outputOomBlockedFiles.add(file);'));
pass('structural OOM is recorded', prototype.includes("reason === 'QPDF_MEMORY_EXHAUSTED'") && prototype.includes('this.outputOomBlockedFiles.add(file)'));
pass('image OOM is recorded', prototype.slice(prototype.indexOf('async optimizeImageCandidate'), prototype.indexOf('private throwIfOutputOomBlocked')).includes('this.outputOomBlockedFiles.add(file)'));
pass('circuit breaker is fail-closed with structured reason', prototype.includes('throwIfOutputOomBlocked(file)') && prototype.includes("'QPDF_MEMORY_EXHAUSTED'"));
pass('circuit breaker remains scoped to exact File identity', prototype.includes('WeakSet<File>') && prototype.includes('outputOomBlockedFiles.has(file)'));
pass('merge remains explicitly separate from compression-output circuit breaker', prototype.includes('async merge(') && prototype.slice(prototype.indexOf('async merge('), prototype.indexOf('async overlay(')).includes('this.throwIfCancelled()'));
pass('partial forensic evidence remains conservative', guard.includes("evidenceQuality === 'complete' ? 'standard' : 'conservative'") && guard.includes('maxStructuralCandidates'));
pass('unknown forensic signals remain explicit', guard.includes('unknownSignals') && guard.includes("'streamBytes', 'imageBytes', 'objectCount'"));
pass('partial forensic telemetry is not marked measured', structural.includes("forensic && !forensic.partial ? this.signalStatus(resourceSignals.streamBytes) : 'unavailable'"));
pass('production thresholds remain unchanged and centralized', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS') && guard.includes('12 * 1024 * 1024') && guard.includes('25 * 1024 * 1024') && guard.includes('1_500'));
pass('high-risk PDF output remains disabled', guard.includes("allowPdfOutput: false"));
pass('prototype OOM regression covers repeated compression attempt', prototypeSpec.includes('blocks repeated PDF-output attempts after an observed OOM'));
pass('prototype OOM regression covers generic optimize path', prototypeSpec.includes('blocks the generic optimize output path after an observed OOM'));
pass('prototype regression verifies different File identity is not globally blocked', prototypeSpec.includes('keeps the generic optimize path available for a different File object'));

const failures = checks.filter(c => !c.ok);
console.log(`QPDF R7.4.2 validation audit: ${checks.length - failures.length}/${checks.length} PASS`);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
if (failures.length) process.exit(1);

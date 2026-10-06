import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checks = [];
const pass = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const engine = read('src/app/core/engines/compress.engine.ts');
const qpdf = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');
const models = read('src/app/core/compression/pdf-structural-optimization.models.ts');
const packageJson = JSON.parse(read('package.json'));

pass('guard:unknown-risk-state', guard.includes("export type QpdfWasmResourceRisk = 'low' | 'elevated' | 'high' | 'unknown';"));
pass('guard:incomplete-evidence-disables-qpdf', guard.includes("risk: 'unknown'") && guard.includes('allowPdfOutput: false') && guard.includes('maxStructuralCandidates: 0'));
pass('guard:thresholds-unchanged',
  guard.includes('fileBytes: 12 * 1024 * 1024') &&
  guard.includes('pages: 1_500') &&
  guard.includes('fileBytes: 25 * 1024 * 1024') &&
  guard.includes('streamBytes: 64 * 1024 * 1024') &&
  guard.includes('imageBytes: 32 * 1024 * 1024') &&
  guard.includes('objectCount: 20_000') &&
  guard.includes('fileBytes: 8 * 1024 * 1024') &&
  guard.includes('pages: 1_000') &&
  guard.includes('fileBytes: 12 * 1024 * 1024') &&
  guard.includes('streamBytes: 32 * 1024 * 1024') &&
  guard.includes('imageBytes: 16 * 1024 * 1024') &&
  guard.includes('objectCount: 10_000'));
pass('structural:guard-blocked-before-qpdf', structural.includes("if (!resourceProfile.allowPdfOutput)") && structural.includes("QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"));
pass('structural:runtime-failure-stops-fanout', structural.includes('shouldStopQpdfFanOut') && structural.includes('QPDF_RUN_FAILED') && structural.includes('QPDF_RUNNER_CREATE_FAILED'));
pass('image:runtime-failure-stops-quality-ladder', image.includes('QpdfStructuralCandidateError') && image.includes('break;') && image.includes('QPDF_MEMORY_EXHAUSTED'));
pass('qpdf:image-runtime-errors-typed', qpdf.includes("'image-resource'") && qpdf.includes("'QPDF_RUN_FAILED'") && qpdf.includes("'QPDF_EXECUTION_FAILED'"));
pass('engine:high-and-unknown-qpdf-disabled-fallback', engine.includes("qpdfResourceProfile.risk === 'high' && !qpdfResourceProfile.allowPdfOutput") && engine.includes("qpdfResourceProfile.risk === 'unknown' && !qpdfResourceProfile.allowPdfOutput") && engine.includes('safe/unknown-qpdf-disabled'));
pass('models:unknown-resource-risk-telemetry', models.includes("resourceRisk?: 'low' | 'elevated' | 'high' | 'unknown';"));
pass('package:audit-script-registered', packageJson.scripts?.['compress:v2:production-reliability:audit'] === 'node scripts/compression-v2-production-reliability-hardening-audit.mjs');

const failures = checks.filter((check) => !check.ok);
console.log(`Production reliability hardening audit: ${checks.length - failures.length}/${checks.length} PASS`);
process.exitCode = failures.length ? 1 : 0;

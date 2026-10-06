import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const failures = [];
const checks = [];

function check(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const engine = read('src/app/core/engines/compress.engine.ts');
const spec = read('src/app/core/engines/compress.engine.spec.ts');
const telemetry = read('src/app/core/compression/compression-telemetry.models.ts');
const finalIntegrity = read('src/app/core/compression/pdf-final-integrity.service.ts');
const packageJson = JSON.parse(read('package.json'));
const forensic = read('scripts/compression-v2-qpdf-r7.5.2-metadata-forensics.py');

check('r7.5.2 engine imports PDFObjectCopier', engine.includes('PDFObjectCopier'));
check('r7.5.2 raster output disables pdf-lib metadata auto-update', engine.includes('PDFDocument.create({ updateMetadata: false })'));
check('r7.5.2 copies source Info dictionary through PDFObjectCopier', engine.includes('PDFObjectCopier.for(source.context, target.context).copy(sourceInfo)'));
check('r7.5.2 binds copied Info dictionary to target trailer', engine.includes('target.context.trailerInfo.Info = target.context.register(infoCopy)'));
check('legacy keyword normalization path removed', !engine.includes('value.split(\',\').map((item) => item.trim())'));
check('final certification remains exact metadata gate', finalIntegrity.includes('sourcePdf.getKeywords() === candidatePdf.getKeywords()'));
check('final certification still rejects metadata mismatch', finalIntegrity.includes('Candidate document metadata differs from the source.'));
check('regression test covers exact keyword preservation', spec.includes("expect(target.getKeywords()).toBe(source.getKeywords())"));
check('regression test covers absent metadata defaults', spec.includes('expect(target.getProducer()).toBeUndefined()'));
check('forensic helper exists', fs.existsSync(path.join(ROOT, 'scripts/compression-v2-qpdf-r7.5.2-metadata-forensics.py')));
check('forensic helper uses privacy-safe hashes by default', forensic.includes('sha256'));
check('forensic helper has explicit opt-in value display', forensic.includes('--show-values'));
check('no qpdf threshold mutation in engine', !engine.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
check('no qpdf threshold mutation in telemetry model', !telemetry.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
check('r7.5.2 package audit script registered', packageJson.scripts?.['compress:v2:production-reliability:r7.5.2:audit'] === 'node scripts/compression-v2-production-reliability-r7.5.2-metadata-audit.mjs');

console.log(`[R7.5.2] Metadata certification investigation audit: ${checks.filter(c => c.passed).length}/${checks.length} PASS`);
for (const checkResult of checks) {
  console.log(`${checkResult.passed ? 'PASS' : 'FAIL'} ${checkResult.name}${checkResult.detail ? ` — ${checkResult.detail}` : ''}`);
}
if (failures.length) {
  console.error('\nFailures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

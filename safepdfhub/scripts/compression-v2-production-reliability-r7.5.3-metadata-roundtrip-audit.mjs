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

const prepareIndex = engine.indexOf('private async prepareCandidatesForCertification');
const prepareCalls = [...engine.matchAll(/prepareCandidatesForCertification\(/g)].map(match => match.index ?? -1).filter(index => index >= 0);
const certifyCalls = [...engine.matchAll(/this\.candidateCertification\.certifySmallest\(/g)].map(match => match.index ?? -1).filter(index => index >= 0);
const preserveIndex = engine.indexOf('private async preserveSourceMetadataOnCandidate');
const copyIndex = engine.indexOf('private copyDocumentMetadata');

check('r7.5.3 unified candidate metadata preparation exists', prepareIndex >= 0);
check('r7.5.3 preparation occurs before final certification', prepareCalls.some(prepare => certifyCalls.some(certify => prepare < certify)));
check('r7.5.3 preserves metadata on serialized candidate', preserveIndex >= 0 && engine.slice(preserveIndex, copyIndex).includes('targetPdf.save('));
check('r7.5.3 reloads candidate before metadata rebinding', preserveIndex >= 0 && engine.slice(preserveIndex, copyIndex).includes('PDFDocument.load(candidateBytes'));
check('r7.5.3 disables pdf-lib metadata auto-update during candidate reload', preserveIndex >= 0 && engine.slice(preserveIndex, copyIndex).includes('updateMetadata: false'));
check('r7.5.3 uses source Info object copier', engine.includes('PDFObjectCopier.for(source.context, target.context).copy(sourceInfo)'));
check('r7.5.3 preserves absence of source Info dictionary', engine.includes('delete targetTrailerInfo.Info'));
check('r7.5.3 covers structural candidates before certification', engine.includes('[structuralCandidate, imageCandidate, ...strategyCandidates]'));
check('r7.5.3 covers image candidates before certification', engine.includes('imageCandidate'));
check('r7.5.3 covers strategy candidates before certification', engine.includes('strategyCandidates'));
check('r7.5.3 covers already-compressed fast path', engine.includes('normalizedFastPath') && engine.includes('prepareCandidatesForCertification('));
check('r7.5.3 serialized round-trip regression exists', spec.includes('preserves metadata across the serialized candidate round trip'));
check('r7.5.3 absent-Info regression exists', spec.includes('removes candidate metadata when the source has no Info dictionary'));
check('final certification metadata gate remains strict', finalIntegrity.includes('sourcePdf.getKeywords() === candidatePdf.getKeywords()') && finalIntegrity.includes('Candidate document metadata differs from the source.'));
check('no qpdf threshold mutation', !engine.includes('QPDF_WASM_RESOURCE_THRESHOLDS') && !telemetry.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
check('r7.5.3 package audit script registered', packageJson.scripts?.['compress:v2:production-reliability:r7.5.3:audit'] === 'node scripts/compression-v2-production-reliability-r7.5.3-metadata-roundtrip-audit.mjs');
check('r7.5.2 audit remains registered', packageJson.scripts?.['compress:v2:production-reliability:r7.5.2:audit'] === 'node scripts/compression-v2-production-reliability-r7.5.2-metadata-audit.mjs');

console.log(`[R7.5.3] Unified candidate metadata round-trip audit: ${checks.filter(c => c.passed).length}/${checks.length} PASS`);
for (const result of checks) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
if (failures.length) {
  console.error('\nFailures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

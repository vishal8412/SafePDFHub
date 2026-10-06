import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.ts');
const models = path.join(root, 'src/app/core/compression/pdf-candidate-certification.models.ts');
const spec = path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.spec.ts');
const engine = path.join(root, 'src/app/core/engines/compress.engine.ts');
const engineSpec = path.join(root, 'src/app/core/engines/compress.engine.spec.ts');
const pkg = path.join(root, 'package.json');

const read = file => fs.readFileSync(file, 'utf8');
const serviceText = read(service);
const engineText = read(engine);
const checks = [
  ['V2.7 certification models exist', fs.existsSync(models)],
  ['V2.7 certification service exists', fs.existsSync(service)],
  ['V2.7 certification service spec exists', fs.existsSync(spec)],
  ['V2.7 service is injectable', serviceText.includes("@Injectable({ providedIn: 'root' })")],
  ['V2.7 service injects final integrity gate', serviceText.includes('PdfFinalIntegrityService')],
  ['V2.7 filters to candidates smaller than source', serviceText.includes('candidate.size < source.size')],
  ['V2.7 sorts by actual output size', serviceText.includes('.sort((a, b) => a.size - b.size)')],
  ['V2.7 fingerprints candidate bytes', serviceText.includes("subtle.digest('SHA-256'")],
  ['V2.7 owns digest ArrayBuffer for TS 5.9 compatibility', serviceText.includes('ownedBytes.buffer')],
  ['V2.7 has constrained fallback fingerprint', serviceText.includes('fnv1a:')],
  ['V2.7 skips byte-identical candidates', serviceText.includes('duplicateCandidatesSkipped') && serviceText.includes('fingerprintToFirstCandidate')],
  ['V2.7 caches certification results', serviceText.includes('certificationCache') && serviceText.includes('maxCacheEntries')],
  ['V2.7 cache is bounded', serviceText.includes('this.certificationCache.size >= this.maxCacheEntries')],
  ['V2.7 can clear certification cache', serviceText.includes('clearCache(): void')],
  ['V2.7 returns first passing candidate', serviceText.includes("if (result.status === 'passed')") && serviceText.includes('selected = candidate')],
  ['V2.7 remains fail-closed through final integrity service', serviceText.includes('this.finalIntegrity.certify(')],
  ['Engine uses V2.7 certification service', engineText.includes('PdfCandidateCertificationService')],
  ['Engine delegates final candidate selection to V2.7', engineText.includes('this.candidateCertification.certifySmallest(')],
  ['Engine no longer directly duplicates V2.6 certification loop', !engineText.includes('this.finalIntegrity.certify(')],
  ['Engine retains original fallback', engineText.includes('return file;')],
  ['V2.7 engine test dependency exists', read(engineSpec).includes("candidateCertification")],
  ['V2.7 service tests duplicate candidates', read(spec).includes('byte-identical duplicate candidates')],
  ['V2.7 service tests cache reuse', read(spec).includes('reuses final-integrity certification')],
  ['V2.7 audit registered', read(pkg).includes('compress:v27:audit')],
  ['No user-src included in release source tree', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed += 1;
}
console.log(`V2.7 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

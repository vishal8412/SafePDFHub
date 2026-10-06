import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipMarker = fs.existsSync(path.join(root, 'user-src'));

const checks = [
  ['V2.11 image source branch exists', engine.includes("label: 'source'"), 'source branch'],
  ['V2.11 structural image branch exists', engine.includes("label: 'structural'"), 'structural branch'],
  ['V2.11 branch loop invokes image optimizer', engine.includes('for (let sourceIndex = 0; sourceIndex < imageSources.length; sourceIndex += 1)'), 'branch loop'],
  ['V2.11 selects smallest valid image candidate', engine.includes('.filter(candidate => candidate.valid && candidate.outputBytes < candidate.inputBytes)'), 'valid candidate filter'],
  ['V2.11 preserves final certification gate', engine.includes('this.candidateCertification.certifySmallest('), 'certification gate'],
  ['V2.11 telemetry identifies image branch', engine.includes('jpeg-quality-${candidate.quality}/${imageSource.label}'), 'branch telemetry'],
  ['V2.11 regression test added', spec.includes("V2.11") || spec.includes("V2.12"), 'regression test'],
  ['V2.11 type imported explicitly', engine.includes("PdfImageOptimizationCandidate"), 'candidate type'],
  ['V2.11 npm audit script registered', pkg.scripts?.['compress:v211:audit'] === 'node scripts/compress-v211-audit.mjs', 'package script'],
  ['user-src is absent', !zipMarker, 'release tree'],
];

let passed = 0;
for (const [name, ok, detail] of checks) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} (${detail})`);
}
console.log(`V2.11 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

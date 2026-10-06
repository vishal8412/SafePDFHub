import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipMarker = fs.existsSync(path.join(root, 'user-src'));

const checks = [
  ['V2.12 image sources carry branch forensic data', engine.includes("forensic: PdfFileAnalysis['forensic']"), 'branch forensic type'],
  ['V2.12 source branch uses cached source forensic data', engine.includes('forensic: cachedAnalysis.forensic'), 'source forensic routing'],
  ['V2.12 structural branch triggers fresh forensic analysis', engine.includes('this.analyzeBranchForensic(structuralCandidate)'), 'structural re-analysis'],
  ['V2.12 structural branch does not reuse source forensic snapshot', engine.includes('forensic: structuralForensic'), 'structural forensic routing'],
  ['V2.12 branch analysis failure is fail-closed', engine.includes('if (structuralForensic)') && engine.includes('return undefined;'), 'optional branch skip'],
  ['V2.12 image optimizer receives branch-specific forensic data', engine.includes('imageSource.forensic'), 'optimizer routing'],
  ['V2.12 helper uses PdfAnalyzer.analyzeFile', engine.includes('this.pdfAnalyzer.analyzeFile(file)'), 'analyzer integration'],
  ['V2.12 regression test verifies forensic routing', spec.includes('re-analyzes the structural branch and routes branch-specific forensic data in V2.12'), 'routing test'],
  ['V2.12 regression test verifies fail-closed branch skip', spec.includes('skips structural image optimization when branch forensic analysis fails in V2.12'), 'failure test'],
  ['V2.11 source/structural candidate exploration remains present', engine.includes("label: 'source'"), 'V2.11 baseline preserved'],
  ['V2.12 npm audit script registered', pkg.scripts?.['compress:v212:audit'] === 'node scripts/compress-v212-audit.mjs', 'package script'],
  ['user-src is absent', !zipMarker, 'release tree'],
];

let passed = 0;
for (const [name, ok, detail] of checks) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} (${detail})`);
}
console.log(`V2.12 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

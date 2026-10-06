import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipMarker = fs.existsSync(path.join(root, 'user-src'));

const checks = [
  ['V2.13 builds bounded strategy sources', engine.includes('buildStrategySources('), 'strategy-source builder'],
  ['V2.13 explores the optimized base first', engine.includes('const strategySources = this.buildStrategySources('), 'strategy source creation'],
  ['V2.13 caps strategy branch count at two', engine.includes('return candidates.slice(0, 2);'), 'two-branch cap'],
  ['V2.13 retains structural alternative', engine.includes("alternatives.push({ file: structuralBase, label: 'structural' })"), 'structural branch'],
  ['V2.13 retains image alternative', engine.includes("alternatives.push({ file: imageCandidate, label: 'image' })"), 'image branch'],
  ['V2.13 certifies every generated strategy candidate', engine.includes('[structuralCandidate, imageCandidate, ...strategyCandidates]'), 'certification candidate list'],
  ['V2.13 emits branch-specific strategy telemetry', engine.includes('`${budgetFallback ? \'safe/budget-fallback\' : plan.strategy}/${strategySource.label}`'), 'strategy telemetry'],
  ['V2.13 shares strategy progress across branches', engine.includes('strategyProgressShare = 50 / Math.max(1, strategySources.length)'), 'progress allocation'],
  ['V2.13 regression test verifies two strategy calls', spec.includes("explores a bounded second legacy-strategy branch in V2.13") && spec.includes('expect(safe).toHaveBeenCalledTimes(2)'), 'branch test'],
  ['V2.13 regression test verifies both strategy inputs', spec.includes('safe.mock.calls[0]?.[0]).toBe(imageFile)') && spec.includes('safe.mock.calls[1]?.[0]).toBe(structuralFile)'), 'input routing test'],
  ['V2.13 npm audit script registered', pkg.scripts?.['compress:v213:audit'] === 'node scripts/compress-v213-audit.mjs', 'package script'],
  ['V2.12 branch-specific forensic hardening remains present', engine.includes('this.analyzeBranchForensic(structuralCandidate)') && engine.includes('forensic: structuralForensic'), 'V2.12 preservation'],
  ['user-src is absent', !zipMarker, 'release tree'],
];

let passed = 0;
for (const [name, ok, detail] of checks) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} (${detail})`);
}
console.log(`V2.13 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

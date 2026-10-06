import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['V2.15 buildStrategySources accepts original source', /buildStrategySources\(\s*file: File/.test(engine)],
  ['V2.15 passes original source into strategy-source builder', /buildStrategySources\(\s*file,\s*optimizedBase/.test(engine)],
  ['V2.15 retains source as optional branch', /label: 'source'/.test(engine)],
  ['V2.15 branch cap is three', /return candidates\.slice\(0, 3\)/.test(engine)],
  ['V2.15 avoids duplicate File references', /!candidates\.some\(candidate => candidate\.file === alternative\.file\)/.test(engine)],
  ['V2.15 preserves size ordering for alternatives', /alternatives\.sort\(\(a, b\) => a\.file\.size - b\.file\.size\)/.test(engine)],
  ['V2.15 strategy progress derives from dynamic branch count', /50 \/ Math\.max\(1, strategySources\.length\)/.test(engine)],
  ['V2.15 all strategy candidates remain certification inputs', /\[structuralCandidate, imageCandidate, \.\.\.strategyCandidates\]/.test(engine)],
  ['V2.15 source branch regression test exists', /source-preserving third legacy-strategy branch in V2\.15/.test(spec)],
  ['V2.15 regression expects three strategy executions', /toHaveBeenCalledTimes\(3\)/.test(spec)],
  ['V2.15 regression verifies source is third strategy input', /safe\.mock\.calls\[2\]\?\.\[0\]\)\.toBe\(source\)/.test(spec)],
  ['V2.15 regression verifies three strategy telemetry entries', /stage === 'strategy'\)\)\.toHaveLength\(3\)/.test(spec)],
  ['V2.15 package audit script registered', packageJson.scripts?.['compress:v215:audit'] === 'node scripts/compress-v215-audit.mjs'],
  ['user-src is absent from release tree', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`V2.15 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

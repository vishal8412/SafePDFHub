import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const telemetry = fs.readFileSync(path.join(root, 'src/app/core/compression/compression-telemetry.models.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipMarker = fs.existsSync(path.join(root, 'user-src'));

const checks = [
  ['V2.14 uses a monotonic progress emitter', engine.includes('let lastProgress = 0') && engine.includes('lastProgress = Math.max(lastProgress, normalized)'), 'progress clamp'],
  ['V2.14 routes fast-path progress through the monotonic emitter', engine.includes('this.safeCompress(file, level, emitProgress)'), 'fast-path progress'],
  ['V2.14 records parent candidate relationships internally', engine.includes('telemetryParentByCandidate.set'), 'parent mapping'],
  ['V2.14 exposes parent fingerprints without PDF bytes', telemetry.includes('parentFingerprint?: string'), 'telemetry field'],
  ['V2.14 records the source fingerprint as fast-path parent', engine.includes('candidateTelemetry.parentFingerprint = certification.sourceFingerprint'), 'source lineage'],
  ['V2.14 resolves parent fingerprints after certification', engine.includes('const parentFingerprint = parent ? candidateFingerprints.get(parent) : undefined'), 'post-certification lineage'],
  ['V2.14 keeps V2.13 bounded strategy exploration', engine.includes('return candidates.slice(0, 2);') && engine.includes('buildStrategySources('), 'V2.13 preservation'],
  ['V2.14 keeps V2.12 branch forensic analysis', engine.includes('this.analyzeBranchForensic(structuralCandidate)') && engine.includes('forensic: structuralForensic'), 'V2.12 preservation'],
  ['V2.14 regression test checks monotonic progress', spec.includes('keeps compression progress monotonic and records candidate lineage in V2.14') && spec.includes('progress.every'), 'progress test'],
  ['V2.14 regression test checks lineage', spec.includes("parentFingerprint === 'source-fp'"), 'lineage test'],
  ['V2.14 npm audit script registered', pkg.scripts?.['compress:v214:audit'] === 'node scripts/compress-v214-audit.mjs', 'package script'],
  ['user-src is absent', !zipMarker, 'release tree'],
];

let passed = 0;
for (const [name, ok, detail] of checks) {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} (${detail})`);
}
console.log(`V2.14 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

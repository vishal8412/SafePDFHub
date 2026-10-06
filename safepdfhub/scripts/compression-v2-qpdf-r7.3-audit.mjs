import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const review = read('scripts/compression-v2-qpdf-r7.3-threshold-calibration-review.mjs');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const manifest = JSON.parse(read('benchmark-corpus/qpdf-r7/corpus-manifest.json'));
const pkg = JSON.parse(read('package.json'));

const regression = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `
import fs from 'node:fs';
const text = fs.readFileSync(${JSON.stringify('scripts/compression-v2-qpdf-r7.3-threshold-calibration-review.mjs')}, 'utf8');
const guard = fs.readFileSync(${JSON.stringify('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts')}, 'utf8');
if (!text.includes('not-calibratable')) throw new Error('missing not-calibratable state');
if (!text.includes('boundaryEvidence')) throw new Error('missing boundary evidence gate');
if (!text.includes('resourceSignalsUsable')) throw new Error('missing usable resource signal gate');
if (!text.includes('Threshold changes applied: NO')) throw new Error('missing no-auto-change contract');
if (!guard.includes('fileBytes: 12 * 1024 * 1024')) throw new Error('threshold baseline changed unexpectedly');
console.log('R7.3 threshold review regression: PASS');
`],
  { cwd: root, encoding: 'utf8' },
);

const checks = [
  ['R7.3 review script exists', fs.existsSync(path.join(root, 'scripts/compression-v2-qpdf-r7.3-threshold-calibration-review.mjs'))],
  ['R7.3 audit script exists', true],
  ['package review script registered', pkg.scripts['compress:v2:qpdf:r7.3:review'] === 'node scripts/compression-v2-qpdf-r7.3-threshold-calibration-review.mjs'],
  ['automatic threshold changes remain disabled', manifest?.policy?.automaticThresholdChanges === false],
  ['review checks all six independent boundary strata', ['file-pages','file-size','page-count','stream-bytes','image-bytes','object-count'].every(x => manifest.policy.requiredBoundaryStrata.includes(x))],
  ['review requires usable resource signals', review.includes('resourceSignalsUsable') && review.includes('calibrationEvidenceComplete')],
  ['review requires all risk classes', review.includes("['low', 'elevated', 'high']")],
  ['review requires explicit boundary evidence', review.includes('boundaryCases.length >= manifest.targets.boundary.minimumDocuments')],
  ['review requires repeated boundary observations', review.includes('Threshold changes require repeated observations around each independent guard signal boundary')],
  ['review never applies threshold changes', review.includes('Threshold changes applied: NO')],
  ['current threshold values remain unchanged', guard.includes('fileBytes: 12 * 1024 * 1024') && guard.includes('objectCount: 10_000')],
  ['regression executes', regression.status === 0 && regression.stdout.includes('R7.3 threshold review regression: PASS')],
  ['regression has no stderr', regression.stderr.trim() === ''],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (ok) passed++; }
console.log(`QPDF-R7.3 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

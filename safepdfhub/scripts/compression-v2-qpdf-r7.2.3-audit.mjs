import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const scriptPath = 'scripts/compression-v2-qpdf-r7-capability-matrix.py';
const reqPath = 'scripts/requirements-compression-v2-browser.txt';
const pkg = JSON.parse(read('package.json'));
const script = read(scriptPath);
const req = read(reqPath);

const regression = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  ['-c', `
import runpy
m = runpy.run_path(${JSON.stringify(scriptPath)})
f = m["qpdf_evidence"]
missing = f({"structuralDiagnostics": [], "candidates": []})
assert missing["outcome"] == "not-attempted"
assert missing["evidenceSemanticsPassed"] is False
assert missing["calibrationEvidenceComplete"] is False
oom = f({"structuralDiagnostics": [{"reason":"QPDF_MEMORY_EXHAUSTED","resourceRisk":"low","optimizationProfile":"standard","status":"failed"}], "candidates": []})
assert oom["outcome"] == "oom" and oom["oom"] is True
blocked = f({"structuralDiagnostics": [{"reason":"QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD","resourceRisk":"high","optimizationProfile":"conservative","status":"skipped"}], "candidates": []})
assert blocked["outcome"] == "blocked-high-risk" and blocked["blocked"] is True
contradiction = f({"structuralDiagnostics": [{"reason":"QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD","resourceRisk":"low","optimizationProfile":"conservative","status":"skipped"}], "candidates": [{"stage":"structural","generated":True,"inputBytes":100,"outputBytes":90}]})
assert "GUARD_BLOCK_AND_QPDF_ATTEMPTED" in contradiction["contradictions"]
assert contradiction["outcome"] == "evidence-contradiction"
print("R7.2.3 evidence regression: PASS")
`],
  { encoding: 'utf8' },
);

const checks = [
  ['R7.2.3 audit script exists', true],
  ['R7 capability harness exists', fs.existsSync(path.join(root, scriptPath))],
  ['fontTools is an explicit benchmark dependency', /fonttools>=4\.50,<5/i.test(req)],
  ['fontTools is preflight-imported', script.includes('import fontTools')],
  ['missing fontTools has a clear dependency error', script.includes('"fontTools": "fonttools"')],
  ['qpdf telemetry-unavailable is evidence-incomplete', script.includes('QPDF_TELEMETRY_UNAVAILABLE') && script.includes('evidence-incomplete')],
  ['empty qpdf telemetry is not calibration evidence', script.includes('calibrationEvidenceComplete') && script.includes('resourceSignalsComplete')],
  ['qpdf OOM remains explicit', script.includes('QPDF_MEMORY_EXHAUSTED') && script.includes('qpdf-oom')],
  ['guard block remains explicit', script.includes('QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD') && script.includes('guard-blocked')],
  ['contradictions fail evidence semantics', script.includes('evidence-contradiction') && script.includes('GUARD_BLOCK_AND_QPDF_ATTEMPTED')],
  ['smaller non-qpdf output cannot become qpdf evidence', script.includes('smaller final PDF by itself is not qpdf evidence')],
  ['production thresholds are not modified by R7.2.3', !script.includes('QPDF_WASM_RESOURCE_THRESHOLDS')],
  ['R7.2.3 package script registered', pkg.scripts['compress:v2:qpdf:r7.2.3:audit'] === 'node scripts/compression-v2-qpdf-r7.2.3-audit.mjs'],
  ['R7 matrix remains evidence-only', script.includes('Evidence-only aggregation') && script.includes('No threshold is automatically changed')],
  ['evidence regression executes', regression.status === 0 && regression.stdout.includes('R7.2.3 evidence regression: PASS')],
  ['evidence regression has no stderr', regression.stderr.trim() === ''],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (ok) passed++; }
console.log(`QPDF-R7.2.3 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

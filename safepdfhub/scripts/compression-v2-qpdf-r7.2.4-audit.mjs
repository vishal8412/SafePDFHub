import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const scriptPath = 'scripts/compression-v2-qpdf-r7-capability-matrix.py';
const modelPath = 'src/app/core/compression/pdf-structural-optimization.models.ts';
const servicePath = 'src/app/core/compression/pdf-structural-optimization.service.ts';
const pkg = JSON.parse(read('package.json'));
const script = read(scriptPath);
const model = read(modelPath);
const service = read(servicePath);

const regression = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  ['-c', `
import runpy
m = runpy.run_path(${JSON.stringify(scriptPath)})
f = m["qpdf_evidence"]

base = {
  "fileBytes": 100,
  "pages": 2,
  "streamBytes": 0,
  "imageBytes": 0,
  "objectCount": 0,
}
provenance = {
  "source": "forensic-analyzer",
  "partial": False,
  "fileBytes": "measured",
  "pages": "measured",
  "streamBytes": "measured-zero",
  "imageBytes": "measured-zero",
  "objectCount": "measured-zero",
}
complete = f({"structuralQpdfAttemptDecision": {"scope":"structural","state":"attempted","reason":"QPDF_ATTEMPTED","attemptedKinds":["baseline"],"skippedKinds":[]}, "structuralDiagnostics": [{"resourceSignals": base, "resourceSignalProvenance": provenance, "resourceRisk":"low", "optimizationProfile":"standard", "status":"failed", "reason":"QPDF_RUN_FAILED"}], "candidates": []})
assert complete["resourceSignalsComplete"] is True
assert complete["resourceSignalsUsable"] is True
assert complete["calibrationEvidenceComplete"] is True
assert complete["resourceSignalProvenance"]["streamBytes"] == "measured-zero"

unavailable = dict(provenance)
unavailable["streamBytes"] = "unavailable"
partial = f({"structuralQpdfAttemptDecision": {"scope":"structural","state":"attempted","reason":"QPDF_ATTEMPTED","attemptedKinds":["baseline"],"skippedKinds":[]}, "structuralDiagnostics": [{"resourceSignals": base, "resourceSignalProvenance": unavailable, "resourceRisk":"low", "optimizationProfile":"standard", "status":"failed", "reason":"QPDF_RUN_FAILED"}], "candidates": []})
assert partial["resourceSignalsComplete"] is True
assert partial["resourceSignalsUsable"] is False
assert partial["calibrationEvidenceComplete"] is False

legacy = f({"structuralDiagnostics": [{"resourceSignals": base, "resourceRisk":"low", "optimizationProfile":"standard", "status":"failed", "reason":"QPDF_RUN_FAILED"}], "candidates": []})
assert legacy["resourceSignalsComplete"] is False
assert legacy["resourceSignalsUsable"] is False
assert legacy["calibrationEvidenceComplete"] is False

oom = f({"structuralQpdfAttemptDecision": {"scope":"structural","state":"attempted","reason":"QPDF_ATTEMPTED","attemptedKinds":["baseline"],"skippedKinds":[]}, "structuralDiagnostics": [{"reason":"QPDF_MEMORY_EXHAUSTED","resourceRisk":"low","optimizationProfile":"standard","status":"failed","resourceSignals":base}], "candidates": []})
assert oom["outcome"] == "oom" and oom["oom"] is True
assert oom["evidenceSemanticsPassed"] is True
assert oom["calibrationEvidenceComplete"] is False

blocked = f({"structuralQpdfAttemptDecision": {"scope":"structural","state":"guard-blocked","reason":"RESOURCE_GUARD_BLOCKED","attemptedKinds":[],"skippedKinds":["baseline"]}, "structuralDiagnostics": [{"reason":"QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD","resourceRisk":"high","optimizationProfile":"conservative","status":"failed","resourceSignals":base}], "candidates": []})
assert blocked["outcome"] == "blocked-high-risk" and blocked["blocked"] is True
assert blocked["calibrationEvidenceComplete"] is True
print("R7.2.4 resource-signal regression: PASS")
`],
  { encoding: 'utf8' },
);

const checks = [
  ['R7.2.4 audit script exists', true],
  ['resource signal status type exists', /PdfQpdfResourceSignalStatus/.test(model)],
  ['measured-zero is explicit', model.includes("'measured-zero'")],
  ['unavailable is explicit', model.includes("'unavailable'")],
  ['resource signal provenance is part of diagnostics', model.includes('resourceSignalProvenance?: PdfQpdfResourceSignalProvenance')],
  ['forensic analyzer provenance is recorded', service.includes("source: forensic ? 'forensic-analyzer' : 'input-metadata'")],
  ['zero values are classified as measured-zero', service.includes("value === 0 ? 'measured-zero' : 'measured'")],
  ['missing forensic metrics are unavailable', service.includes("forensic && !forensic.partial ? this.signalStatus(resourceSignals.streamBytes) : 'unavailable'")],
  ['benchmark reads resource signal provenance', script.includes('resourceSignalProvenance')],
  ['complete shape is distinct from usable evidence', script.includes('resourceSignalsUsable')],
  ['unavailable signals cannot calibrate thresholds', script.includes('!= "unavailable"')],
  ['OOM evidence remains semantically valid', script.includes('semantic_state = "qpdf-oom"') && script.includes('calibration_complete = resource_signals_usable or guard_blocked')],
  ['high-risk guard can remain calibration-complete', script.includes('or guard_blocked')],
  ['legacy telemetry without provenance is not calibration evidence', script.includes('provenance_present') && script.includes('resource_signals_complete')],
  ['threshold constants are not modified by R7.2.4', !script.includes('QPDF_WASM_RESOURCE_THRESHOLDS')],
  ['R7.2.4 package script registered', pkg.scripts['compress:v2:qpdf:r7.2.4:audit'] === 'node scripts/compression-v2-qpdf-r7.2.4-audit.mjs'],
  ['resource-signal regression executes', regression.status === 0 && regression.stdout.includes('R7.2.4 resource-signal regression: PASS')],
  ['resource-signal regression has no stderr', regression.stderr.trim() === ''],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (ok) passed++; }
console.log(`QPDF-R7.2.4 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

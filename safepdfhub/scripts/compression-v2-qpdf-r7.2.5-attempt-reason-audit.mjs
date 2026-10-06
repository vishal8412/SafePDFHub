import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const scriptPath = 'scripts/compression-v2-qpdf-r7-capability-matrix.py';
const modelPath = 'src/app/core/compression/pdf-structural-optimization.models.ts';
const servicePath = 'src/app/core/compression/pdf-structural-optimization.service.ts';
const enginePath = 'src/app/core/engines/compress.engine.ts';
const telemetryPath = 'src/app/core/compression/compression-telemetry.models.ts';
const pkg = JSON.parse(read('package.json'));
const script = read(scriptPath);
const model = read(modelPath);
const service = read(servicePath);
const engine = read(enginePath);
const telemetry = read(telemetryPath);

const regression = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  ['-c', `
import runpy
m = runpy.run_path(${JSON.stringify(scriptPath)})
f = m["qpdf_evidence"]

def decision(state, reason, attempted=None, skipped=None):
    return {
        "scope": "structural",
        "state": state,
        "reason": reason,
        "attemptedKinds": attempted or [],
        "skippedKinds": skipped or [],
    }

base = {"fileBytes": 100, "pages": 2, "streamBytes": 10, "imageBytes": 20, "objectCount": 5}
prov = {k: "measured" for k in base}

attempted = f({
    "structuralQpdfAttemptDecision": decision("attempted", "QPDF_ATTEMPTED", ["baseline"], ["resource-prune"]),
    "structuralDiagnostics": [{"resourceSignals": base, "resourceSignalProvenance": prov, "resourceRisk":"low", "optimizationProfile":"standard", "status":"failed", "reason":"QPDF_RUN_FAILED"}],
    "candidates": []
})
assert attempted["attemptDecisionState"] == "attempted"
assert attempted["attemptDecisionReason"] == "QPDF_ATTEMPTED"
assert attempted["evidenceSemanticsPassed"] is True

blocked = f({
    "structuralQpdfAttemptDecision": decision("guard-blocked", "RESOURCE_GUARD_BLOCKED", [], ["baseline","resource-prune"]),
    "structuralDiagnostics": [{"resourceSignals": base, "resourceSignalProvenance": prov, "resourceRisk":"high", "optimizationProfile":"conservative", "status":"failed", "reason":"QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"}],
    "candidates": []
})
assert blocked["attemptDecisionState"] == "guard-blocked"
assert blocked["attemptDecisionReason"] == "RESOURCE_GUARD_BLOCKED"
assert blocked["blocked"] is True
assert blocked["evidenceSemanticsPassed"] is True

fast = f({
    "structuralQpdfAttemptDecision": decision("not-attempted", "STRUCTURAL_STAGE_NOT_ENTERED"),
    "structuralDiagnostics": [],
    "candidates": []
})
assert fast["semanticState"] == "not-attempted"
assert fast["attemptDecisionReason"] == "STRUCTURAL_STAGE_NOT_ENTERED"
assert fast["evidenceSemanticsPassed"] is False

no_candidates = f({
    "structuralQpdfAttemptDecision": decision("not-attempted", "NO_STRUCTURAL_CANDIDATES_SELECTED"),
    "structuralDiagnostics": [],
    "candidates": []
})
assert no_candidates["attemptDecisionReason"] == "NO_STRUCTURAL_CANDIDATES_SELECTED"
assert no_candidates["evidenceSemanticsPassed"] is False

mismatch = f({
    "structuralQpdfAttemptDecision": decision("attempted", "QPDF_ATTEMPTED", ["baseline"]),
    "structuralDiagnostics": [],
    "candidates": []
})
assert "QPDF_ATTEMPTED_WITHOUT_STRUCTURAL_DIAGNOSTICS" in mismatch["contradictions"]
assert mismatch["semanticState"] == "contradictory"
assert mismatch["evidenceSemanticsPassed"] is False

print("R7.2.5 attempt/skip reason regression: PASS")
`],
  { encoding: 'utf8' },
);

const checks = [
  ['R7.2.5 audit script exists', true],
  ['attempt decision types exist', model.includes('PdfQpdfAttemptDecisionState') && model.includes('PdfQpdfAttemptDecisionReason')],
  ['attempt decision is structural-scoped', model.includes("scope: 'structural'")],
  ['resource guard has explicit skip reason', model.includes("RESOURCE_GUARD_BLOCKED") && service.includes("reason: 'RESOURCE_GUARD_BLOCKED'")],
  ['attempted qpdf has explicit reason', service.includes("reason: attemptedKinds.length > 0 ? 'QPDF_ATTEMPTED'")],
  ['no structural candidates have explicit reason', service.includes("NO_STRUCTURAL_CANDIDATES_SELECTED")],
  ['engine records structural-stage-not-entered', engine.includes("STRUCTURAL_STAGE_NOT_ENTERED")],
  ['telemetry exposes structural qpdf decision', telemetry.includes('structuralQpdfAttemptDecision?: PdfQpdfAttemptDecision')],
  ['benchmark consumes attempt decision', script.includes('structuralQpdfAttemptDecision') && script.includes('attemptDecisionReason')],
  ['attempted without diagnostics is contradictory', script.includes('QPDF_ATTEMPTED_WITHOUT_STRUCTURAL_DIAGNOSTICS')],
  ['guard decision without guard diagnostic is contradictory', script.includes('QPDF_GUARD_DECISION_WITHOUT_GUARD_DIAGNOSTIC')],
  ['not-attempted with diagnostics is contradictory', script.includes('QPDF_NOT_ATTEMPTED_WITH_STRUCTURAL_DIAGNOSTICS')],
  ['missing attempt decision is incomplete evidence', script.includes('if attempt_decision is None')],
  ['threshold constants are not modified by R7.2.5', !script.includes('QPDF_WASM_RESOURCE_THRESHOLDS')],
  ['package script registered', pkg.scripts['compress:v2:qpdf:r7.2.5:audit'] === 'node scripts/compression-v2-qpdf-r7.2.5-attempt-reason-audit.mjs'],
  ['attempt/skip regression executes', regression.status === 0 && regression.stdout.includes('R7.2.5 attempt/skip reason regression: PASS')],
  ['attempt/skip regression has no stderr', regression.stderr.trim() === ''],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (ok) passed++; }
console.log(`QPDF-R7.2.5 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

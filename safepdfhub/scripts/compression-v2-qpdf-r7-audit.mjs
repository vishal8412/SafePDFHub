import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const scriptPath = 'scripts/compression-v2-qpdf-r7-capability-matrix.py';
const guardPath = 'src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts';
const enginePath = 'src/app/core/engines/compress.engine.ts';
const acceptancePath = 'scripts/compression-v2-browser-acceptance.py';
const guardSpecPath = 'src/app/core/qpdf/qpdf-wasm-resource-guard.service.spec.ts';
const pkg = JSON.parse(read('package.json'));
const script = read(scriptPath);
const guard = read(guardPath);
const engine = read(enginePath);
const acceptance = read(acceptancePath);
const guardSpec = read(guardSpecPath);
const regression = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  [
    '-c',
    `
import runpy
mod = runpy.run_path(${JSON.stringify(scriptPath)})
qpdf_evidence = mod["qpdf_evidence"]

ome = qpdf_evidence({
  "structuralDiagnostics": [{
    "reason": "QPDF_MEMORY_EXHAUSTED",
    "runtimeErrorMessage": "Aborted(OOM).",
    "resourceRisk": "low",
    "optimizationProfile": "standard",
    "status": "failed",
  }],
  "candidates": [],
})
assert ome["outcome"] == "oom", ome
assert ome["oom"] is True, ome

blocked = qpdf_evidence({
  "structuralDiagnostics": [{
    "reason": "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD",
    "runtimeErrorMessage": "",
    "resourceRisk": "high",
    "optimizationProfile": "conservative",
    "status": "skipped",
  }],
  "candidates": [],
})
assert blocked["outcome"] == "blocked-high-risk", blocked
assert blocked["attempted"] is False, blocked

low = qpdf_evidence({
  "structuralDiagnostics": [{
    "resourceRisk": "low",
    "optimizationProfile": "standard",
    "status": "generated",
  }],
  "candidates": [{
    "stage": "structural",
    "generated": True,
    "inputBytes": 1000,
    "outputBytes": 900,
    "certification": "failed",
  }],
})
assert low["attempted"] is True, low
assert low["blocked"] is False, low
assert low["outcome"] == "attempted-no-certified-smaller", low
assert not low["contradictions"], low

contradiction = qpdf_evidence({
  "structuralDiagnostics": [{
    "reason": "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD",
    "resourceRisk": "low",
    "status": "skipped",
  }],
  "candidates": [],
})
assert contradiction["outcome"] == "evidence-contradiction", contradiction
assert "GUARD_BLOCK_WITH_NON_HIGH_RESOURCE_RISK" in contradiction["contradictions"], contradiction

print("R7 qpdf_evidence regression: PASS")
`,
  ],
  { encoding: 'utf8' },
);
const regressionPassed =
  regression.status === 0 &&
  regression.stdout.includes('R7 qpdf_evidence regression: PASS');

const checks = [
  ['R7 qpdf_evidence regression executes', regressionPassed],
  ['R7 qpdf_evidence regression output is clean', regression.stderr.trim() === ''],
  ['R7 rejects contradictory qpdf evidence', script.includes('evidence-contradiction') && script.includes('contradictions')],
  ['R7 records evidence semantic pass/fail', script.includes('evidenceSemanticsPassed')],
  ['R7 capability-matrix harness exists', fs.existsSync(path.join(root, scriptPath))],
  ['R7 accepts repeatable PDF inputs', script.includes('action="append"') && script.includes('--input')],
  ['R7 accepts input directory', script.includes('--input-dir') && script.includes('discover_inputs')],
  ['R7 supports recursive corpus discovery', script.includes('--recursive') && script.includes('rglob')],
  ['R7 supports Light/Recommended/Strong', script.includes('LEVELS = {') && script.includes('light') && script.includes('recommended') && script.includes('strong')],
  ['R7 starts the real Angular app', script.includes('[npm, "start"') && script.includes('/tools/compress-pdf')],
  ['R7 uses real browser download', script.includes('expect_download') && script.includes('Download compressed PDF')],
  ['R7 captures development compression telemetry', script.includes('[SafePDFHub Compression Benchmark]') && script.includes('console_telemetry')],
  ['R7 records resource risk', script.includes('resourceRisk') && script.includes('summaryByObservedRisk')],
  ['R7 carries privacy-safe resource signals for calibration', script.includes('resourceSignals')],
  ['R7 records qpdf OOM evidence', script.includes('QPDF_MEMORY_EXHAUSTED') && script.includes('oom')],
  ['R7 records qpdf blocked evidence', script.includes('QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD') && script.includes('blocked-high-risk')],
  ['R7 records smaller certified qpdf candidates', script.includes('smaller-certified') && script.includes('certifiedStructuralCandidate')],
  ['R7 validates page count and geometry', script.includes('"pageCount"') && script.includes('"geometry"')],
  ['R7 validates exact metadata', script.includes('metadata(reader)') && script.includes('output_meta["metadata"] == source_meta["metadata"]')],
  ['R7 validates full text hash', script.includes('textSha256') && script.includes('textHash')],
  ['R7 validates annotations/forms', script.includes('annotations_signature') && script.includes('"annotations"')],
  ['R7 validates visual fidelity', script.includes('visual_fidelity') && script.includes('RENDER_DPI')],
  ['R7 requires output not larger', script.includes('output_meta["bytes"] <= source_meta["bytes"]')],
  ['R7 checks telemetry final bytes', script.includes('telemetry.get("finalBytes") == output_meta["bytes"]')],
  ['R7 is evidence-only', script.includes('automaticThresholdChanges') && script.includes('False') && script.includes('No threshold is changed')],
  ['R7 preserves current high-risk policy', script.includes('highRiskPolicy') && script.includes('preserved from R6/R6.1')],
  ['R7 does not mutate resource thresholds', !script.includes('QpdfWasmResourceGuardService') || script.includes('threshold')],
  ['R7 guard regression spec covers threshold constants', guardSpec.includes('QPDF_WASM_RESOURCE_THRESHOLDS')],
  ['Existing R6.1 high-risk gate remains', engine.includes('skipExpensiveLegacyStrategy') && engine.includes("skipped/high-risk-qpdf-output-disabled")],
  ['High-risk qpdf output remains disabled', guard.includes("risk: 'high'") && guard.includes('allowPdfOutput: false')],
  ['Low-risk qpdf output remains enabled', guard.includes("risk: 'low'") && guard.includes('allowPdfOutput: true')],
  ['Elevated-risk qpdf output remains enabled', guard.includes("risk: 'elevated'") && guard.includes('allowPdfOutput: true')],
  ['R7 does not replace the existing acceptance harness', fs.existsSync(path.join(root, acceptancePath))],
  ['R7 package script registered', pkg.scripts['compress:v2:qpdf:r7:matrix'] === 'python scripts/compression-v2-qpdf-r7-capability-matrix.py'],
  ['R7 audit package script registered', pkg.scripts['compress:v2:qpdf:r7:audit'] === 'node scripts/compression-v2-qpdf-r7-audit.mjs'],
  ['user-src is not required by R7 release packaging', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`QPDF-R7 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const r7Path = 'scripts/compression-v2-qpdf-r7-capability-matrix.py';
const inventoryPath = 'scripts/compression-v2-qpdf-r7.2-corpus-inventory.py';
const r7 = fs.readFileSync(path.join(root, r7Path), 'utf8');
const inventory = fs.readFileSync(path.join(root, inventoryPath), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const regressionCode = `
import runpy
from pathlib import Path
import tempfile

r7 = runpy.run_path(${JSON.stringify(r7Path)})
q = r7["qpdf_evidence"]

def assert_eq(actual, expected, label):
    assert actual == expected, f"{label}: {actual!r} != {expected!r}"

# Regression for the original bug: low-risk + structural candidate must never
# become blocked-high-risk merely because diagnostics have no reason values.
low = q({
    "structuralDiagnostics": [
        {
            "resourceRisk": "low",
            "optimizationProfile": "standard",
            "status": "generated",
        },
        {
            "resourceRisk": "low",
            "optimizationProfile": "standard",
            "status": "rejected",
        },
    ],
    "candidates": [
        {"stage": "structural", "generated": True, "inputBytes": 1000, "outputBytes": 900, "certification": "failed"},
    ],
})
assert_eq(low["attempted"], True, "low attempted")
assert_eq(low["blocked"], False, "low blocked")
assert_eq(low["outcome"], "attempted-no-certified-smaller", "low outcome")
assert_eq(low["contradictions"], [], "low contradictions")

blocked = q({
    "structuralDiagnostics": [{
        "reason": "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD",
        "resourceRisk": "high",
        "optimizationProfile": "conservative",
        "status": "skipped",
    }],
    "candidates": [],
})
assert_eq(blocked["attempted"], False, "blocked attempted")
assert_eq(blocked["blocked"], True, "blocked blocked")
assert_eq(blocked["outcome"], "blocked-high-risk", "blocked outcome")

contradictory = q({
    "structuralDiagnostics": [{
        "reason": "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD",
        "resourceRisk": "low",
        "status": "skipped",
    }],
    "candidates": [],
})
assert_eq(contradictory["outcome"], "evidence-contradiction", "contradictory outcome")
assert "GUARD_BLOCK_WITH_NON_HIGH_RESOURCE_RISK" in contradictory["contradictions"]
assert_eq(contradictory["blocked"], False, "contradictory blocked")

oom = q({
    "structuralDiagnostics": [{
        "reason": "QPDF_MEMORY_EXHAUSTED",
        "runtimeErrorMessage": "Aborted(OOM)",
        "resourceRisk": "low",
        "status": "failed",
    }],
    "candidates": [],
})
assert_eq(oom["outcome"], "oom", "oom outcome")
assert_eq(oom["oom"], True, "oom flag")
assert_eq(oom["blocked"], False, "oom blocked")

# Inventory parser cross-validation must use both parser stacks and preserve
# the distinction between parser disagreement and total failure.
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "fixture.pdf"
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "R7.2.2 parser fixture")
    doc.save(out)
    doc.close()
    inv = runpy.run_path(${JSON.stringify(inventoryPath)})
    py = inv["pypdf_probe"](out)
    mu = inv["pymupdf_probe"](out)
    assert_eq(py["ok"], True, "fixture pypdf")
    assert_eq(mu["ok"], True, "fixture pymupdf")
    assert_eq(py["pages"], mu["pages"], "fixture page agreement")

print("R7.2.2 integrity regression: PASS")
`;

const regression = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  ['-c', regressionCode],
  { encoding: 'utf8', cwd: root },
);

const checks = [
  ['R7.2.2 regression executes', regression.status === 0 && regression.stdout.includes('R7.2.2 integrity regression: PASS')],
  ['R7.2.2 regression stderr is clean', regression.stderr.trim() === ''],
  ['R7 qpdf evidence uses explicit guard reason', r7.includes('guard_reason = "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"')],
  ['R7 does not use empty all() guard inference', !r7.includes('blocked = bool(diagnostics) and all(')],
  ['R7 distinguishes attempted from guard-blocked', r7.includes('GUARD_BLOCK_AND_QPDF_ATTEMPTED')],
  ['R7 detects guard-block with non-high risk', r7.includes('GUARD_BLOCK_WITH_NON_HIGH_RESOURCE_RISK')],
  ['R7 detects guard-block plus OOM', r7.includes('GUARD_BLOCK_AND_QPDF_OOM')],
  ['R7 exposes evidence contradictions', r7.includes('evidence-contradiction') && r7.includes('contradictions')],
  ['R7 evidence semantics participate in acceptance', r7.includes('evidenceSemanticsPassed') && r7.includes('acceptance = acceptance and evidence_semantics_passed')],
  ['Inventory uses PyMuPDF without deprecated fitz import', inventory.includes('import pymupdf') && !inventory.includes('import fitz')],
  ['Inventory cross-validates with pypdf and PyMuPDF', inventory.includes('pypdf_probe') && inventory.includes('pymupdf_probe')],
  ['Inventory records parser disagreement', inventory.includes('parserDisagreement')],
  ['Inventory correlates acquisition plan/report', inventory.includes('ACQUISITION_PLAN') && inventory.includes('ACQUISITION_REPORT')],
  ['R7.2.2 audit package script is registered', pkg.scripts['compress:v2:qpdf:r7.2.2:audit'] === 'node scripts/compression-v2-qpdf-r7.2.2-integrity-audit.mjs'],
  ['Production thresholds remain untouched by R7.2.2', !r7.includes('QPDF_WASM_RESOURCE_THRESHOLDS =') && !inventory.includes('QPDF_WASM_RESOURCE_THRESHOLDS =')],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`R7.2.2 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const matrix = read('scripts/compression-v2-qpdf-r7-capability-matrix.py');
const engine = read('src/app/core/engines/compress.engine.ts');
const models = read('src/app/core/compression/pdf-structural-optimization.models.ts');
const pkg = JSON.parse(read('package.json'));

check('matrix:unknown-guard-is-valid-safety-state',
  matrix.includes('guard_blocked and risks and set(risks).issubset({"low", "elevated"})') &&
  matrix.includes('outcome = "blocked-safe-fallback" if risks == ["unknown"] else "blocked-high-risk"'));
check('matrix:unknown-guard-not-calibration-evidence',
  matrix.includes('calibration_complete = resource_signals_usable or (guard_blocked and risks == ["high"])'));
check('matrix:fast-path-has-explicit-not-applicable-state',
  matrix.includes('fast_path_not_applicable = decision_reason == "ALREADY_COMPRESSED_FAST_PATH"') &&
  matrix.includes('semantic_state = "not-applicable"'));
check('matrix:fast-path-is-semantic-pass',
  matrix.includes('elif fast_path_not_applicable:') && matrix.includes('semantics_passed = True'));
check('matrix:generic-not-attempted-remains-failure',
  matrix.includes('elif semantic_state == "not-attempted":') && matrix.includes('semantics_passed = False'));
check('matrix:guard-requires-resource-evidence',
  matrix.includes('semantics_passed = semantics_passed and bool(risks) and resource_signals_complete'));
check('matrix:blocked-aggregation-uses-semantic-state',
  matrix.includes('case["qpdf"].get("semanticState") == "guard-blocked"'));
check('engine:fast-path-explicit-reason',
  engine.includes("reason: 'ALREADY_COMPRESSED_FAST_PATH'") &&
  engine.includes('deliberate, certified fast path'));
check('models:fast-path-reason-contract',
  models.includes("| 'ALREADY_COMPRESSED_FAST_PATH';"));
check('package:r1.1-audit',
  pkg.scripts?.['compress:v2:production-reliability:r1.1:audit'] === 'node scripts/compression-v2-production-reliability-r1.1-audit.mjs');

const py = spawnSync('python', ['-m', 'py_compile', resolve(root, 'scripts/compression-v2-qpdf-r7-capability-matrix.py')], { encoding: 'utf8' });
check('matrix:python-syntax', py.status === 0, py.stderr || '');
const js = spawnSync(process.execPath, ['--check', resolve(root, 'scripts/compression-v2-production-reliability-r1.1-audit.mjs')], { encoding: 'utf8' });
check('audit:javascript-syntax', js.status === 0, js.stderr || '');

check('no-threshold-mutation',
  !matrix.includes('QPDF_WASM_RESOURCE_THRESHOLDS') &&
  !engine.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));

const files = [
  'scripts/compression-v2-qpdf-r7-capability-matrix.py',
  'src/app/core/engines/compress.engine.ts',
  'src/app/core/compression/pdf-structural-optimization.models.ts',
  'scripts/compression-v2-production-reliability-r1.1-audit.mjs',
];
for (const file of files) check(`exists:${file}`, existsSync(resolve(root, file)));

const passed = checks.filter((entry) => entry.pass).length;
console.log(`R1.1 evidence state-machine audit: ${passed}/${checks.length} PASS`);
process.exitCode = passed === checks.length ? 0 : 1;

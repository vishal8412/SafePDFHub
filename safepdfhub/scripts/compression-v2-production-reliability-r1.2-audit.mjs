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
const read = file => readFileSync(resolve(root, file), 'utf8');

const engine = read('src/app/core/engines/compress.engine.ts');
const telemetry = read('src/app/core/compression/compression-telemetry.models.ts');
const matrix = read('scripts/compression-v2-qpdf-r7-capability-matrix.py');
const pkg = JSON.parse(read('package.json'));

check('engine:structural-stage-lifecycle',
  engine.includes('structuralStageEntered = true') &&
  engine.includes('structuralStageCompleted = true') &&
  engine.includes('decisionReason: structuralQpdfAttemptDecision?.reason'));
check('engine:fast-path-explicitly-bypasses-structural-stage',
  engine.includes("reason: 'ALREADY_COMPRESSED_FAST_PATH'") &&
  engine.includes(`false,\n        false,`));
check('engine:certification-reason-bridged-to-telemetry',
  engine.includes('telemetry.certificationReason = evaluation.result.reason') &&
  engine.includes('telemetry.certificationPagesChecked = evaluation.result.pagesChecked') &&
  engine.includes('telemetry.certificationTotalPages = evaluation.result.totalPages'));
check('engine:final-decision-is-explicit',
  engine.includes("finalDecision: output === source ? 'original-fallback' : 'certified-candidate'") &&
  engine.includes('finalDecisionReason'));
check('models:certification-reason-fields',
  telemetry.includes('certificationReason?: string | null') &&
  telemetry.includes('certificationPagesChecked?: number') &&
  telemetry.includes('certificationTotalPages?: number'));
check('models:structural-stage-lifecycle',
  telemetry.includes('export interface CompressionStructuralStageLifecycle') &&
  telemetry.includes('structuralStage: CompressionStructuralStageLifecycle'));
check('matrix:acceptance-failure-reasons',
  matrix.includes('acceptance_failure_reasons') &&
  matrix.includes('PAGE_GEOMETRY_MISMATCH') &&
  matrix.includes('QPDF_EVIDENCE_SEMANTICS_FAILED'));
check('matrix:structural-stage-lifecycle-validation',
  matrix.includes('STRUCTURAL_DECISION_WITHOUT_STAGE_ENTRY') &&
  matrix.includes('STRUCTURAL_STAGE_ENTERED_WITH_NOT_ENTERED_REASON') &&
  matrix.includes('STRUCTURAL_STAGE_ENTERED_BUT_NOT_COMPLETED'));
check('matrix:certification-reasons-exported',
  matrix.includes('candidateCertificationReasons') &&
  matrix.includes('finalDecisionReason'));
check('package:r1.2-audit',
  pkg.scripts?.['compress:v2:production-reliability:r1.2:audit'] === 'node scripts/compression-v2-production-reliability-r1.2-audit.mjs');

const py = spawnSync('python', ['-m', 'py_compile', resolve(root, 'scripts/compression-v2-qpdf-r7-capability-matrix.py')], { encoding: 'utf8' });
check('matrix:python-syntax', py.status === 0, py.stderr || '');
const js = spawnSync(process.execPath, ['--check', resolve(root, 'scripts/compression-v2-production-reliability-r1.2-audit.mjs')], { encoding: 'utf8' });
check('audit:javascript-syntax', js.status === 0, js.stderr || '');

const files = [
  'src/app/core/engines/compress.engine.ts',
  'src/app/core/compression/compression-telemetry.models.ts',
  'scripts/compression-v2-qpdf-r7-capability-matrix.py',
  'scripts/compression-v2-production-reliability-r1.2-audit.mjs',
];
for (const file of files) check(`exists:${file}`, existsSync(resolve(root, file)));

check('no-threshold-mutation',
  !matrix.includes('QPDF_WASM_RESOURCE_THRESHOLDS') &&
  !engine.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));

const passed = checks.filter(entry => entry.pass).length;
console.log(`R1.2 fallback certification & structural stage audit: ${passed}/${checks.length} PASS`);
process.exitCode = passed === checks.length ? 0 : 1;

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const checks = [];
const ok = (name, pass, detail='') => checks.push({name, pass, detail});
const files = [
 'scripts/compression-v2-qpdf-r7.5-clean-corpus-preflight.mjs',
 'scripts/compression-v2-qpdf-r7.5-clean-benchmark.py',
 'scripts/compression-v2-qpdf-r7-capability-matrix.py',
 'benchmark-corpus/qpdf-r7/corpus-manifest.json',
 'benchmark-corpus/qpdf-r7/corpus-acquisition-plan.json'
];
for (const f of files) ok(`exists:${f}`, fs.existsSync(path.join(root,f)));
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
ok('package:r7.5:preflight', Boolean(pkg.scripts?.['compress:v2:qpdf:r7.5:preflight']));
ok('package:r7.5:benchmark', Boolean(pkg.scripts?.['compress:v2:qpdf:r7.5:benchmark']));
const syntax = spawnSync(process.execPath, ['--check', path.join(root,'scripts/compression-v2-qpdf-r7.5-clean-corpus-preflight.mjs')], {encoding:'utf8'});
ok('preflight:syntax', syntax.status === 0, syntax.stderr || '');
const audit = spawnSync('python', ['-m','py_compile',path.join(root,'scripts/compression-v2-qpdf-r7.5-clean-benchmark.py')], {encoding:'utf8'});
ok('orchestrator:python-syntax', audit.status === 0, audit.stderr || '');
const text = fs.readFileSync(path.join(root,'scripts/compression-v2-qpdf-r7.5-clean-benchmark.py'),'utf8');
ok('orchestrator:fails-closed', text.includes('No partial benchmark was executed'));
ok('orchestrator:uses-hardened-r7-matrix', text.includes('compression-v2-qpdf-r7-capability-matrix.py'));
ok('no-threshold-mutation', !text.includes('QPDF_WASM_RESOURCE_THRESHOLDS') && !text.includes('threshold'));
const result = spawnSync(process.execPath, [path.join(root,'scripts/compression-v2-qpdf-r7.5-clean-corpus-preflight.mjs')], {cwd:root,encoding:'utf8'});
ok('preflight:executes', result.status === 0 || result.status === 2, result.stdout.slice(-1000));
const total = checks.length, passed = checks.filter(c=>c.pass).length;
for (const c of checks) console.log(`${c.pass?'PASS':'FAIL'} ${c.name}${c.detail?` — ${c.detail}`:''}`);
console.log(`R7.5 audit: ${passed}/${total} PASS`);
process.exitCode = passed === total ? 0 : 1;

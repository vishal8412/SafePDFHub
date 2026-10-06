import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'src/app/core/compression/compression-telemetry.models.ts',
  'src/app/core/compression/compression.models.ts',
  'src/app/core/compression/compress.facade.ts',
  'src/app/core/engines/compress.engine.ts',
];
let pass = 0;
const checks = [];
function check(name, ok) { checks.push([name, ok]); if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); }
for (const file of files) check(`${file} exists`, fs.existsSync(path.join(root, file)));
const models = fs.readFileSync(path.join(root, files[0]), 'utf8');
const engine = fs.readFileSync(path.join(root, files[3]), 'utf8');
const facade = fs.readFileSync(path.join(root, files[2]), 'utf8');
const compressionModels = fs.readFileSync(path.join(root, files[1]), 'utf8');
check('telemetry version contract', models.includes('version: 1;'));
check('candidate stage contract', models.includes("'structural' | 'image' | 'strategy'"));
check('certification telemetry contract', models.includes('uniqueCandidatesCertified'));
check('no PDF bytes retained by telemetry', !models.includes('file: File'));
check('engine exposes last execution telemetry', engine.includes('lastExecutionTelemetry: CompressionExecutionTelemetry | null'));
check('engine records structural candidates', engine.includes('structural.candidates.map') || engine.includes('for (const candidate of structural.candidates)'));
check('engine records image candidates', engine.includes('imageOptimization.candidates.map') || engine.includes('for (const candidate of imageOptimization.candidates)'));
check('engine records strategy candidate', engine.includes("'strategy',") && engine.includes('strategyCandidate.size'));
check('engine records certification counters', engine.includes('duplicateCandidatesSkipped: certification.duplicateCandidatesSkipped'));
check('engine returns selected/original through telemetry', engine.includes('const selected = certification.selected ?? file;'));
check('facade persists telemetry on result', facade.includes('telemetry: this.compressEngine.lastExecutionTelemetry ?? undefined'));
check('compression result telemetry is optional', compressionModels.includes('telemetry?: CompressionExecutionTelemetry'));
check('no user-src directory', !fs.existsSync(path.join(root, 'user-src')));
console.log(`V2.8 audit: ${pass}/${checks.length} PASS`);
if (pass !== checks.length) process.exit(1);

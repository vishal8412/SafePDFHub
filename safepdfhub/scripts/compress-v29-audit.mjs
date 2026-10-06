import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];
let pass = 0;
function check(name, ok) { checks.push([name, ok]); if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); }

const telemetryPath = path.join(root, 'src/app/core/compression/compression-telemetry.models.ts');
const enginePath = path.join(root, 'src/app/core/engines/compress.engine.ts');
const engineSpecPath = path.join(root, 'src/app/core/engines/compress.engine.spec.ts');
const certPath = path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.ts');

for (const file of [telemetryPath, enginePath, engineSpecPath, certPath]) {
  check(`${path.relative(root, file)} exists`, fs.existsSync(file));
}

const telemetry = fs.readFileSync(telemetryPath, 'utf8');
const engine = fs.readFileSync(enginePath, 'utf8');
const spec = fs.readFileSync(engineSpecPath, 'utf8');
const cert = fs.readFileSync(certPath, 'utf8');

check('candidate fingerprint telemetry contract', telemetry.includes('candidateFingerprint?: string'));
check('telemetry explicitly states fingerprint contains no PDF bytes', telemetry.includes('never contains PDF bytes'));
check('already-compressed path invokes certification', engine.includes('this.candidateCertification.certifySmallest') && engine.includes('[output]'));
check('already-compressed path uses certified selection', engine.includes('const selected = certification.selected ?? file;'));
check('normal telemetry uses candidate identity map', engine.includes('const telemetryByCandidate = new Map<File, CompressionCandidateTelemetry>()'));
check('structural telemetry stores candidate identity', engine.includes('telemetryByCandidate.set(candidate.file, telemetry);'));
check('image telemetry stores candidate identity', engine.includes('telemetryByCandidate.set(candidate.file, telemetry);'));
check('strategy telemetry stores candidate identity', engine.includes('telemetryByCandidate.set(strategyCandidate, strategyTelemetry);'));
check('certification mapping uses File identity', engine.includes('telemetryByCandidate.get(evaluation.candidate)'));
check('certification fingerprint copied into telemetry', engine.includes('telemetry.candidateFingerprint = evaluation.fingerprint;'));
check('selected telemetry uses certified File identity', engine.includes('telemetryByCandidate.get(certification.selected)'));
check('regression test covers already-compressed certification', spec.includes('certifies the already-compressed fast-path candidate'));
check('regression test covers same-size provenance', spec.includes('maps certification telemetry by candidate identity rather than output size'));
check('fingerprinting remains SHA-256', cert.includes("digest('SHA-256'"));
check('release has no user-src', !fs.existsSync(path.join(root, 'user-src')));

console.log(`V2.9 audit: ${pass}/${checks.length} PASS`);
if (pass !== checks.length) process.exit(1);

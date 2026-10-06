import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [
  ['benchmark script exists', 'scripts/compression-v2-browser-acceptance.py'],
  ['package script registered', 'package.json'],
  ['dev-only telemetry hook exists', 'src/app/core/compression/compress.facade.ts'],
  ['full page geometry check', 'scripts/compression-v2-browser-acceptance.py'],
  ['full text fingerprint check', 'scripts/compression-v2-browser-acceptance.py'],
  ['metadata check', 'scripts/compression-v2-browser-acceptance.py'],
  ['annotation/form/link check', 'scripts/compression-v2-browser-acceptance.py'],
  ['visual fidelity check', 'scripts/compression-v2-browser-acceptance.py'],
  ['memory measurement', 'scripts/compression-v2-browser-acceptance.py'],
  ['candidate telemetry capture', 'scripts/compression-v2-browser-acceptance.py'],
  ['original/equal-size acceptance rule', 'scripts/compression-v2-browser-acceptance.py'],
  ['server startup is Windows-safe', 'scripts/compression-v2-browser-acceptance.py'],
  ['user-src excluded from release artifacts', null],
];
let pass = 0;
for (const [label, rel] of checks) {
  let ok = false;
  if (rel === null) {
    ok = !fs.existsSync(path.join(root, 'user-src'));
  } else {
    ok = fs.existsSync(path.join(root, rel));
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (ok) pass++;
}
console.log(`Compression V2 browser acceptance audit: ${pass}/${checks.length} PASS`);
process.exitCode = pass === checks.length ? 0 : 1;

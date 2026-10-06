import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'scripts', 'compression-v2-browser-acceptance.py');
const text = fs.readFileSync(file, 'utf8');
const checks = [
  ['uses pymupdf import', /import pymupdf as fitz/.test(text)],
  ['server startup timeout is 300s', /SERVER_TIMEOUT\s*=\s*300/.test(text)],
  ['server stdout/stderr captured', /compression-v2-server\.log/.test(text)],
  ['timeout includes server log tail', /last server log lines/.test(text)],
  ['Windows npm resolution retained', /npm\.cmd/.test(text)],
  ['active server reachability polling retained', /urlopen\(URL, timeout=2\)/.test(text)],
];
let pass=0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if(ok) pass++; }
console.log(`Compression V2 browser server-startup audit: ${pass}/${checks.length} PASS`);
if (pass !== checks.length) process.exit(1);

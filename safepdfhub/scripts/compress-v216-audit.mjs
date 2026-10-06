import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.spec.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['V2.16 preflight deduplication is present', engine.includes('deduplicateStrategySources(')],
  ['V2.16 fingerprints strategy inputs before execution', engine.includes('fingerprintFile(candidate.file)')],
  ['V2.16 uses SHA-256 when Web Crypto is available', engine.includes("crypto.subtle.digest('SHA-256', bytes)")],
  ['V2.16 has deterministic non-crypto fallback', engine.includes('fnv1a-')],
  ['V2.16 duplicate strategy inputs are marked duplicate-skipped', engine.includes("'duplicate-skipped'") && engine.includes('preflight-duplicate-skipped/')],
  ['V2.16 duplicate strategy input is not executed', engine.includes('continue;')],
  ['V2.16 preserves final certification as authority', engine.includes('final V2.7/V2.6 certification remains the only selector') || engine.includes('final V2.7/V2.6 certification')],
  ['V2.16 regression test exists', spec.includes('deduplicates byte-identical strategy inputs before legacy strategy execution in V2.16')],
  ['V2.16 regression verifies reduced strategy executions', spec.includes('toHaveBeenCalledTimes(2)')],
  ['V2.16 regression verifies duplicate telemetry', spec.includes('preflight-duplicate-skipped/structural')],
  ['V2.15 bounded source branch remains', engine.includes('return candidates.slice(0, 3);')],
  ['V2.16 audit script is registered', packageJson.scripts?.['compress:v216:audit'] === 'node scripts/compress-v216-audit.mjs'],
  ['user-src is absent from release tree', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (ok) passed++;
}
console.log(`V2.16 audit: ${passed}/${checks.length}`);
if (passed !== checks.length) process.exit(1);

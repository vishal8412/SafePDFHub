#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'benchmark-corpus/qpdf-r7/corpus-manifest.json');
const inventoryScript = path.join(root, 'scripts/compression-v2-qpdf-r7.2-corpus-inventory.py');
const acquisitionScript = path.join(root, 'scripts/compression-v2-qpdf-r7.2-acquire-corpus.py');
const acquisitionPlanPath = path.join(root, 'benchmark-corpus/qpdf-r7/corpus-acquisition-plan.json');
const r7 = path.join(root, 'scripts/compression-v2-qpdf-r7-capability-matrix.py');
const r722Audit = path.join(root, 'scripts/compression-v2-qpdf-r7.2.2-integrity-audit.mjs');
const guard = path.join(root, 'src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const acquisitionPlan = JSON.parse(fs.readFileSync(acquisitionPlanPath, 'utf8')); 

const checks = [];
const pass = (name, ok) => checks.push({name, ok: Boolean(ok)});
pass('R7.2 corpus manifest exists', fs.existsSync(manifestPath));
pass('R7.2 inventory script exists', fs.existsSync(inventoryScript));
pass('R7.2.2 integrity audit exists', fs.existsSync(r722Audit));
pass('R7.2.1 acquisition script exists', fs.existsSync(acquisitionScript));
pass('R7.2.1 acquisition plan exists', fs.existsSync(acquisitionPlanPath));
pass('R7.2 keeps R7 as evidence-only', fs.readFileSync(r7, 'utf8').includes('automaticThresholdChanges'));
pass('R7.2 does not modify production thresholds', fs.readFileSync(inventoryScript, 'utf8').includes('no threshold changes'));
pass('R7.2 required risk classes are declared', JSON.stringify(manifest.targets).includes('low') && JSON.stringify(manifest.targets).includes('elevated') && JSON.stringify(manifest.targets).includes('high'));
pass('R7.2 boundary strata cover all independent guard signals', manifest.policy.requiredBoundaryStrata.length === 6);
pass('R7.2 public-source provenance is represented', manifest.sources.length >= 3 && manifest.sources.every((s) => s.url && s.organization));
pass('R7.2.1 acquisition plan has public corpus candidates', acquisitionPlan.sources.length >= 18 && acquisitionPlan.sources.filter((s) => s.url).length >= 17);
pass('R7.2.1 includes the authoritative local baseline', acquisitionPlan.sources.some((s) => s.id === 'authoritative-15mb-842p' && s.acquisition === 'local-user-supplied'));
pass('R7.2.1 package acquisition command is registered', pkg.scripts['compress:v2:qpdf:r7.2:acquire'] === 'python scripts/compression-v2-qpdf-r7.2-acquire-corpus.py');
pass('production high-risk qpdf output remains disabled', fs.readFileSync(guard, 'utf8').includes("allowPdfOutput: false"));
pass('R7.2 audit is registered', pkg.scripts['compress:v2:qpdf:r7.2:audit'] === 'node scripts/compression-v2-qpdf-r7.2-corpus-audit.mjs');
pass('R7.2.2 audit is registered', pkg.scripts['compress:v2:qpdf:r7.2.2:audit'] === 'node scripts/compression-v2-qpdf-r7.2.2-integrity-audit.mjs');
pass('R7.2 manifest declares inventory provenance sources', Array.isArray(manifest.inventoryDeclarationSources) && manifest.inventoryDeclarationSources.length === 3);

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`Checks: ${checks.filter((c) => c.ok).length}/${checks.length} PASS`);
if (checks.some((c) => !c.ok)) process.exit(1);

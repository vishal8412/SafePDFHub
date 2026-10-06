#!/usr/bin/env node
/**
 * R7.5.1 — Corpus Parser Compatibility & Authoritative Baseline Binding audit.
 * Static + executable regression checks. No qpdf execution and no threshold mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const inventoryPath = path.join(root, 'scripts/compression-v2-qpdf-r7.2-corpus-inventory.py');
const preflightPath = path.join(root, 'scripts/compression-v2-qpdf-r7.5-clean-corpus-preflight.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const inventory = fs.readFileSync(inventoryPath, 'utf8');
const preflight = fs.readFileSync(preflightPath, 'utf8');

ok('inventory:exists', fs.existsSync(inventoryPath));
ok('preflight:exists', fs.existsSync(preflightPath));
ok('package:r7.5.1:audit', Boolean(pkg.scripts?.['compress:v2:qpdf:r7.5.1:audit']));
ok('inventory:distinguishes-pymupdf-only', inventory.includes('"pymupdf-only"') && inventory.includes('record["parserDisagreement"] = None'));
ok('inventory:distinguishes-pypdf-only', inventory.includes('"pypdf-only"') && inventory.includes('record["parserDisagreement"] = None'));
ok('inventory:true-page-mismatch-only', inventory.includes('"PAGE_COUNT_MISMATCH"'));
ok('inventory:both-failed-is-hard-state', inventory.includes('"BOTH_PARSERS_FAILED"'));
ok('inventory:authoritative-sha-binding', inventory.includes('AUTHORITATIVE_SHA') && inventory.includes('authoritative-15mb-842p'));
ok('inventory:authoritative-size-pages-binding', inventory.includes('15_513_995') && inventory.includes('expectedPages'));
ok('preflight:does-not-reject-fallback-parsers', preflight.includes('INVENTORY_BOTH_PARSERS_FAILED') && preflight.includes('INVENTORY_TRUE_PARSER_DISAGREEMENTS_PRESENT') && !preflight.includes("summary.parserDisagreements || 0) > 0) failures.push('INVENTORY_PARSER_DISAGREEMENTS_PRESENT'"));
ok('preflight:keeps-fallback-as-warning', preflight.includes('PY_PDF_COMPATIBILITY_FALLBACK') && preflight.includes('PYMUPDF_COMPATIBILITY_FALLBACK'));
ok('no-threshold-mutation', !inventory.includes('QPDF_WASM_RESOURCE_THRESHOLDS') && !preflight.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));

const py = spawnSync('python', ['-m', 'py_compile', inventoryPath], { encoding: 'utf8' });
ok('inventory:python-syntax', py.status === 0, py.stderr || '');
const js = spawnSync(process.execPath, ['--check', preflightPath], { encoding: 'utf8' });
ok('preflight:javascript-syntax', js.status === 0, js.stderr || '');

// Executable semantic regression: the inventory source must classify both parser fallbacks
// without converting them into parser disagreement. This is intentionally source-level because
// the release snapshot has no benchmark PDFs and must not fabricate corpus evidence.
ok('semantic:parser-fallbacks-not-disagreement',
  inventory.match(/pypdf-only/g)?.length >= 1 &&
  inventory.match(/pymupdf-only/g)?.length >= 1 &&
  inventory.includes('record["parserDisagreement"] = None'));

const passed = checks.filter(c => c.pass).length;
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`R7.5.1 audit: ${passed}/${checks.length} PASS`);
process.exitCode = passed === checks.length ? 0 : 1;

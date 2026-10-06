#!/usr/bin/env node
/**
 * R7.5 — Clean Full-Corpus Benchmark Preflight
 *
 * Fails closed. It verifies that the corpus is sufficiently populated and
 * provenance-safe before the real-browser R7 matrix is allowed to run.
 * It never infers observed resource risk from file size/page count.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const CORPUS = path.join(ROOT, 'benchmark-corpus', 'qpdf-r7');
const MANIFEST = path.join(CORPUS, 'corpus-manifest.json');
const PLAN = path.join(CORPUS, 'corpus-acquisition-plan.json');
const INVENTORY = path.join(CORPUS, 'r7.2-corpus-inventory.json');
const OUTPUT = path.join(ROOT, 'benchmark-results', 'qpdf-r7.5-clean-corpus-preflight.json');

const REQUIRED = { low: 5, elevated: 8, high: 5, boundary: 12 };
const REQUIRED_ROLES = ['file-pages', 'file-size', 'page-count', 'stream-bytes', 'image-bytes', 'object-count'];
const AUTHORITATIVE_SHA = '775929bf05792007ae123b17ff6991007149055032fc9baa315afd79a3a74e3d';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function walkPdfs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPdfs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}
function main() {
  const failures = [];
  const warnings = [];
  if (!fs.existsSync(MANIFEST)) failures.push('MISSING_CORPUS_MANIFEST');
  if (!fs.existsSync(PLAN)) failures.push('MISSING_CORPUS_ACQUISITION_PLAN');
  if (!fs.existsSync(CORPUS)) failures.push('MISSING_CORPUS_DIRECTORY');
  if (failures.length) return emit({ state: 'blocked', failures, warnings, documents: 0 });

  const manifest = readJson(MANIFEST);
  const plan = readJson(PLAN);
  const pdfs = walkPdfs(CORPUS);
  const inventory = fs.existsSync(INVENTORY) ? readJson(INVENTORY) : null;
  const seen = new Map();
  let duplicateHashes = 0;
  let authoritativePresent = false;

  for (const file of pdfs) {
    const hash = sha256(file);
    if (seen.has(hash)) duplicateHashes++;
    else seen.set(hash, file);
    if (hash === AUTHORITATIVE_SHA) authoritativePresent = true;
  }
  if (duplicateHashes) failures.push(`DUPLICATE_PDF_SHA256:${duplicateHashes}`);
  if (!authoritativePresent) failures.push('AUTHORITATIVE_15MB_842P_BASELINE_MISSING');

  const declared = Array.isArray(plan.sources) ? plan.sources : [];
  const candidateCounts = { low: 0, elevated: 0, high: 0 };
  const boundaryRoles = new Set();
  for (const item of declared) {
    const risk = String(item.riskCandidate || '');
    if (risk === 'low') candidateCounts.low++;
    if (risk.startsWith('elevated')) candidateCounts.elevated++;
    if (risk === 'high') candidateCounts.high++;
    for (const role of item.boundaryRoles || []) boundaryRoles.add(role);
  }
  for (const role of REQUIRED_ROLES) if (!boundaryRoles.has(role)) failures.push(`MISSING_DECLARED_BOUNDARY_ROLE:${role}`);

  // Candidate counts describe the approved acquisition plan only. They are not observed production resource risk.
  if (pdfs.length < REQUIRED.low + REQUIRED.elevated + 1) {
    failures.push(`CORPUS_DOCUMENT_COUNT_TOO_LOW:${pdfs.length}`);
  }

  if (!inventory) {
    failures.push('R7.2_INVENTORY_MISSING');
  } else {
    const summary = inventory.summary || {};
    if (Number(summary.documents || 0) !== pdfs.length) failures.push('INVENTORY_DOCUMENT_COUNT_MISMATCH');
    if (Number(summary.bothParsersFailed || 0) > 0) failures.push('INVENTORY_BOTH_PARSERS_FAILED');
    if (Number(summary.trueParserDisagreements ?? summary.parserDisagreements ?? 0) > 0) failures.push('INVENTORY_TRUE_PARSER_DISAGREEMENTS_PRESENT');
    if (Number(summary.publishedSha256Mismatches || 0) > 0) failures.push('INVENTORY_PUBLISHED_SHA256_MISMATCH');
  }

  // R7.5 must never silently run a partial corpus. Candidate plan completeness is required,
  // but observed risk counts are established only after the browser benchmark telemetry exists.
  if (candidateCounts.low < REQUIRED.low) failures.push(`ACQUISITION_PLAN_LOW_TARGET_UNDERSPECIFIED:${candidateCounts.low}`);
  if (candidateCounts.elevated < REQUIRED.elevated) failures.push(`ACQUISITION_PLAN_ELEVATED_TARGET_UNDERSPECIFIED:${candidateCounts.elevated}`);
  if (candidateCounts.high < REQUIRED.high) failures.push(`ACQUISITION_PLAN_HIGH_TARGET_UNDERSPECIFIED:${candidateCounts.high}`);

  if (inventory && Number(inventory.summary?.pypdfOnly || 0) > 0) warnings.push(`PY_PDF_COMPATIBILITY_FALLBACK:${inventory.summary.pypdfOnly}`);
  if (inventory && Number(inventory.summary?.pymupdfOnly || 0) > 0) warnings.push(`PYMUPDF_COMPATIBILITY_FALLBACK:${inventory.summary.pymupdfOnly}`);

  const state = failures.length ? 'blocked-corpus-incomplete' : 'ready-for-clean-benchmark';
  return emit({
    state,
    failures,
    warnings,
    documents: pdfs.length,
    authoritativePresent,
    authoritativeSha256: AUTHORITATIVE_SHA,
    candidatePlanCounts: candidateCounts,
    requiredTargets: REQUIRED,
    requiredBoundaryRoles: REQUIRED_ROLES,
    observedRiskCounts: null,
    calibrationEligible: false,
    note: 'Observed low/elevated/high resource risk is established only by the real-browser R7 telemetry. R7.5 preflight never infers it from size/page metadata.'
  });
}
function emit(payload) {
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), benchmark: 'SafePDFHub Compression V2 — R7.5 Clean Full-Corpus R7 Benchmark', ...payload };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report.state === 'ready-for-clean-benchmark' ? 0 : 2;
}
process.exitCode = main();

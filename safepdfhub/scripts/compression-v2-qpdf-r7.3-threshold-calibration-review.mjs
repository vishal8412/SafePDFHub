import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportArg = process.argv.slice(2).find((value) => value.startsWith('--report='));
const inventoryArg = process.argv.slice(2).find((value) => value.startsWith('--inventory='));
const reportPath = reportArg
  ? path.resolve(root, reportArg.slice('--report='.length))
  : path.resolve(root, 'benchmark-results/qpdf-r7-capability-matrix/qpdf-r7-capability-matrix.json');
const inventoryPath = inventoryArg
  ? path.resolve(root, inventoryArg.slice('--inventory='.length))
  : path.resolve(root, 'benchmark-corpus/qpdf-r7/r7.2-corpus-inventory.json');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const matrix = read('scripts/compression-v2-qpdf-r7-capability-matrix.py');
const manifest = JSON.parse(read('benchmark-corpus/qpdf-r7/corpus-manifest.json'));
const pkg = JSON.parse(read('package.json'));

const checks = [];
const findings = [];
const pass = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const finding = (severity, message) => findings.push({ severity, message });

const requiredThresholdFragments = [
  'fileBytes: 12 * 1024 * 1024',
  'pages: 500',
  'fileBytes: 25 * 1024 * 1024',
  'pages: 1_500',
  'streamBytes: 64 * 1024 * 1024',
  'imageBytes: 32 * 1024 * 1024',
  'objectCount: 20_000',
  'fileBytes: 8 * 1024 * 1024',
  'pages: 300',
  'fileBytes: 12 * 1024 * 1024',
  'pages: 1_000',
  'streamBytes: 32 * 1024 * 1024',
  'imageBytes: 16 * 1024 * 1024',
  'objectCount: 10_000',
];

pass('R7.3 review is registered as a package script', pkg.scripts['compress:v2:qpdf:r7.3:review'] === 'node scripts/compression-v2-qpdf-r7.3-threshold-calibration-review.mjs');
pass('corpus policy disables automatic threshold changes', manifest?.policy?.automaticThresholdChanges === false);
pass('R7 benchmark remains evidence-only', matrix.includes('automaticThresholdChanges') && matrix.includes('False'));
pass('production guard uses centralized thresholds', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
pass('all current threshold values remain encoded', requiredThresholdFragments.every((fragment) => guard.includes(fragment)));
pass('high-risk qpdf PDF output remains disabled', guard.includes("risk: 'high'") && guard.includes('allowPdfOutput: false'));
pass('elevated-risk qpdf PDF output remains enabled', guard.includes("risk: 'elevated'") && guard.includes('allowPdfOutput: true'));
pass('low-risk qpdf PDF output remains enabled', guard.includes("risk: 'low'") && guard.includes('allowPdfOutput: true'));

const hasReport = fs.existsSync(reportPath);
const hasInventory = fs.existsSync(inventoryPath);

let report = null;
let cases = [];
if (!hasReport) {
  finding('blocking', `No complete R7 capability-matrix JSON was found at ${path.relative(root, reportPath)}.`);
  finding('blocking', 'A partial console excerpt is not sufficient for threshold calibration because it cannot establish full corpus coverage, repeated observations, or boundary-stratum completeness.');
} else {
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    cases = Array.isArray(report?.cases) ? report.cases : [];
    pass('benchmark result artifact is valid JSON', true);
  } catch (error) {
    pass('benchmark result artifact is valid JSON', false);
    finding('blocking', `Benchmark result artifact could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (hasReport && report) {
  const uniqueSources = new Set(cases.map((item) => item?.source).filter(Boolean));
  const requiredRiskClasses = ['low', 'elevated', 'high'];
  const observedRisks = new Set(cases.map((item) => item?.qpdf?.resourceRisk).filter((risk) => typeof risk === 'string'));
  const completeCases = cases.filter((item) => item?.qpdf?.calibrationEvidenceComplete === true && item?.qpdf?.resourceSignalsUsable === true);
  const boundaryCases = cases.filter((item) => item?.boundaryEvidence === true || item?.qpdf?.boundaryEvidence === true);
  const contradictoryCases = cases.filter((item) => Array.isArray(item?.qpdf?.contradictions) && item.qpdf.contradictions.length > 0);
  const oomCases = cases.filter((item) => item?.qpdf?.outcome === 'oom');
  const certifiedCases = cases.filter((item) => item?.qpdf?.outcome === 'smaller-certified');
  const attemptedCases = cases.filter((item) => item?.qpdf?.attempted === true);

  pass('benchmark contains cases', cases.length > 0);
  pass('benchmark has all required risk classes', requiredRiskClasses.every((risk) => observedRisks.has(risk)));
  pass('benchmark cases have usable calibration resource signals', completeCases.length === cases.length);
  pass('benchmark has no evidence contradictions', contradictoryCases.length === 0);
  pass('benchmark has declared boundary evidence', boundaryCases.length >= manifest.targets.boundary.minimumDocuments);

  for (const risk of requiredRiskClasses) {
    const count = [...uniqueSources].filter((source) => cases.some((item) => item.source === source && item?.qpdf?.resourceRisk === risk)).length;
    const target = manifest.targets[risk]?.minimumDocuments ?? 0;
    if (count < target) {
      finding('blocking', `${risk}: ${count} unique source document(s) represented; minimum target is ${target}.`);
    } else {
      finding('info', `${risk}: ${count} unique source document(s) represented.`);
    }
  }

  if (completeCases.length !== cases.length) {
    finding('blocking', `${cases.length - completeCases.length}/${cases.length} case(s) lack fully usable resource-signal evidence.`);
  }
  if (contradictoryCases.length > 0) {
    finding('blocking', `${contradictoryCases.length} case(s) contain qpdf evidence contradictions.`);
  }
  if (boundaryCases.length < manifest.targets.boundary.minimumDocuments) {
    finding('blocking', `${boundaryCases.length} boundary case(s) are explicitly marked; minimum target is ${manifest.targets.boundary.minimumDocuments}.`);
  }

  finding('info', `Observed ${uniqueSources.size} unique source document(s), ${cases.length} level/case result(s), ${attemptedCases.length} qpdf-attempted case(s), ${oomCases.length} qpdf-OOM case(s), and ${certifiedCases.length} certified-smaller qpdf case(s).`);
  finding('blocking', 'Threshold changes require repeated observations around each independent guard signal boundary (file+pages, file size, page count, stream bytes, image bytes, and object count). A general success/failure rate is insufficient.');
}

if (hasInventory) {
  try {
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const documents = Array.isArray(inventory?.documents) ? inventory.documents : [];
    finding('info', `Corpus inventory contains ${documents.length} document record(s).`);
    if (documents.length === 0) {
      finding('blocking', 'Corpus inventory contains no populated document records.');
    }
  } catch (error) {
    finding('blocking', `Corpus inventory could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  finding('blocking', `Corpus inventory was not found at ${path.relative(root, inventoryPath)}.`);
}

const blocking = findings.filter((item) => item.severity === 'blocking');
const status = blocking.length === 0 ? 'review-ready-no-change' : 'not-calibratable';

console.log(`QPDF-R7.3 threshold calibration review: ${status}`);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
for (const item of findings) console.log(`${item.severity.toUpperCase()} ${item.message}`);
console.log(`Checks: ${checks.filter((item) => item.ok).length}/${checks.length} PASS`);
console.log('Threshold changes applied: NO');
console.log(`Calibration eligible: ${status === 'review-ready-no-change' ? 'MANUAL REVIEW ONLY' : 'NO'}`);

if (checks.some((item) => !item.ok)) process.exit(1);
// Insufficient corpus evidence is an expected safety outcome, not an audit failure.
process.exit(0);

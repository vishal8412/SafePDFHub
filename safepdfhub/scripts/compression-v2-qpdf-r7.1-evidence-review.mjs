import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportArg = process.argv.slice(2).find((value) => value.startsWith('--report='));
const reportPath = reportArg
  ? path.resolve(root, reportArg.slice('--report='.length))
  : path.resolve(root, 'benchmark-results/qpdf-r7-capability-matrix/qpdf-r7-capability-matrix.json');

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const guard = read('src/app/core/qpdf/qpdf-wasm-resource-guard.service.ts');
const r7 = read('scripts/compression-v2-qpdf-r7-capability-matrix.py');
const r7Audit = read('scripts/compression-v2-qpdf-r7-audit.mjs');
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

pass('R7.1 audit is registered as a package script', pkg.scripts['compress:v2:qpdf:r7.1:audit'] === 'node scripts/compression-v2-qpdf-r7.1-evidence-review.mjs');
pass('R7 remains evidence-only', r7.includes('automaticThresholdChanges') && r7.includes('False'));
pass('R7 exposes privacy-safe resource signals', r7.includes('resourceSignals'));
pass('R7 audit remains available', r7Audit.includes('qpdf_evidence'));
pass('production guard uses named threshold constants', guard.includes('QPDF_WASM_RESOURCE_THRESHOLDS'));
pass('all current threshold values remain encoded', requiredThresholdFragments.every((fragment) => guard.includes(fragment)));
pass('high-risk PDF output remains disabled', guard.includes("risk: 'high'") && guard.includes('allowPdfOutput: false'));
pass('elevated-risk PDF output remains enabled', guard.includes("risk: 'elevated'") && guard.includes('allowPdfOutput: true'));
pass('low-risk PDF output remains enabled', guard.includes("risk: 'low'") && guard.includes('allowPdfOutput: true'));

const evidenceAvailable = fs.existsSync(reportPath);
if (!evidenceAvailable) {
  finding('blocking', `R7 result artifact was not found at ${path.relative(root, reportPath)}.`);
  finding('blocking', 'No low/elevated R7 workload outcomes can be independently reviewed from the supplied snapshot.');
  finding('blocking', 'Threshold calibration is therefore not eligible; the production guard must remain unchanged.');
} else {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const cases = Array.isArray(report.cases) ? report.cases : [];
  const risks = new Map();
  for (const item of cases) {
    const risk = item?.qpdf?.resourceRisk;
    const key = typeof risk === 'string' ? risk : 'unknown';
    const bucket = risks.get(key) ?? { cases: 0, attempted: 0, blocked: 0, oom: 0, smallerCertified: 0, signals: 0 };
    bucket.cases += 1;
    bucket.attempted += Number(Boolean(item?.qpdf?.attempted));
    bucket.blocked += Number(item?.qpdf?.outcome === 'blocked-high-risk');
    bucket.oom += Number(item?.qpdf?.outcome === 'oom');
    bucket.smallerCertified += Number(item?.qpdf?.outcome === 'smaller-certified');
    bucket.signals += Number(Boolean(item?.qpdf?.resourceSignals));
    risks.set(key, bucket);
  }

  for (const risk of ['low', 'elevated', 'high']) {
    const bucket = risks.get(risk);
    if (!bucket) {
      finding('blocking', `No R7 cases classified as ${risk}; this risk class cannot be calibrated.`);
    } else {
      finding('info', `${risk}: ${bucket.cases} case(s), ${bucket.attempted} attempted, ${bucket.blocked} blocked, ${bucket.oom} OOM, ${bucket.smallerCertified} smaller-certified, ${bucket.signals} with resource signals.`);
    }
  }

  const signalCoverage = cases.filter((item) => item?.qpdf?.resourceSignals).length;
  if (signalCoverage !== cases.length) {
    finding('blocking', `${cases.length - signalCoverage} R7 case(s) lack resourceSignals; exact threshold-trigger evidence is incomplete.`);
  }

  const highCases = cases.filter((item) => item?.qpdf?.resourceRisk === 'high');
  const highBlocked = highCases.filter((item) => item?.qpdf?.outcome === 'blocked-high-risk');
  if (highCases.length > 0 && highBlocked.length === highCases.length) {
    finding('info', `High-risk policy is empirically represented by ${highBlocked.length}/${highCases.length} blocked case(s).`);
  }

  if (cases.length === 0) {
    finding('blocking', 'R7 report contains no cases.');
  }

  // R7.1 deliberately does not infer a safe threshold from a single success or failure.
  finding('blocking', 'Threshold changes require boundary-near workloads for every independent guard signal and repeated successful/failing observations; R7.1 does not auto-change thresholds.');
}

const blocking = findings.filter((item) => item.severity === 'blocking');
const status = blocking.length === 0 ? 'review-ready' : 'not-calibratable';

console.log(`QPDF-R7.1 evidence review: ${status}`);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
for (const item of findings) console.log(`${item.severity.toUpperCase()} ${item.message}`);
console.log(`Checks: ${checks.filter((item) => item.ok).length}/${checks.length} PASS`);
console.log(`Calibration eligible: ${status === 'review-ready' ? 'YES' : 'NO'}`);

if (checks.some((item) => !item.ok)) process.exit(1);
// A missing or insufficient evidence corpus is an expected safety state, not an audit implementation failure.
process.exit(0);

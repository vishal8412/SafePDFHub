import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const route = read('src/app/app.routes.ts');
const service = read('src/app/core/qpdf/qpdf-runtime-investigation.service.ts');
const component = read('src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.ts');
const template = read('src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.html');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['R4 service exists', fs.existsSync(path.join(root, 'src/app/core/qpdf/qpdf-runtime-investigation.service.ts'))],
  ['R4 component exists', fs.existsSync(path.join(root, 'src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.ts'))],
  ['R4 template exists', fs.existsSync(path.join(root, 'src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.html'))],
  ['route is registered', route.includes('__dev/qpdf-runtime-investigation')],
  ['route is development-only', route.includes('canMatch: [() => isDevMode()]')],
  ['route lazy-loads R4 component', route.includes('qpdf-runtime-investigation/qpdf-runtime-investigation.component')],
  ['workload ladder exists', service.includes('[50, 100, 200, 400, 600]')],
  ['page-count probe exists', service.includes("'page-count'") && service.includes("--json") && service.includes("--json-key=pages")],
  ['page count is obtained through qpdf runtime', service.includes('runPageCountProbe') && service.includes('this.runtime.run(request)')],
  ['page-count probe supplies qpdf-run output name', service.includes('r4-page-count.json') && service.includes('outputs: [outputName]')],
  ['page-count probe parses qpdf JSON pages summary', service.includes('parsePageCountFromJson') && service.includes('Array.isArray(json.pages)')],
  ['page-count probe avoids invalid no-output qpdf-run request', !service.includes("args: ['--show-npages', inputName]") && !service.includes('outputs: [],')],
  ['no pdf-lib main-thread parse remains', !service.includes("from 'pdf-lib'") && !service.includes('PDFDocument.load')],
  ['parse/check probe exists', service.includes("'parse-check'")],
  ['minimal compression probe exists', service.includes("'compress-streams'")],
  ['workload preparation is qpdf page selection', service.includes("'--pages'") && service.includes('`1-${pageCount}`')],
  ['full-page workload reuses original input', service.includes('full-page workload uses the original file directly')],
  ['preparation uses dedicated probe type', service.includes("probe: 'workload-preparation'")],
  ['preparation result is surfaced in report', service.includes('preparation: QpdfInvestigationProbeResult | null')],
  ['page-count result is surfaced in report', service.includes('pageCountProbe: QpdfInvestigationProbeResult')],
  ['UI surfaces page-count status', template.includes('Page-count probe')],
  ['UI surfaces workload preparation status', template.includes('Workload preparation')],
  ['cancellation is surfaced', component.includes('async cancel()') && service.includes('async cancel()')],
  ['async UI state uses Angular signals', component.includes('signal(false)') && component.includes('statusMessage = signal') && component.includes('report = signal')],
  ['probe timeout guard exists', service.includes('INVESTIGATION_QPDF_TIMEOUT_MS') && service.includes('runWithTimeout')],
  ['timeout cancels qpdf runtime', service.includes('void this.runtime.cancel()')],
  ['timeout prevents repeated workload probing', service.includes('isTimeout(preparation.errorMessage)') && service.includes('break')],
  ['JSON report download exists', component.includes('downloadReport')],
  ['audit script registered', pkg.scripts['compress:v2:qpdf-runtime:r4:audit'] === 'node scripts/compression-v2-qpdf-runtime-r4-audit.mjs']
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`QPDF-R4.3 route audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

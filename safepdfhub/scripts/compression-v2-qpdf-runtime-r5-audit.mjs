import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const servicePath = 'src/app/core/qpdf/qpdf-runtime-investigation.service.ts';
const componentPath = 'src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.ts';
const templatePath = 'src/app/pages/dev/qpdf-runtime-investigation/qpdf-runtime-investigation.component.html';
const routePath = 'src/app/app.routes.ts';
const service = read(servicePath);
const component = read(componentPath);
const template = read(templatePath);
const route = read(routePath);
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['R5 service exists', fs.existsSync(path.join(root, servicePath))],
  ['R5 development page exists', fs.existsSync(path.join(root, componentPath))],
  ['R5 template exists', fs.existsSync(path.join(root, templatePath))],
  ['development route remains registered', route.includes('__dev/qpdf-runtime-investigation')],
  ['development route is dev-only', route.includes('canMatch: [() => isDevMode()]')],
  ['R5 schema version is 3', service.includes('schemaVersion: 3')],
  ['page-count probe uses JSON output', service.includes('--json') && service.includes('--json-key=pages') && service.includes('r5-page-count.json')],
  ['page-count probe supplies output name', service.includes('outputs: [outputName]')],
  ['page-count JSON is parsed locally', service.includes('parsePageCountFromJson') && service.includes('Array.isArray(json.pages)')],
  ['no pdf-lib workload preparation remains', !service.includes("from 'pdf-lib'") && !service.includes('copyPages') && !service.includes('--pages')],
  ['baseline PDF-output probe exists', service.includes("probe: 'baseline-output'") && service.includes("args: []")],
  ['baseline probe creates an output', service.includes('outputName = `r5-${definition.probe}.pdf`') && service.includes('outputs: [outputName]')],
  ['stream-compression probe is isolated', service.includes("probe: 'compress-streams'") && service.includes("'--compress-streams=y'")],
  ['Flate recompression probe is isolated', service.includes("probe: 'recompress-flate'") && service.includes('--decode-level=generalized') && service.includes('--recompress-flate') && service.includes('--compression-level=9')],
  ['object-stream probe is isolated', service.includes("probe: 'object-streams'") && service.includes('--object-streams=generate')],
  ['image optimization probe is isolated', service.includes("probe: 'image-optimize'") && service.includes('--optimize-images') && service.includes('--jpeg-quality=80')],
  ['each output probe uses original source bytes', service.includes('inputs: { [inputName]: new Uint8Array(sourceBytes) }')],
  ['each probe gets a fresh runtime invocation', service.includes('this.runtime.run(request)') && service.includes('runWithTimeout')],
  ['later probes are skipped after first boundary', service.includes('skippedResult') && service.includes('operations.push(...skipped)')],
  ['boundary is reported', service.includes('boundary: QpdfInvestigationProbe') && service.includes('boundary = result.probe')],
  ['skipped status is represented', service.includes("status: 'skipped'")],
  ['OOM classification remains explicit', service.includes("status: cancelled ? 'cancelled' : oom ? 'oom' : 'failed'")],
  ['runtime phase remains captured', service.includes('runtimePhase(error)')],
  ['probe arguments are included in evidence', service.includes('args: [...args]')],
  ['60-second qpdf watchdog remains active', service.includes('INVESTIGATION_QPDF_TIMEOUT_MS = 60_000') && service.includes('this.runtime.cancel()')],
  ['cancellation is exposed', component.includes('async cancel()') && service.includes('async cancel()')],
  ['R5 UI identifies runtime boundary', template.includes('QPDF-R5 — Runtime Boundary Resolution') && template.includes('First output boundary')],
  ['R5 UI displays operation status', template.includes('operation.status') && template.includes('operation.args.join')],
  ['JSON report filename is R5-specific', component.includes('qpdf-r5-runtime-boundary-investigation.json')],
  ['R5 audit is registered', pkg.scripts['compress:v2:qpdf-runtime:r5:audit'] === 'node scripts/compression-v2-qpdf-runtime-r5-audit.mjs'],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`QPDF-R5 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

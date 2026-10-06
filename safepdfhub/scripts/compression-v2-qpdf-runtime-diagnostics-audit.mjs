import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('src/app/core/qpdf/qpdf-wasm-runtime.service.ts');
const prototype = read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts');
const checks = [
  ['runtime error type exists', read('src/app/core/qpdf/qpdf-runtime-error.ts').includes('class QpdfRuntimeError')],
  ['runner creation is classified', read('src/app/core/qpdf/qpdf-wasm-runtime.service.ts').includes("'runner-create'" )],
  ['runner execution is classified', runtime.includes("'runner-run'" )],
  ['runner factory creation is wrapped', runtime.includes('runnerFactory.create()') && runtime.includes('QpdfRuntimeError')],
  ['runner execution is wrapped', runtime.includes('runner.run(request)') && runtime.includes('QpdfRuntimeError')],
  ['cancellation is not converted to candidate failure', prototype.includes('if (error.cancelled)')],
  ['structural service uses injected runner factory', read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts').includes('runnerFactory,')],
  ['runtime failure is wrapped structurally', read('src/app/core/qpdf/qpdf-wasm-prototype.service.ts').includes('QPDF_RUNNER_CREATE_FAILED')],
  ['runtime error name captured', read('src/app/core/compression/pdf-structural-optimization.service.ts').includes('runtimeErrorName')],
  ['runtime error message captured', read('src/app/core/compression/pdf-structural-optimization.service.ts').includes('runtimeErrorMessage')],
  ['raw stderr remains excluded', !read('src/app/core/compression/pdf-structural-optimization.service.ts').includes('runtimeErrorMessage: error.result?.stderr')],
  ['cancellation remains explicit', read('src/app/core/qpdf/qpdf-wasm-runtime.service.ts').includes('QPDF operation was cancelled.')],
  ['user-src absent from release tree', !fs.existsSync(path.join(root, 'user-src')),],
];
const passed = checks.filter(([, ok]) => ok).length;
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
console.log(`QPDF runtime diagnostics audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

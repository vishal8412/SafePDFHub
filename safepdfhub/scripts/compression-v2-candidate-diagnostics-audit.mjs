import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const structuralModels = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-structural-optimization.models.ts'), 'utf8');
const structuralService = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-structural-optimization.service.ts'), 'utf8');
const validationModels = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-structural-validation.models.ts'), 'utf8');
const qpdf = fs.readFileSync(path.join(root, 'src/app/core/qpdf/qpdf-wasm-prototype.service.ts'), 'utf8');
const telemetry = fs.readFileSync(path.join(root, 'src/app/core/compression/compression-telemetry.models.ts'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-structural-optimization.service.spec.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['diagnostic model exists', structuralModels.includes('PdfStructuralCandidateDiagnostic')],
  ['failure reason codes include qpdf execution', structuralModels.includes("'QPDF_EXECUTION_FAILED'")],
  ['failure reason codes include parse failure', structuralModels.includes("'PARSE_FAILED'")],
  ['structural validation is reasoned, not boolean-only', validationModels.includes('PdfStructuralValidationResult')],
  ['structural service records diagnostics', structuralService.includes('const diagnostics: PdfStructuralCandidateDiagnostic[]')],
  ['structural service records page mismatch reasons', structuralService.includes("'PAGE_COUNT_MISMATCH'") && structuralService.includes("'PAGE_GEOMETRY_MISMATCH'")],
  ['structural service records semantic rejection', structuralService.includes("'SEMANTIC_INTEGRITY_FAILED'")],
  ['structural service records non-smaller candidate', structuralService.includes("'CANDIDATE_NOT_SMALLER'")],
  ['qpdf exposes structured candidate failure', qpdf.includes('class QpdfStructuralCandidateError')],
  ['qpdf diagnostics do not expose raw stderr in telemetry', telemetry.toLowerCase().includes('privacy-safe structural candidate diagnostics')],
  ['engine forwards structural diagnostics into telemetry', engine.includes('structuralDiagnostics')],
  ['regression test covers qpdf failure diagnostics', spec.includes('records a qpdf execution failure')],
  ['package audit registered', pkg.scripts['compress:v2:candidate-diagnostics:audit'] === 'node scripts/compression-v2-candidate-diagnostics-audit.mjs'],
  ['user-src absent from release tree', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}`);
  if (ok) passed++;
}
console.log(`\nCompression V2 candidate diagnostics audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

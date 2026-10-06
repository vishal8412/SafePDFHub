import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'app');
const files = {
  models: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.models.ts'),
  service: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.service.ts'),
  qpdf: path.join(sourceRoot, 'core', 'qpdf', 'qpdf-wasm-prototype.service.ts'),
  engine: path.join(sourceRoot, 'core', 'engines', 'compress.engine.ts'),
  spec: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.service.spec.ts'),
  qpdfSpec: path.join(sourceRoot, 'core', 'qpdf', 'qpdf-wasm-prototype.service.spec.ts'),
  engineSpec: path.join(sourceRoot, 'core', 'engines', 'compress.engine.spec.ts'),
  package: path.join(root, 'package.json'),
};

let pass = 0;
let fail = 0;
function check(name, condition) {
  if (condition) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]),
);

check('V2.3 image model exists', source.models.includes('PdfImageOptimizationCandidate'));
check('Adaptive image optimization service exists', source.service.includes('class PdfImageOptimizationService'));
check('Forensic image resources drive eligibility', source.service.includes('forensic.imageResources'));
check('JPEG-only resources are skipped', source.service.includes('All detected image resources are already JPEG/DCT resources'));
check('Image risk classification exists', source.service.includes("PdfImageOptimizationRisk") && source.service.includes("'high'"));
check('Quality ladder is level-aware', source.service.includes('qualityLadder') && source.service.includes("case 'strong'"));
check('Multiple quality candidates are attempted', source.service.includes('decision.qualities.length'));
check('Actual output byte comparison is used', source.service.includes('candidate.outputBytes < file.size'));
check('Smallest valid image candidate is selected', source.service.includes('.sort((a, b) => a.outputBytes - b.outputBytes)[0]'));
check('Image candidate validation checks page count', source.service.includes('sourcePdf.getPageCount() !== outputPdf.getPageCount()'));
check('Image candidate validation checks geometry', source.service.includes('sourcePage.getWidth() - outputPage.getWidth()'));
check('Image candidate validation checks rotation', source.service.includes('sourceRotation !== outputRotation'));
check('Candidate failures are isolated', source.service.includes('failed quality') && source.service.includes('catch {'));
check('No page rasterization in V2.3', !source.service.includes('renderToImageBitmap') && !source.service.includes('PdfPageRendererService'));
check('qpdf image candidate API exists', source.qpdf.includes('optimizeImageCandidate'));
check('qpdf image optimization flag exists', source.qpdf.includes("'--optimize-images'"));
check('qpdf JPEG quality is bounded', source.qpdf.includes('Math.min(95, Math.max(40'));
check('Engine wires V2.3 image phase', source.engine.includes('this.imageOptimizer.optimize('));
check('Engine feeds image candidate into legacy strategy', source.engine.includes('optimizedBase'));
check('Engine keeps image candidate in final candidate set', source.engine.includes('imageCandidate,') && source.engine.includes('strategyCandidate'));
check('Engine reserves 30-45% progress for image phase', source.engine.includes('30 + Math.round(progress * 0.15)'));
check('V2.3 image service tests exist', source.spec.includes("PdfImageOptimizationService — V2.3"));
check('JPEG-only skip test exists', source.spec.includes('all images are already JPEG resources'));
check('Quality failure isolation test exists', source.spec.includes('continues when one quality candidate fails'));
check('qpdf V2.3 test exists', source.qpdfSpec.includes('V2.3 image candidate'));
check('Engine V2.3 integration test exists', source.engineSpec.includes('V2.3 image candidate'));
check('V2.3 audit script is registered', JSON.parse(source.package).scripts['compress:v23:audit'] === 'node scripts/compress-v23-audit.mjs');

console.log(`\nV2.3 audit: ${pass}/${pass + fail} PASS`);
process.exitCode = fail ? 1 : 0;

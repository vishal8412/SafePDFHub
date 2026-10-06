import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'app');
const files = {
  models: path.join(sourceRoot, 'core', 'compression', 'pdf-visual-fidelity.models.ts'),
  service: path.join(sourceRoot, 'core', 'compression', 'pdf-visual-fidelity.service.ts'),
  serviceSpec: path.join(sourceRoot, 'core', 'compression', 'pdf-visual-fidelity.service.spec.ts'),
  image: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.service.ts'),
  imageModel: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.models.ts'),
  imageSpec: path.join(sourceRoot, 'core', 'compression', 'pdf-image-optimization.service.spec.ts'),
  engine: path.join(sourceRoot, 'core', 'engines', 'compress.engine.ts'),
  package: path.join(root, 'package.json'),
};

let pass = 0;
let fail = 0;
function check(name, condition) {
  if (condition) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
}

const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));

check('V2.4 visual fidelity model exists', source.models.includes('PdfVisualFidelityResult'));
check('Visual status distinguishes pass/reject/skip', source.models.includes("'passed' | 'rejected' | 'skipped'"));
check('Per-page visual metrics exist', source.models.includes('meanAbsoluteError') && source.models.includes('changedPixelRatio'));
check('Visual fidelity service exists', source.service.includes('class PdfVisualFidelityService'));
check('PDF.js loader is used', source.service.includes('PdfJsLoaderService'));
check('Source samples are cached per File', source.service.includes('WeakMap<File, Promise<RenderedSample[]>>'));
check('Sample count is bounded', source.service.includes('maxSamplePages = 6'));
check('Render pixel budget is bounded', source.service.includes('maxRenderPixels = 700_000'));
check('Forensic pages drive sample selection', source.service.includes('forensic?.sampledPages'));
check('Image-heavy pages are prioritized', source.service.includes('imageAreaRatio') && source.service.includes('imageOperatorCount'));
check('Source and candidate are both rendered', source.service.includes('renderSourceSamples') && source.service.includes('compareRenderedSample'));
check('Canvas rendering is browser-safe', source.service.includes("typeof OffscreenCanvas !== 'undefined'") && source.service.includes("typeof document !== 'undefined'"));
check('Pixel comparison uses RGB difference', source.service.includes('Math.abs(source[index] - candidate[index])'));
check('Changed-pixel threshold exists', source.service.includes('changedThreshold = 12 / 255'));
check('Level-specific fidelity thresholds exist', source.service.includes("case 'light'") && source.service.includes("case 'recommended'") && source.service.includes("case 'strong'"));
check('Visual failure rejects candidate', source.service.includes("status: 'rejected'") && source.service.includes('Visual validation could not be completed'));
check('Image candidate model stores visual result', source.imageModel.includes('visualFidelity: PdfVisualFidelityResult | null'));
check('Image optimizer invokes visual validation', source.image.includes('this.visualFidelity.validate('));
check('Structural validation remains required', source.image.includes('const structuralValid = await this.validateCandidate'));
check('Candidate validity requires visual pass', source.image.includes("visualFidelity?.status === 'passed'"));
check('Smallest valid candidate remains selected', source.image.includes('candidate.outputBytes < file.size') && source.image.includes('sort((a, b) => a.outputBytes - b.outputBytes)'));
check('No rasterizer introduced into image optimizer', !source.image.includes('PdfPageRendererService') && !source.image.includes('renderToImageBitmap'));
check('Visual service tests exist', source.serviceSpec.includes('PdfVisualFidelityService — V2.4'));
check('Rendering failure test exists', source.serviceSpec.includes('browser rendering is unavailable'));
check('No-sample skip test exists', source.serviceSpec.includes('no forensic sample pages'));
check('Image service tests updated for visual dependency', source.imageSpec.includes('PdfVisualFidelityService'));
check('Image candidate test provides visual pass', source.imageSpec.includes("status: 'passed'"));
check('Engine continues to use V2.3 image optimizer', source.engine.includes('this.imageOptimizer.optimize('));
check('Package registers V2.4 audit', JSON.parse(source.package).scripts['compress:v24:audit'] === 'node scripts/compress-v24-audit.mjs');
check('V2.4 remains browser-side', source.service.includes('PDF.js') && !source.service.includes('fetch('));

console.log(`\nV2.4 audit: ${pass}/${pass + fail} PASS`);
process.exitCode = fail ? 1 : 0;

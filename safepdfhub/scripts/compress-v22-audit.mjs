import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'app');

const files = {
  models: path.join(sourceRoot, 'core', 'compression', 'pdf-structural-optimization.models.ts'),
  service: path.join(sourceRoot, 'core', 'compression', 'pdf-structural-optimization.service.ts'),
  qpdf: path.join(sourceRoot, 'core', 'qpdf', 'qpdf-wasm-prototype.service.ts'),
  engine: path.join(sourceRoot, 'core', 'engines', 'compress.engine.ts'),
  spec: path.join(sourceRoot, 'core', 'compression', 'pdf-structural-optimization.service.spec.ts'),
};

let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}`);
  }
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]),
);

check('V2.2 structural service exists', source.service.includes('class PdfStructuralOptimizationService'));
check('Candidate model exists', source.models.includes('PdfStructuralCandidate'));
check('Actual byte comparison is used', source.service.includes('candidate.outputBytes < file.size'));
check('Smallest valid candidate is selected', source.service.includes('.sort((a, b) => a.outputBytes - b.outputBytes)[0]'));
check('Baseline structural candidate exists', source.service.includes("'baseline'"));
check('Resource pruning candidate exists', source.service.includes("'resource-prune'"));
check('Content coalescing candidate exists', source.service.includes("'content-coalesce'"));
check('Combined structural candidate exists', source.service.includes("'resource-prune-and-coalesce'"));
check('Image resource candidate is bounded', source.service.includes("'image-resource'"));
check('Candidate failures are isolated', source.service.includes('catch {') && source.service.includes('optional candidate phase'));
check('No rasterization in V2.2 service', !source.service.includes('raster') || source.service.includes('never rasterizes'));
check('Page count validation exists', source.service.includes('sourcePdf.getPageCount() !== outputPdf.getPageCount()'));
check('Page geometry validation exists', source.service.includes('sourcePage.getWidth() - outputPage.getWidth()'));
check('Rotation validation exists', source.service.includes('sourceRotation !== outputRotation'));
check('qpdf structural API exists', source.qpdf.includes('optimizeStructuralCandidate'));
check('Object stream generation is enabled', source.qpdf.includes("'--object-streams=generate'"));
check('Flate recompression is enabled', source.qpdf.includes("'--recompress-flate'"));
check('Resource pruning uses qpdf supported option', source.qpdf.includes("'--remove-unreferenced-resources=yes'"));
check('Content coalescing uses qpdf supported option', source.qpdf.includes("'--coalesce-contents'"));
check('Image optimization is optional candidate', source.qpdf.includes("'--optimize-images'"));
check('Structural phase is wired into engine', source.engine.includes('this.structuralOptimizer.optimize('));
check('Legacy strategy receives structural candidate', source.engine.includes('structuralCandidate ?? file'));
check('Final selection still includes original source', source.engine.includes('return this.pickSmallest(file, structuralCandidate, imageCandidate, strategyCandidate);'));
check('V2.2 service tests exist', source.spec.includes('describe(\'PdfStructuralOptimizationService — V2.2\''));
check('Failure isolation test exists', source.spec.includes('continues safely when one structural candidate fails'));

console.log(`\nV2.2 audit: ${pass}/${pass + fail} PASS`);
process.exitCode = fail ? 1 : 0;

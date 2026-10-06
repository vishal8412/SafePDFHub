import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const pass = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const model = read('src/app/core/compression/pdf-semantic-integrity.models.ts');
const service = read('src/app/core/compression/pdf-semantic-integrity.service.ts');
const structural = read('src/app/core/compression/pdf-structural-optimization.service.ts');
const structuralModel = read('src/app/core/compression/pdf-structural-optimization.models.ts');
const image = read('src/app/core/compression/pdf-image-optimization.service.ts');
const imageModel = read('src/app/core/compression/pdf-image-optimization.models.ts');
const spec = read('src/app/core/compression/pdf-semantic-integrity.service.spec.ts');
const packageJson = JSON.parse(read('package.json'));

pass('V2.5 semantic model exists', model.includes("PdfSemanticIntegrityResult") && model.includes("'passed' | 'rejected' | 'skipped'"));
pass('Semantic service exists', service.includes('class PdfSemanticIntegrityService'));
pass('Semantic service is browser-safe via PDF.js loader', service.includes('PdfJsLoaderService') && service.includes('this.pdfJsLoader.load()'));
pass('Page count is validated', service.includes('getPageCount() === candidatePdf.getPageCount()'));
pass('Page geometry is validated', service.includes('comparePageGeometry'));
pass('Rotation is validated', service.includes('getRotation().angle'));
pass('Document metadata is validated', service.includes('compareMetadata') && service.includes('getProducer()'));
pass('Text extraction is compared', service.includes('getTextContent') && service.includes('textMatched'));
pass('Text normalization is deterministic', service.includes('replace(/\\s+/g, \' \')'));
pass('Annotation/form signatures are compared', service.includes('getAnnotations') && service.includes('annotationSignature'));
pass('Widget field semantics are represented', service.includes('fieldType') && service.includes('fieldName') && service.includes('fieldValue'));
pass('Sample size is bounded', service.includes('maxSamplePages = 8'));
pass('Forensic sample pages drive selection', service.includes('forensic?.sampledPages'));
pass('No-forensic fallback sample exists', service.includes('return pageCount > 0 ? [1] : []'));
pass('High-information pages are prioritized', service.includes('imageAreaRatio') && service.includes('imageOperatorCount'));
pass('Semantic validation fails closed', service.includes("status: 'rejected'") && service.includes('Semantic validation could not be completed'));
pass('Structural candidate requires semantic pass', structural.includes('semanticIntegrity.validate') && structural.includes("semanticIntegrity?.status === 'passed'"));
pass('Structural candidate stores semantic result', structuralModel.includes('semanticIntegrity: PdfSemanticIntegrityResult | null'));
pass('Image candidate requires semantic pass', image.includes('semanticIntegrity.validate') && image.includes("semanticIntegrity?.status === 'passed'"));
pass('Image candidate stores semantic result', imageModel.includes('semanticIntegrity: PdfSemanticIntegrityResult | null'));
pass('Visual fidelity remains required for image candidates', image.includes("visualFidelity?.status === 'passed'"));
pass('Structural validation remains required', structural.includes('validateCandidate(source, output)'));
pass('Candidate byte-size selection remains intact', structural.includes('outputBytes - b.outputBytes') && image.includes('outputBytes - b.outputBytes'));
pass('Semantic service regression spec exists', fs.existsSync(path.join(root, 'src/app/core/compression/pdf-semantic-integrity.service.spec.ts')));
pass('Text mismatch regression is covered', spec.includes("rejects when sampled text changes") && spec.includes("status).toBe('rejected')"));
pass('No-forensic fallback regression is covered', spec.includes("falls back to the first page when forensic samples are unavailable"));
pass('V2.5 audit is registered', packageJson.scripts?.['compress:v25:audit'] === 'node scripts/compress-v25-audit.mjs');

const failures = checks.filter(x => !x.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\nV2.5 audit: ${checks.length - failures.length}/${checks.length} PASS`);
process.exit(failures.length ? 1 : 0);

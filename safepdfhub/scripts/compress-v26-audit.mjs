import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = path.join(root, 'src/app/core/compression/pdf-final-integrity.service.ts');
const models = path.join(root, 'src/app/core/compression/pdf-final-integrity.models.ts');
const engine = path.join(root, 'src/app/core/engines/compress.engine.ts');
const pkg = path.join(root, 'package.json');
const spec = path.join(root, 'src/app/core/compression/pdf-final-integrity.service.spec.ts');

const checks = [
  ['V2.6 integrity models exist', fs.existsSync(models)],
  ['V2.6 final integrity service exists', fs.existsSync(service)],
  ['V2.6 final integrity spec exists', fs.existsSync(spec) && read(spec).includes('PdfFinalIntegrityService — V2.6')],
  ['Final integrity service is injectable', read(service).includes("@Injectable({ providedIn: 'root' })")],
  ['Final integrity service uses PDF.js', read(service).includes('PdfJsLoaderService')],
  ['Final integrity service compares every page', read(service).includes('for (let pageNumber = 1; pageNumber <= sourcePageCount; pageNumber += 1)')],
  ['Final integrity checks text', read(service).includes('sourceNormalizedText === candidateNormalizedText')],
  ['Final integrity checks annotations', read(service).includes('sourceAnnotationSignature === candidateAnnotationSignature')],
  ['Final integrity checks geometry', read(service).includes('comparePageGeometry(sourcePdf, candidatePdf)')],
  ['Final integrity checks metadata', read(service).includes('compareMetadata(sourcePdf, candidatePdf)')],
  ['Final integrity is fail-closed', read(service).includes("status: 'rejected'") && read(service).includes('could not be completed')],
  ['Final integrity destroys PDF.js documents', read(service).includes('sourceJs.destroy?.()') && read(service).includes('candidateJs.destroy?.()')],
  ['Engine retains V2.6 certification architecture', read(engine).includes('PdfCandidateCertificationService') || read(engine).includes('PdfFinalIntegrityService')],
  ['Engine certifies candidates before return', read(engine).includes('this.candidateCertification.certifySmallest(') || read(engine).includes('this.finalIntegrity.certify(')],
  ['Engine orders candidates by actual size', read(engine).includes('.sort((a, b) => a.size - b.size)') || read(path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.ts')).includes('.sort((a, b) => a.size - b.size)')],
  ['Engine only certifies smaller candidates', read(engine).includes('candidate.size < file.size') || read(path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.ts')).includes('candidate.size < source.size')],
  ['Engine falls back to original', read(engine).includes('return file;')],
  ['V2.6 audit script registered', read(pkg).includes('compress:v26:audit')],
  ['No user-src included in release source tree', !fs.existsSync(path.join(root, 'user-src'))],
];

function read(file) { return fs.readFileSync(file, 'utf8'); }

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`V2.6 audit: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exit(1);

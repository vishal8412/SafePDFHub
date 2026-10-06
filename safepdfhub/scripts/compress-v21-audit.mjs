#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
}

const models = read('src/app/core/compression/pdf-forensic.models.ts');
const analyzer = read('src/app/core/compression/pdf-forensic-analyzer.service.ts') + read('src/app/core/compression/pdf-forensic-analyzer-core.ts');
const pdfAnalyzer = read('src/app/core/compression/pdf-analyzer.service.ts');
const analysisModels = read('src/app/core/compression/pdf-analysis.models.ts');
const spec = read('src/app/core/compression/pdf-forensic-analyzer.service.spec.ts');
const analyzerSpec = read('src/app/core/compression/pdf-analyzer.service.spec.ts');

check('V2.1 forensic model exists', exists('src/app/core/compression/pdf-forensic.models.ts'));
check('Forensic analyzer service exists', exists('src/app/core/compression/pdf-forensic-analyzer.service.ts'));
check('Document object/stream metrics are represented', /objectCount:\s*number[\s\S]*streamObjectCount:\s*number[\s\S]*streamBytes:\s*number/.test(models));
check('Duplicate stream metrics are represented', /duplicateStreamGroupCount:\s*number[\s\S]*duplicateStreamBytes:\s*number/.test(models));
check('Page-content duplicate metrics are represented', /pageContentStreamCount:\s*number[\s\S]*duplicatePageContentStreamGroupCount:\s*number[\s\S]*duplicatePageContentBytes:\s*number/.test(models));
check('Image resource metrics include dimensions, filters and bytes', /width:\s*number \| null[\s\S]*height:\s*number \| null[\s\S]*filter:\s*string \| null[\s\S]*bytes:\s*number/.test(models));
check('Forensic analyzer enumerates indirect objects', /enumerateIndirectObjects/.test(analyzer));
check('Forensic analyzer hashes stream bytes for exact duplicate detection', /subtle\.digest\('SHA-256'/.test(analyzer));
check('Forensic analyzer identifies page content streams', /PDFName\.of\('Contents'\)/.test(analyzer));
check('Forensic analyzer inspects page resources', /PDFName\.of\('Resources'\)[\s\S]*PDFName\.of\('XObject'\)/.test(analyzer));
check('Forensic analyzer records image resources', /subtype === 'Image'[\s\S]*imageReferenceCount/.test(analyzer));
check('Forensic analyzer records sampled PDF.js page metrics', /getOperatorList\(\)[\s\S]*imageOperatorCount[\s\S]*imageAreaRatio/.test(analyzer));
check('PdfFileAnalysis exposes additive forensic intelligence', /forensic\?:\s*import\('\.\/pdf-forensic\.models'\)\.PdfForensicAnalysis/.test(analysisModels));
check('PdfAnalyzer invokes the forensic analyzer', /forensicAnalyzer\.analyze\(file, pdf, undefined, forensicPages, signal\)/.test(pdfAnalyzer));
check('PdfAnalyzer forwards sampled page observations to avoid duplicate PDF.js inspection', /analyzePdfStructure\(pdf, forensicPages, signal\)/.test(pdfAnalyzer) && /forensicPages\.push/.test(pdfAnalyzer));
check('Forensic failures do not break legacy compression analysis', /Forensic intelligence is additive[\s\S]*forensic = undefined/.test(pdfAnalyzer));
check('V2.1 forensic regression spec exists', exists('src/app/core/compression/pdf-forensic-analyzer.service.spec.ts'));
check('V2.1 analyzer integration regression is covered', /attaches V2\.1 forensic intelligence/.test(analyzerSpec));
check('Forensic duplicate-stream regression is covered', /measures duplicate indirect streams/.test(spec));
check('Forensic service can consume precomputed page observations', /sampledPageObservations: PdfForensicPageObservation\[\]/.test(analyzer) && /sampledPageObservations\.length > 0/.test(analyzer));

const failures = checks.filter((item) => !item.pass);
console.log(`Compress V2.1 Audit: ${checks.length - failures.length}/${checks.length} structural checks passed.`);
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
if (failures.length) process.exitCode = 1;

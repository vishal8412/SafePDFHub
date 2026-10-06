import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const engine = fs.readFileSync(path.join(root, 'src/app/core/engines/compress.engine.ts'), 'utf8');
const facade = fs.readFileSync(path.join(root, 'src/app/core/compression/compress.facade.ts'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-compression-worker.service.ts'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-page-renderer.service.ts'), 'utf8');
const certification = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-candidate-certification.service.ts'), 'utf8');
const integrity = fs.readFileSync(path.join(root, 'src/app/core/compression/pdf-final-integrity.service.ts'), 'utf8');
const tool = fs.readFileSync(path.join(root, 'src/app/pages/tool/tool.component.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['shared CompressionCancelledError exists', fs.existsSync(path.join(root, 'src/app/core/compression/compression-cancellation.ts'))],
  ['engine owns AbortController lifecycle', engine.includes('private activeAbortController: AbortController | null') && engine.includes('new AbortController()')],
  ['engine exposes cancel()', /\n  cancel\(\): void/.test(engine)],
  ['engine checkpoints cancellation before major branches', engine.includes('throwIfCompressionCancelled(signal);')],
  ['engine passes cancellation into final certification', engine.includes('certifySmallest(') && engine.includes('signal,')],
  ['qpdf cancellation remains part of engine cancel', engine.includes('void this.qpdf.cancel();')],
  ['JPEG worker cancellation rejects pending requests', worker.includes('private readonly pending') && worker.includes('new CompressionCancelledError()')],
  ['JPEG worker termination clears pending work', worker.includes('this.worker?.terminate();') && worker.includes('this.pending.clear();')],
  ['PDF.js render cancellation cancels renderTask', renderer.includes('renderTask.cancel?.()')],
  ['final integrity checks AbortSignal per page', integrity.includes('throwIfCompressionCancelled(signal);')],
  ['certification forwards AbortSignal', certification.includes('signal?: AbortSignal') && certification.includes('signal,')],
  ['ToolComponent registers loader cancellation', tool.includes('registerCancellationHandler') && tool.includes('this.compressionFacade.cancel()')],
  ['Facade exposes cancellation', facade.includes('cancel(): void') && facade.includes('this.compressEngine.cancel()')],
  ['audit script can be registered', packageJson.scripts?.['compress:v2:cancellation:audit'] === 'node scripts/compression-v2-cancellation-audit.mjs'],
  ['user-src is absent from release tree', !fs.existsSync(path.join(root, 'user-src'))],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (ok) passed++;
}
console.log(`Compression V2 cancellation audit: ${passed}/${checks.length}`);
if (passed !== checks.length) process.exit(1);

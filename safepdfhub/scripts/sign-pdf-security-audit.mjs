import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const warnings = [];

const files = [
  'src/app/core/signing/models/signing.models.ts',
  'src/app/core/signing/services/signing-state.service.ts',
  'src/app/core/signing/services/signature-asset.service.ts',
  'src/app/core/signing/services/signing-pdf-renderer.service.ts',
  'src/app/core/signing/services/signing-pdf-export.service.ts',
  'src/app/core/signing/services/signing-pdf-text.service.ts',
  'src/app/features/tools/sign/sign-pdf-workspace/sign-pdf-workspace.component.ts',
];

async function read(path) { return readFile(resolve(root, path), 'utf8'); }
function assert(condition, message) { if (!condition) failures.push(message); }
function warn(condition, message) { if (!condition) warnings.push(message); }

const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await read(file)])));
const signingSource = Object.values(sources).join('\n');

// Privacy boundary: the Sign PDF implementation must not introduce persistence
// or direct network transport for PDF/signature data.
for (const forbidden of [
  'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest',
  'sendBeacon', 'HttpClient', 'http.post', 'http.put', 'http.patch',
]) {
  assert(!signingSource.includes(forbidden), `Sign PDF source contains forbidden persistence/network API: ${forbidden}`);
}

// fetch() is allowed only in the application-wide PDF worker/security engines;
// Sign PDF's own renderer/exporter must not fetch user PDF bytes.
assert(!sources['src/app/core/signing/services/signing-pdf-renderer.service.ts'].includes('fetch('), 'Sign PDF renderer must not fetch user PDF bytes.');
assert(!sources['src/app/core/signing/services/signing-pdf-export.service.ts'].includes('fetch('), 'Sign PDF exporter must not fetch user PDF bytes.');

// Input safety.
assert(signingSource.includes('MAX_SIGNING_PDF_BYTES'), 'Sign PDF file-size safety ceiling is missing.');
assert(signingSource.includes('MAX_SIGNING_PDF_PAGES'), 'Sign PDF page-count safety ceiling is missing.');
assert(signingSource.includes('MAX_SIGNING_PREVIEW_PIXELS'), 'Sign PDF preview pixel ceiling is missing.');
assert(signingSource.includes('MAX_SIGNATURE_UPLOAD_BYTES'), 'Signature upload byte limit is missing.');
assert(signingSource.includes('MAX_SIGNATURE_IMAGE_PIXELS'), 'Decoded signature pixel limit is missing.');
assert(signingSource.includes('MAX_SIGNATURE_IMAGE_DIMENSION'), 'Decoded signature dimension limit is missing.');

// Lifecycle / cancellation safety.
const renderer = sources['src/app/core/signing/services/signing-pdf-renderer.service.ts'];
assert(renderer.includes('renderGeneration'), 'Renderer generation guard is missing.');
assert(renderer.includes('cancelActiveRender'), 'Renderer cancellation path is missing.');
assert(renderer.includes('await pdfDocument.destroy()'), 'Renderer PDF document destruction is missing.');
assert(renderer.includes('page.cleanup()'), 'Renderer page cleanup is missing.');
assert(renderer.includes('canvas.width = 0'), 'Renderer canvas release is missing.');

// State lifecycle safety.
const state = sources['src/app/core/signing/services/signing-state.service.ts'];
assert(state.includes('reset()'), 'Signing state reset lifecycle is missing.');
assert(state.includes('clearAssets()'), 'Signing asset cleanup lifecycle is missing.');

// Cryptographic boundary: V1 is visual/electronic signing only.
for (const forbidden of ['PKCS#7', 'CMS', 'PAdES', 'ByteRange', 'X.509', 'privateKey', 'SubFilter']) {
  assert(!signingSource.includes(forbidden), `V1 Sign PDF source contains out-of-scope cryptographic signing term: ${forbidden}`);
}

warn(!signingSource.includes('console.log'), 'No console.log calls should exist in the Sign PDF implementation.');
assert(existsSync(resolve(root, 'scripts/phase2.5-sign-pdf-stress.py')), 'P2.5 browser stress harness is missing.');

if (failures.length) {
  console.error('Sign PDF security/privacy audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Sign PDF security/privacy audit: PASS');
console.log(`- Audited source files: ${files.length}`);
console.log('- No browser persistence/network transport found in Sign PDF scope.');
console.log('- Input/image/lifecycle safety controls detected.');
console.log('- SIGN-7 cryptographic signing boundary remains absent.');
if (warnings.length) {
  console.log('Warnings:');
  for (const item of warnings) console.log(`- ${item}`);
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readU32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readLeb(bytes, state) {
  let value = 0;
  let shift = 0;
  while (state.offset < bytes.length) {
    const b = bytes[state.offset++];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return value;
    shift += 7;
  }
  throw new Error('Invalid WASM LEB128 sequence.');
}

function inspectMemorySection(bytes) {
  if (bytes.length < 8 || readU32(bytes, 0) !== 0x6d736100 || bytes[4] !== 1) {
    return { validWasm: false, memories: [] };
  }

  const state = { offset: 8 };
  const memories = [];
  while (state.offset < bytes.length) {
    const sectionId = bytes[state.offset++];
    const sectionSize = readLeb(bytes, state);
    const sectionEnd = state.offset + sectionSize;
    if (sectionEnd > bytes.length) throw new Error('Invalid WASM section length.');

    if (sectionId === 5) {
      const count = readLeb(bytes, state);
      for (let i = 0; i < count; i += 1) {
        const flags = readLeb(bytes, state);
        const initialPages = readLeb(bytes, state);
        const maximumPages = (flags & 0x1) !== 0 ? readLeb(bytes, state) : null;
        memories.push({
          initialPages,
          initialBytes: initialPages * 65536,
          maximumPages,
          maximumBytes: maximumPages === null ? null : maximumPages * 65536,
          shared: (flags & 0x2) !== 0,
          memory64: (flags & 0x4) !== 0,
        });
      }
    }
    state.offset = sectionEnd;
  }

  return { validWasm: true, memories };
}

function packageInfo(relativePath) {
  try {
    const pkg = readJson(relativePath);
    return {
      version: pkg.version,
      name: pkg.name,
    };
  } catch {
    return null;
  }
}

const qpdfRunPackage = packageInfo('node_modules/qpdf-run/package.json');
const qpdfWasmPackage = packageInfo('node_modules/@neslinesli93/qpdf-wasm/package.json');
const qpdfRunWasm = path.join(root, 'node_modules/qpdf-run/vendor/qpdf/qpdf.wasm');
const qpdfRunJs = path.join(root, 'node_modules/qpdf-run/vendor/qpdf/qpdf.js');
const directWasm = path.join(root, 'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const directJs = path.join(root, 'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.js');

const wasmPath = fs.existsSync(qpdfRunWasm)
  ? qpdfRunWasm
  : fs.existsSync(directWasm)
    ? directWasm
    : null;
const jsPath = fs.existsSync(qpdfRunJs)
  ? qpdfRunJs
  : fs.existsSync(directJs)
    ? directJs
    : null;

const wasm = wasmPath ? fs.readFileSync(wasmPath) : null;
const js = jsPath ? fs.readFileSync(jsPath, 'utf8') : '';
const memory = wasm ? inspectMemorySection(wasm) : { validWasm: false, memories: [] };
const memoryHints = {
  allowMemoryGrowthLiteral: /ALLOW_MEMORY_GROWTH/.test(js),
  maximumMemoryLiteral: /MAXIMUM_MEMORY/.test(js),
  initialMemoryLiteral: /INITIAL_MEMORY/.test(js),
  memoryGrowthLiteral: /MEMORY_GROWTH_(?:GEOMETRIC|LINEAR)/.test(js),
};

const result = {
  generatedAtUtc: new Date().toISOString(),
  package: {
    qpdfRun: qpdfRunPackage,
    qpdfWasm: qpdfWasmPackage,
    applicationLockfile: packageInfo('package.json'),
  },
  runtime: {
    executionModel: 'qpdf-run browser Web Worker',
    qpdfRunWasmPath: wasmPath ? path.relative(root, wasmPath) : null,
    qpdfRunJsPath: jsPath ? path.relative(root, jsPath) : null,
    wasmBytes: wasm?.byteLength ?? null,
    wasmSha256: wasmPath ? sha256(wasmPath) : null,
    wasmMemorySection: memory,
    generatedRuntimeMemoryHints: memoryHints,
    qpdfVersionEvidence: [...new Set((js.match(/qpdf(?: version)?[^\n\r<]{0,40}/gi) ?? []).slice(0, 10))],
  },
  interpretation: {
    memoryGrowthConfigured: memoryHints.allowMemoryGrowthLiteral || memory.memories.some(m => m.maximumBytes !== null),
    maximumMemoryExplicitlyDiscoverable: memory.memories.some(m => m.maximumBytes !== null),
    note: 'This is static package/runtime inspection. It does not measure peak worker WASM memory during qpdf execution.',
  },
};

console.log(JSON.stringify(result, null, 2));

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const checks = [];
function check(name, condition, detail='') {
  checks.push({name, pass:Boolean(condition), detail});
}
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function text(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

check('V2.10 browser benchmark exists', exists('scripts/compress-v210-browser-benchmark.py'));
check('V2.10 audit exists', exists('scripts/compress-v210-audit.mjs'));
check('benchmark uses Playwright', text('scripts/compress-v210-browser-benchmark.py').includes('sync_playwright'));
check('benchmark accepts caller PDF', text('scripts/compress-v210-browser-benchmark.py').includes('--input'));
check('benchmark measures actual output bytes', text('scripts/compress-v210-browser-benchmark.py').includes('output_meta["bytes"]'));
check('benchmark checks every-page geometry', text('scripts/compress-v210-browser-benchmark.py').includes('output_meta["geometry"] != input_meta["geometry"]'));
check('benchmark records text hash', text('scripts/compress-v210-browser-benchmark.py').includes('textSha256'));
check('benchmark records duration', text('scripts/compress-v210-browser-benchmark.py').includes('durationMs'));
check('benchmark emits JSON report', text('scripts/compress-v210-browser-benchmark.py').includes('v210-compression-benchmark.json'));
check('benchmark emits Markdown report', text('scripts/compress-v210-browser-benchmark.py').includes('v210-compression-benchmark.md'));
check('benchmark does not require reduction', text('scripts/compress-v210-browser-benchmark.py').includes('No reduction is assumed'));
check('benchmark preserves page count', text('scripts/compress-v210-browser-benchmark.py').includes('output_meta["pages"] != input_meta["pages"]'));
check('benchmark validates PDF input', text('scripts/compress-v210-browser-benchmark.py').includes('suffix.lower() != ".pdf"'));
const pkg=JSON.parse(text('package.json'));
check('package benchmark script registered', typeof pkg.scripts?.['compress:v210:benchmark']==='string');
check('package benchmark points to V2.10 script', pkg.scripts?.['compress:v210:benchmark']?.includes('compress-v210-browser-benchmark.py'));
check('no user-src directory', !exists('user-src'));

const passed=checks.filter(c=>c.pass).length;
for(const c of checks) console.log(`${c.pass?'PASS':'FAIL'} ${c.name}${c.detail?` — ${c.detail}`:''}`);
console.log(`V2.10 audit: ${passed}/${checks.length} PASS`);
if(passed!==checks.length) process.exit(1);

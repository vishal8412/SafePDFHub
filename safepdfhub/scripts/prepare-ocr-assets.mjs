/** Stage language models in the normal Angular assets tree before serving/building.
 * Unlike a missing glob input, a missing/corrupt dependency must fail visibly. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'src/assets/ocr/lang');
const staged = [];
try {
  // Validate every dependency before writing any assets.
  for (const lang of ['eng', 'hin', 'mar']) {
    const file = `${lang}.traineddata.gz`;
    const source = resolve(root, `node_modules/@tesseract.js-data/${lang}/4.0.0`, file);
    let bytes;
    try { bytes = readFileSync(source); }
    catch { throw new Error(`Missing ${lang} OCR model: ${source}`); }
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || gunzipSync(bytes).length < 100_000)
      throw new Error(`Invalid ${lang} OCR model. Reinstall dependencies.`);
    staged.push({ file, bytes });
  }
  mkdirSync(destination, { recursive: true });
  for (const { file, bytes } of staged) {
    const target = resolve(destination, file);
    let current;
    try { current = readFileSync(target); } catch {}
    if (!current?.equals(bytes)) writeFileSync(target, bytes);
  }
  const manifest = staged.map(({file, bytes}) => ({file, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')}));
  writeFileSync(resolve(destination, 'models.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('OCR assets ready: English, Hindi and Marathi (validated gzip data).');
} catch (error) {
  console.error(`\nOCR asset preparation failed: ${error.message}\nStop the dev server, run npm ci in this project folder, then restart npm start.\n`);
  process.exitCode = 1;
}

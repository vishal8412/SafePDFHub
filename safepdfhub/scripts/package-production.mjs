/** Package only Angular's runtime output. Never serve the source project root. */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const built = resolve(root, 'dist/safepdfhub');
const destination = resolve(root, 'deployment/safepdfhub');
for (const required of ['browser', 'server/server.mjs', '3rdpartylicenses.txt']) await stat(join(built, required));
const browserFiles = await readdir(join(built, 'browser'), { recursive: true });
for (const name of browserFiles) {
  if (/\.map$|\.md$|(?:^|[\\/])f2r2(?:[\\/]|$)/i.test(name)) throw new Error(`Development artifact in production: ${name}`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ['browser', 'server', '3rdpartylicenses.txt']) await cp(join(built, name), join(destination, name), { recursive: true });
await writeFile(join(destination, 'package.json'), JSON.stringify({
  name: 'safepdfhub-production', private: true, type: 'module',
  scripts: { start: 'node server/server.mjs' }, engines: { node: '>=24.0.0 <25' }
}, null, 2) + '\n');
await writeFile(join(destination, 'README.txt'), 'SafePDFHub runtime bundle\n\nUse Node.js 24. Run: npm start\nDefault port: 4000; override with PORT.\nPut HTTPS in front of this server. Keep browser/ and server/ together.\nInject contact email settings through the host environment.\nSee PRODUCTION.md in the source project for deployment details.\n');
const files = [];
async function inventory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inventory(path);
    else { const bytes = await readFile(path); files.push({ path: relative(destination, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
}
await inventory(destination);
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ files, totalBytes: files.reduce((n, f) => n + f.bytes, 0) }, null, 2) + '\n');
console.log(`Production package: ${destination} (${files.length} files; ${files.reduce((n, f) => n + f.bytes, 0)} bytes)`);

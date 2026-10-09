/** Audit actual production SSR responses, without requiring crawler JavaScript. Run after npm run build. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
async function main() {
const base = process.env.SEO_AUDIT_BASE_URL;
Object.assign(process.env, { DEPLOY_ID: 'local', DEPLOY_PRIME_URL: 'https://local.test', DEPLOY_URL: 'https://local.test', SITE_ID: 'local', SITE_NAME: 'local', URL: 'https://local.test', CONTEXT: 'production' });
const handler = base ? null : (await import('../dist/safepdfhub/server/server.mjs')).netlifyAppEngineHandler;
const request = (path, userAgent = 'Googlebot') => base
  ? fetch(new URL(path, base), { redirect: 'manual', headers: { 'User-Agent': userAgent } })
  : handler(new Request(new URL(path, 'https://local.test'), { headers: { 'User-Agent': userAgent } }));
const report = { transport: base ? 'Node HTTP' : 'compiled Netlify fetch handler in Node (not Edge deployment)', pages: [], checks: [] };
const xmlResponse = await request('/sitemap.xml');
assert.equal(xmlResponse.status, 200);
assert.match(xmlResponse.headers.get('content-type'), /xml/);
const xml = await xmlResponse.text();
assert.equal(xml.replace(/>\s+</g, '><').trim(), (await readFile(new URL('../src/seo/sitemap.xml', import.meta.url), 'utf8')).replace(/>\s+</g, '><').trim());
const paths = [...xml.matchAll(/<loc>https:\/\/safepdfhub.com([^<]*)<\/loc>/g)].map(match => match[1] || '/');
assert.equal(paths.length, 14);
const titles = new Set(); const descriptions = new Set();
for (const path of paths) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  const html = await response.text(); const dom = new JSDOM(html); const doc = dom.window.document;
  const title = doc.title; const description = doc.querySelector('meta[name="description"]')?.content;
  assert.ok(title && description, path);
  assert.ok(!titles.has(title), `Duplicate title: ${path}`); titles.add(title);
  assert.ok(!descriptions.has(description), `Duplicate description: ${path}`); descriptions.add(description);
  assert.equal(doc.querySelectorAll('link[rel="canonical"]').length, 1, path);
  const canonical = `https://safepdfhub.com${path === '/' ? '' : path}`;
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), canonical, path);
  assert.equal(doc.querySelector('meta[property="og:url"]').content, canonical, path);
  assert.equal(doc.querySelectorAll('h1').length, 1, path);
  assert.match(doc.querySelector('meta[name="robots"]').content, /^index,follow/);
  const schemas = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(el => JSON.parse(el.textContent));
  if (path === '/' || path === '/about' || path === '/contact' || path.startsWith('/tools/')) assert.ok(schemas.length, `Missing JSON-LD: ${path}`);
  if (path.startsWith('/tools/')) {
    assert.ok(schemas.some(schema => schema['@type'] === 'WebApplication'), path);
    assert.ok(schemas.some(schema => schema['@type'] === 'BreadcrumbList'), path);
    assert.ok(doc.querySelector('.tool-guide h2'), `Missing rendered guidance: ${path}`);
    assert.ok(doc.querySelectorAll('.tool-guide li').length >= 3, path);
  }
  report.pages.push({ path, status: response.status, title, description, canonical, h1: doc.querySelector('h1').textContent.trim(), schemaTypes: schemas.map(schema => schema['@type']) });
  dom.window.close();
}
const robots = await request('/robots.txt');
assert.equal(robots.status, 200);
assert.match(robots.headers.get('content-type'), /text\/plain/);
assert.equal(await robots.text(), await readFile(new URL('../src/seo/robots.txt', import.meta.url), 'utf8'));
report.checks.push('Sitemap and robots runtime responses match generated assets');
for (const slug of ['compress-pdf', 'merge-pdf', 'split-pdf', 'protect-pdf', 'unlock-pdf', 'sign-pdf', 'watermark-pdf']) {
  for (const path of [`/${slug}`, `/tool/${slug}`, `/tools/${slug}/`]) {
    const response = await request(`${path}?ref=audit`);
    assert.equal(response.status, 301, path);
    assert.equal(new URL(response.headers.get('location'), 'https://local.test').pathname, `/tools/${slug}`);
    assert.equal(new URL(response.headers.get('location'), 'https://local.test').search, '?ref=audit');
  }
}
report.checks.push('21 legacy and trailing-slash redirects return 301 and preserve queries');
for (const path of ['/missing-page', '/tools/missing-tool', '/tool/missing-tool', '/unknown/nested', '/pdf-to-excel']) {
  const response = await request(path); assert.equal(response.status, 404, path);
  const dom = new JSDOM(await response.text());
  assert.match(dom.window.document.querySelector('meta[name="robots"]').content, /noindex/);
  assert.match(dom.window.document.querySelector('h1').textContent, /Page not found/);
  dom.window.close();
}
report.checks.push('Five missing URLs render helpful noindex pages with HTTP 404');
const studio = await request('/studio');
assert.equal(studio.status, 200); assert.match(studio.headers.get('x-robots-tag'), /noindex/);
const studioHtml = await studio.text(); assert.match(studioHtml, /noindex,follow/);
const queryPage = await request('/tools/compress-pdf?ref=audit', 'OAI-SearchBot');
const queryDom = new JSDOM(await queryPage.text());
assert.equal(queryDom.window.document.querySelector('link[rel="canonical"]').href, 'https://safepdfhub.com/tools/compress-pdf');
assert.ok(queryDom.window.document.querySelector('.tool-guide')); queryDom.window.close();
report.checks.push('Editor is noindex; OAI-SearchBot receives rendered guidance and clean canonical');
if (!base) {
  process.env.CONTEXT = 'deploy-preview';
  const preview = await request('/tools/compress-pdf'); assert.match(preview.headers.get('x-robots-tag'), /noindex/);
  assert.equal(await (await request('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  process.env.CONTEXT = 'production';
  report.checks.push('Netlify preview context disables indexing and crawling');
}
await mkdir(new URL('../release-notes/', import.meta.url), { recursive: true });
await writeFile(new URL(`../release-notes/seo-rendered-${base ? 'node' : 'fetch'}-audit.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${report.pages.length} rendered pages; ${report.checks.join('; ')}`);

}
try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }

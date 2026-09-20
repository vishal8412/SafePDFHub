import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const warnings = [];

async function read(relative) {
  return readFile(resolve(root, relative), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

const toolsSource = await read('src/app/config/tools.config.ts');
const behaviorSource = await read('src/app/config/tool-behavior.config.ts');
const pageSeoSource = await read('src/app/config/page-seo.config.ts');
const siteSource = await read('src/app/config/site.config.ts');
const seoSource = await read('src/app/core/services/seo.service.ts');
const routesSource = await read('src/app/app.routes.ts');
const serverSource = await read('src/server.ts');
const toolHtml = await read('src/app/pages/tool/tool.component.html');
const toolTs = await read('src/app/pages/tool/tool.component.ts');
const footerHtml = await read('src/app/shared/footer/footer.component.html');
const actionPanelHtml = await read('src/app/shared/components/action-panel/action-panel.component.html');
const angularSource = await read('angular.json');
const sitemap = await read('src/seo/sitemap.xml');
const robots = await read('src/seo/robots.txt');

const toolSlugs = [...toolsSource.matchAll(/\bslug:\s*'([^']+)'/g)].map(m => m[1]);
const behaviorSlugs = [...behaviorSource.matchAll(/\bslug:\s*'([^']+)'/g)].map(m => m[1]);
const staticPathsBlock = siteSource.match(/staticIndexablePaths:\s*\[([\s\S]*?)\]\s*as const/);
const staticPaths = staticPathsBlock ? [...staticPathsBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
const pageSeoPaths = [...pageSeoSource.matchAll(/^\s*'([^']+)':\s*\{/gm)].map(m => m[1]);
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

// P1.1 — tool SEO integrity.
assert(toolSlugs.length > 0, 'TOOLS must contain at least one implemented tool.');
for (const slug of toolSlugs) {
  assert(behaviorSlugs.includes(slug), `Tool '${slug}' has no ToolBehavior.`);
  assert(toolHtml.includes('<h1'), `Tool template must contain an SSR-renderable <h1>.`);
  assert(toolTs.includes(`'/tools', slug`), `Tool navigation should use canonical /tools/${slug} links.`);
}
for (const slug of behaviorSlugs) {
  assert(toolSlugs.includes(slug), `ToolBehavior '${slug}' has no Tool metadata entry.`);
}
assert(!toolSlugs.includes('pdf-to-word'), 'Unimplemented PDF-to-Word must not enter the public SEO tool inventory.');
assert(!routesSource.includes("path: 'tools/pdf-to-word'"), 'Unimplemented PDF-to-Word must not have a public tool route.');
assert(!toolTs.includes("goToTool('pdf-to-word')"), 'Unimplemented PDF-to-Word must not be suggested internally.');

// P1.2 — metadata/canonical architecture.
assert(seoSource.includes('setCanonical'), 'SEO service must own canonical link creation.');
assert(seoSource.includes('setMeta(\'description\''), 'SEO service must own meta description creation.');
assert(seoSource.includes('updateForUrl'), 'SEO service must expose route-aware static page metadata.');
assert(seoSource.includes("canonicalPath: `/tools/${tool.slug}`"), 'Tool SEO must use canonical /tools/:slug URLs.');
assert(staticPaths.length === pageSeoPaths.filter(path => !path.startsWith('/studio')).length, 'Every indexable static path should have a PAGE_SEO entry.');
for (const path of staticPaths) assert(pageSeoPaths.includes(path), `Missing PAGE_SEO entry for '${path}'.`);

const staticPageFiles = {
  '/': 'src/app/features/pages/home/home.component.html',
  '/support': 'src/app/features/pages/support/support.component.html',
  '/about': 'src/app/features/pages/about/about.component.html',
  '/contact': 'src/app/features/pages/contact/contact.component.html',
  '/privacy': 'src/app/features/pages/privacy/privacy.component.html',
  '/terms': 'src/app/features/pages/terms/terms.component.html'
};
for (const path of staticPaths) {
  const file = staticPageFiles[path];
  assert(Boolean(file), `No static page template mapping exists for '${path}'.`);
  if (file) {
    const html = await read(file);
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    assert(h1Count === 1, `Static page '${path}' should have exactly one SSR-renderable <h1> (found ${h1Count}).`);
  }
}

// P1.3 — structured data.
assert(seoSource.includes("'@type': 'Organization'"), 'Organization structured data is missing.');
assert(seoSource.includes("'@type': 'WebApplication'"), 'WebApplication structured data is missing.');
assert(!seoSource.includes("'SoftwareApplication'"), 'WebApplication schema should not advertise SoftwareApplication without the required rich-result fields.');
assert(seoSource.includes("'@type': 'BreadcrumbList'"), 'BreadcrumbList structured data is missing.');
assert(seoSource.includes("{ name: 'Home', path: '/' }"), 'Tool breadcrumb schema should include Home.');
assert(!seoSource.includes("{ name: 'PDF Tools', path: '/' }"), 'Breadcrumb schema should not represent PDF Tools as the same URL as Home.');

// P1.4 — sitemap/robots production hardening.
assert(serverSource.includes("app.get('/sitemap.xml'"), 'SSR server must expose /sitemap.xml.');
assert(serverSource.includes("app.get('/robots.txt'"), 'SSR server must expose /robots.txt.');
assert(serverSource.includes('TOOLS.map(tool => `/tools/${tool.slug}`)'), 'Dynamic sitemap must use the canonical tool inventory.');
assert(angularSource.includes('"glob": "robots.txt"') && angularSource.includes('"glob": "sitemap.xml"'), 'Angular assets must copy robots.txt and sitemap.xml to the root.');
assert(robots.includes('Sitemap: https://safepdfhub.com/sitemap.xml'), 'robots.txt must point to the canonical sitemap.');

const expectedUrls = [
  ...staticPaths.map(path => `https://safepdfhub.com${path === '/' ? '' : path}`),
  ...toolSlugs.map(slug => `https://safepdfhub.com/tools/${slug}`)
];
assert(expectedUrls.length === sitemapLocs.length, 'Static sitemap URL count does not match the SEO inventory.');
for (const url of expectedUrls) assert(sitemapLocs.includes(url), `Static sitemap is missing '${url}'.`);
for (const url of sitemapLocs) assert(expectedUrls.includes(url), `Static sitemap contains non-inventory URL '${url}'.`);

// P1.5 — internal linking + automated auditability.
assert(routesSource.includes("path: 'tools/:slug'"), 'Canonical /tools/:slug route is missing.');
assert(footerHtml.includes("['/tools', tool.slug]"), 'Footer must link directly to canonical tool URLs.');
assert(actionPanelHtml.includes("['/tools', action.id]"), 'Action panel must link directly to canonical tool URLs.');
assert(toolTs.includes('this.recommendedTools = TOOLS.filter'), 'Tool pages must expose related-tool recommendations from the canonical inventory.');
assert(existsSync(resolve(root, 'scripts/seo-architecture-audit.mjs')), 'SEO audit script is missing.');
assert(existsSync(resolve(root, 'scripts/generate-seo-assets.mjs')), 'SEO asset generator is missing.');

warn(toolHtml.includes('heroDescription'), 'Tool pages should expose meaningful supporting copy beneath the H1.');

if (failures.length) {
  console.error('P1 SEO architecture audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('P1 SEO architecture audit: PASS');
console.log(`- Implemented tools: ${toolSlugs.join(', ')}`);
console.log(`- Indexable static pages: ${staticPaths.join(', ')}`);
console.log(`- Sitemap URLs: ${sitemapLocs.length}`);
if (warnings.length) {
  console.log('Warnings:');
  for (const item of warnings) console.log(`- ${item}`);
}

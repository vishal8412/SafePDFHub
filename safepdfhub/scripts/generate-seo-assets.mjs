import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const siteConfigPath = resolve(root, 'src/app/config/site.config.ts');
const toolsConfigPath = resolve(root, 'src/app/config/tools.config.ts');
const seoDir = resolve(root, 'src/seo');

const siteConfig = await readFile(siteConfigPath, 'utf8');
const toolsConfig = await readFile(toolsConfigPath, 'utf8');

const siteUrl = siteConfig.match(/url:\s*'([^']+)'/)?.[1];
if (!siteUrl) throw new Error('Unable to read SITE_CONFIG.url');

const staticBlock = siteConfig.match(/staticIndexablePaths:\s*\[([\s\S]*?)\]\s*as const/);
if (!staticBlock) throw new Error('Unable to read SITE_CONFIG.staticIndexablePaths');

const staticPaths = [...staticBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const toolSlugs = [...toolsConfig.matchAll(/\bslug:\s*'([^']+)'/g)].map(match => match[1]);
const urls = [...new Set([...staticPaths, ...toolSlugs.map(slug => `/tools/${slug}`)])];

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(path => `  <url><loc>${siteUrl}${path === '/' ? '' : path}</loc></url>`),
  '</urlset>',
  ''
].join('\n');

const robots = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /__dev/',
  '',
  `Sitemap: ${siteUrl}/sitemap.xml`,
  ''
].join('\n');

await writeFile(resolve(seoDir, 'sitemap.xml'), xml, 'utf8');
await writeFile(resolve(seoDir, 'robots.txt'), robots, 'utf8');

console.log(`Generated SEO assets for ${urls.length} indexable URLs.`);

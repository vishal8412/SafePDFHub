import { writeFile } from 'node:fs/promises';
import { loadDiscoveryConfig } from './load-discovery-config.mjs';

const [{ SITE_CONFIG }, { TOOLS }, assets] = await Promise.all([
  loadDiscoveryConfig('../src/app/config/site.config.ts'),
  loadDiscoveryConfig('../src/app/config/tools.config.ts'),
  loadDiscoveryConfig('../src/app/config/discovery-assets.ts')
]);
const paths = [...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`)];
const outputs = {
  'sitemap.xml': assets.buildSitemapXml(SITE_CONFIG.url, paths),
  'robots.txt': assets.buildRobotsText(SITE_CONFIG.url, assets.isIndexingDisabled(process.env)),
  'llms.txt': assets.buildDiscoveryIndex(SITE_CONFIG, TOOLS)
};
for (const [name, content] of Object.entries(outputs)) {
  await writeFile(new URL(`../src/seo/${name}`, import.meta.url), content, 'utf8');
}
console.log(`Generated sitemap, robots policy, and public discovery index for ${new Set(paths).size} canonical URLs.`);

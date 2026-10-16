import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDiscoveryConfig } from './load-discovery-config.mjs';

const [{ SITE_CONFIG }, { TOOLS }, { KNOWLEDGE_GUIDES }] = await Promise.all([
  loadDiscoveryConfig('../src/app/config/site.config.ts'),
  loadDiscoveryConfig('../src/app/config/tools.config.ts'),
  loadDiscoveryConfig('../src/app/config/knowledge-guides.config.ts')
]);
const research = JSON.parse(await readFile(new URL('../seo-research/keyword-map.json', import.meta.url), 'utf8'));
const paths = new Set([...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`), '/guides', ...KNOWLEDGE_GUIDES.map(guide => `/guides/${guide.slug}`)]);
const keywords = new Set();
for (const item of research.keywords) {
  const normalized = item.keyword.trim().toLowerCase();
  assert.ok(normalized && !keywords.has(normalized), `Duplicate or empty keyword: ${item.keyword}`);
  keywords.add(normalized);
  assert.ok(paths.has(item.target_path), `Keyword maps to an unavailable page: ${item.keyword}`);
  assert.ok(['transactional', 'informational'].includes(item.intent));
  assert.ok(['P1', 'P2'].includes(item.priority));
  assert.ok(item.evidence_status && item.notes);
  for (const field of ['monthly_searches', 'keyword_difficulty']) {
    assert.ok(item[field] === '' || (Number.isFinite(Number(item[field])) && Number(item[field]) >= 0), `Invalid metric: ${item.keyword}`);
  }
}
console.log(`PASS: ${keywords.size} unique keyword candidates, ${new Set(research.keywords.map(item => item.cluster)).size} intent clusters, and ${new Set(research.keywords.map(item => item.target_path)).size} valid canonical targets. See research scope for measurement limits.`);

import { SITE_CONFIG } from '../app/config/site.config';
import { KNOWLEDGE_GUIDES } from '../app/config/knowledge-guides.config';
import { TOOLS } from '../app/config/tools.config';
import { buildRobotsText, buildSitemapXml, buildDiscoveryIndex, isIndexingDisabled } from '../app/config/discovery-assets';

const redirects = new Map<string, string>([
  ...TOOLS.flatMap(tool => [[`/${tool.slug}`, `/tools/${tool.slug}`], [`/tool/${tool.slug}`, `/tools/${tool.slug}`]] as [string, string][]),
  ['/remove-password', '/tools/unlock-pdf'], ['/donate', '/support']
]);
const publicPaths = new Set<string>([...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`), '/guides', ...KNOWLEDGE_GUIDES.map(guide => `/guides/${guide.slug}`), '/studio']);

/** Canonical path redirects preserve search parameters and never redirect unknown URLs home. */
export function seoRedirect(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const legacy = redirects.get(path);
  if (legacy) return legacy;
  return path !== pathname && publicPaths.has(path) ? path : undefined;
}
export function indexingDisabled(env: Record<string, string | undefined>): boolean {
  return isIndexingDisabled(env);
}
export function robotsText(disabled = false): string {
  return buildRobotsText(SITE_CONFIG.url, disabled);
}
export function sitemapXml(): string {
  const paths = [...new Set([...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`), '/guides', ...KNOWLEDGE_GUIDES.map(guide => `/guides/${guide.slug}`)])];
  return buildSitemapXml(SITE_CONFIG.url, paths);
}
export function discoveryIndexText(): string {
  return buildDiscoveryIndex(SITE_CONFIG, TOOLS, KNOWLEDGE_GUIDES);
}

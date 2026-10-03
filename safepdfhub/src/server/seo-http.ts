import { SITE_CONFIG } from '../app/config/site.config';
import { TOOLS } from '../app/config/tools.config';

const redirects = new Map<string, string>([
  ...TOOLS.flatMap(tool => [[`/${tool.slug}`, `/tools/${tool.slug}`], [`/tool/${tool.slug}`, `/tools/${tool.slug}`]] as [string, string][]),
  ['/remove-password', '/tools/unlock-pdf'], ['/donate', '/support']
]);
const publicPaths = new Set<string>([...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`), '/studio']);

/** Canonical path redirects preserve search parameters and never redirect unknown URLs home. */
export function seoRedirect(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const legacy = redirects.get(path);
  if (legacy) return legacy;
  return path !== pathname && publicPaths.has(path) ? path : undefined;
}
export function indexingDisabled(env: Record<string, string | undefined>): boolean {
  if (env['INDEXING_DISABLED'] === 'true' || ['deploy-preview', 'branch-deploy'].includes(env['CONTEXT'] ?? '')) return true;
  // The Angular adapter injects these URLs into Edge runtime; CONTEXT may be absent.
  const prime = env['DEPLOY_PRIME_URL'];
  const production = env['URL'];
  if (prime && production) {
    try { return new URL(prime).origin !== new URL(production).origin; } catch { /* Node hosts need neither variable. */ }
  }
  return false;
}
export function robotsText(disabled = false): string {
  return disabled ? 'User-agent: *\nDisallow: /\n' : [
    'User-agent: *', 'Allow: /', 'Disallow: /__dev/', 'Disallow: /api/', '', `Sitemap: ${SITE_CONFIG.url}/sitemap.xml`, ''
  ].join('\n');
}
export function sitemapXml(): string {
  const paths = [...new Set([...SITE_CONFIG.staticIndexablePaths, ...TOOLS.map(tool => `/tools/${tool.slug}`)])];
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map(path => `  <url>\n    <loc>${escapeXml(`${SITE_CONFIG.url}${path === '/' ? '' : path}`)}</loc>\n  </url>`), '</urlset>', ''].join('\n');
}
function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

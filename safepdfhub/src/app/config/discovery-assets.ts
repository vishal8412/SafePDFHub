/** Shared by the SSR endpoints and build generator so crawler policy cannot drift. */
export function isIndexingDisabled(env: Record<string, string | undefined>): boolean {
  if (env['INDEXING_DISABLED'] === 'true' || ['deploy-preview', 'branch-deploy'].includes(env['CONTEXT'] ?? '')) return true;
  const prime = env['DEPLOY_PRIME_URL'];
  const production = env['URL'];
  if (prime && production) {
    try { return new URL(prime).origin !== new URL(production).origin; } catch { /* Optional host configuration. */ }
  }
  return false;
}

export function buildRobotsText(siteUrl: string, disabled = false): string {
  if (disabled) return 'User-agent: *\nDisallow: /\n';
  // Search discovery is distinct from training permission. No training-bot
  // policy is added here; existing general crawler permissions are preserved.
  const agents = ['*', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot'];
  const groups = agents.map(agent => [
    `User-agent: ${agent}`, 'Allow: /', 'Disallow: /__dev/', 'Disallow: /api/', ''
  ].join('\n'));
  // Studio stays crawlable so a crawler can see its noindex directive.
  return [...groups, `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

export function buildSitemapXml(siteUrl: string, paths: readonly string[]): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...new Set(paths)].map(path => `  <url><loc>${escape(`${siteUrl}${path === '/' ? '' : path}`)}</loc></url>`), '</urlset>', ''].join('\n');
}

/** Optional public navigation index; it does not replace HTML or guarantee AI inclusion. */
export function buildDiscoveryIndex(
  site: { name: string; url: string },
  tools: readonly { slug: string; label: string; description: string; displayOrder: number }[],
  guides: readonly { slug: string; title: string; description: string }[] = []
): string {
  return [
    `# ${site.name}`, '',
    '> Browser-based PDF tools and DOCX conversion.', '',
    'This is a public navigation index. Each linked tool page is authoritative for its current workflow, supported formats, device limits, and limitations. User documents and processing results are not public content.', '',
    '## PDF tools',
    ...[...tools].sort((a, b) => a.displayOrder - b.displayOrder).map(tool => `- [${tool.label}](${site.url}/tools/${tool.slug}): ${tool.description}`), '',
    ...(guides.length ? ['## PDF help guides', `- [Browse PDF guides](${site.url}/guides)`, ...guides.map(guide => `- [${guide.title}](${site.url}/guides/${guide.slug}): ${guide.description}`), ''] : []),
    '## About, privacy, and help',
    `- [About ${site.name}](${site.url}/about): About the project and its approach to document processing.`,
    `- [Privacy policy](${site.url}/privacy): Information handling and third-party services.`,
    `- [Contact](${site.url}/contact): Product support, feedback, and privacy questions.`,
    `- [Terms of service](${site.url}/terms): Conditions for using the tools.`,
    `- [Support the project](${site.url}/support): Help maintain and improve the tools.`, '',
    '## Discovery', `- [Tool directory](${site.url}/#tools)`, `- [XML sitemap](${site.url}/sitemap.xml)`, ''
  ].join('\n');
}

import { describe, expect, it } from 'vitest';
import { indexingDisabled, robotsText, seoRedirect, sitemapXml, discoveryIndexText } from './seo-http';
import { TOOLS } from '../app/config/tools.config';
import { SITE_CONFIG } from '../app/config/site.config';

describe('public SEO HTTP policy', () => {
  it('redirects every implemented legacy tool and normalizes canonical trailing slashes', () => {
    expect(seoRedirect('/pdf-to-word')).toBe('/tools/pdf-to-word');
    expect(seoRedirect('/sign-pdf')).toBe('/tools/sign-pdf');
    expect(seoRedirect('/watermark-pdf/')).toBe('/tools/watermark-pdf');
    expect(seoRedirect('/tool/compress-pdf')).toBe('/tools/compress-pdf');
    expect(seoRedirect('/tools/compress-pdf/')).toBe('/tools/compress-pdf');
    expect(seoRedirect('/donate')).toBe('/support');
  });
  it('does not turn missing tools or pages into homepage redirects', () => {
    for (const path of ['/pdf-to-excel', '/missing', '/tools/missing/', '/tool/missing'])
      expect(seoRedirect(path)).toBeUndefined();
  });
  it('blocks indexing of preview deployments but permits production search crawlers', () => {
    expect(indexingDisabled({ CONTEXT: 'deploy-preview' })).toBe(true);
    expect(indexingDisabled({ CONTEXT: 'branch-deploy' })).toBe(true);
    expect(indexingDisabled({ INDEXING_DISABLED: 'true' })).toBe(true);
    expect(indexingDisabled({ CONTEXT: 'production' })).toBe(false);
    expect(
      indexingDisabled({
        DEPLOY_PRIME_URL: 'https://deploy-preview-5--example.netlify.app',
        URL: 'https://safepdfhub.com',
      }),
    ).toBe(true);
    expect(
      indexingDisabled({
        DEPLOY_PRIME_URL: 'https://safepdfhub.com',
        URL: 'https://safepdfhub.com',
      }),
    ).toBe(false);
    expect(robotsText(true)).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsText()).toContain('Allow: /');
    expect(robotsText()).toContain('Disallow: /api/');
  });
  it('includes only the public canonical inventory in the sitemap', () => {
    const xml = sitemapXml();
    expect(xml).toContain('/tools/pdf-to-word</loc>');
    expect((xml.match(/<loc>/g) ?? []).length).toBe(SITE_CONFIG.staticIndexablePaths.length + TOOLS.length);
    expect(xml).toContain('/tools/word-to-pdf</loc>');
    expect(xml).toContain('<loc>https://safepdfhub.com/tools/compress-pdf</loc>');
    for (const excluded of ['/studio', '/__dev', '/pdf-to-excel', '/tool/'])
      expect(xml).not.toContain(excluded);
  });
  it('preserves the private-path restrictions for each explicitly allowed search crawler', () => {
    const groups = robotsText().split(/\n\n/).filter(group => group.startsWith('User-agent:'));
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      expect(group).toContain('Allow: /');
      expect(group).toContain('Disallow: /api/');
      expect(group).toContain('Disallow: /__dev/');
      expect(group).not.toContain('Disallow: /studio');
    }
    for (const bot of ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot']) expect(robotsText()).toContain(`User-agent: ${bot}`);
    expect(robotsText(true)).not.toContain('Allow: /');
  });
  it('keeps the optional public discovery index aligned with every available tool', () => {
    const index = discoveryIndexText();
    for (const tool of TOOLS) expect(index).toContain(`https://safepdfhub.com/tools/${tool.slug}`);
    expect(index).toContain('/privacy');
    for (const path of ['/studio', '/api/', '/__dev/']) expect(index).not.toContain(path);
  });
});

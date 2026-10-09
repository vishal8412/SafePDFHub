import { describe, expect, it } from 'vitest';
import { indexingDisabled, robotsText, seoRedirect, sitemapXml } from './seo-http';

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
    expect((xml.match(/<loc>/g) ?? []).length).toBe(14);
    expect(xml).toContain('<loc>https://safepdfhub.com/tools/compress-pdf</loc>');
    for (const excluded of ['/studio', '/__dev', '/pdf-to-excel', '/tool/'])
      expect(xml).not.toContain(excluded);
  });
});

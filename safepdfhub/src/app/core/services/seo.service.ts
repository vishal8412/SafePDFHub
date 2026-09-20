import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

import { PAGE_SEO, NON_INDEXABLE_PAGE_SEO, type PageSeoConfig } from '../../config/page-seo.config';
import { SITE_CONFIG } from '../../config/site.config';
import type { Tool } from '../../config/tools.config';

interface SeoOptions extends PageSeoConfig {
  breadcrumbs?: readonly SeoBreadcrumb[];
  webApplication?: boolean;
}

export interface SeoBreadcrumb {
  name: string;
  path?: string;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  updateTool(tool: Tool): void {
    this.update({
      title: tool.title,
      description: tool.description,
      keywords: tool.keywords,
      canonicalPath: `/tools/${tool.slug}`,
      breadcrumbs: [
        { name: 'Home', path: '/' },
        { name: this.getToolDisplayName(tool) }
      ],
      webApplication: true,
      indexable: true
    });
  }

  updateForUrl(url: string): void {
    const path = this.normalizePath(url);
    const config = PAGE_SEO[path] ?? NON_INDEXABLE_PAGE_SEO[path];

    if (config) {
      this.update({ ...config });
      return;
    }

    // Unknown application pages are not part of the public SEO inventory.
    this.update({
      title: 'SafePDFHub — Private PDF Tools',
      description: SITE_CONFIG.description,
      canonicalPath: path || '/',
      indexable: false
    });
  }

  updateSiteDefaults(): void {
    this.updateForUrl('/');
  }

  private update(options: SeoOptions): void {
    this.title.setTitle(options.title);

    this.setMeta('description', options.description);
    this.setMeta(
      'robots',
      options.indexable === false
        ? 'noindex,follow'
        : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
    );

    if (options.keywords) {
      this.setMeta('keywords', options.keywords);
    } else {
      this.removeMeta('keywords');
    }

    const canonicalUrl = this.absoluteUrl(options.canonicalPath);
    this.setCanonical(canonicalUrl);

    this.setMetaProperty('og:title', options.title);
    this.setMetaProperty('og:description', options.description);
    this.setMetaProperty('og:url', canonicalUrl);
    this.setMetaProperty('og:type', 'website');
    this.setMetaProperty('og:site_name', SITE_CONFIG.name);

    this.setMetaName('twitter:card', 'summary_large_image');
    this.setMetaName('twitter:title', options.title);
    this.setMetaName('twitter:description', options.description);

    this.setJsonLd('safepdfhub-organization-jsonld', this.organizationSchema());

    if (options.webApplication) {
      this.setJsonLd(
        'safepdfhub-webapplication-jsonld',
        this.webApplicationSchema(canonicalUrl, options.title, options.description)
      );
    } else {
      this.removeJsonLd('safepdfhub-webapplication-jsonld');
    }

    if (options.breadcrumbs && options.breadcrumbs.length >= 2) {
      this.setJsonLd(
        'safepdfhub-breadcrumb-jsonld',
        this.breadcrumbSchema(options.breadcrumbs)
      );
    } else {
      this.removeJsonLd('safepdfhub-breadcrumb-jsonld');
    }
  }

  private organizationSchema(): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_CONFIG.url}/#organization`,
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.url,
      logo: SITE_CONFIG.logoUrl
    };
  }

  private webApplicationSchema(
    canonicalUrl: string,
    name: string,
    description: string
  ): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name,
      description,
      url: canonicalUrl,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web Browser'
    };
  }

  private breadcrumbSchema(
    breadcrumbs: readonly SeoBreadcrumb[]
  ): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((breadcrumb, index) => {
        const item: Record<string, unknown> = {
          '@type': 'ListItem',
          position: index + 1,
          name: breadcrumb.name
        };

        if (breadcrumb.path) {
          item['item'] = this.absoluteUrl(breadcrumb.path);
        }

        return item;
      })
    };
  }

  private setCanonical(url: string): void {
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }

    link.setAttribute('href', url);
  }

  private setMeta(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private setMetaName(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private setMetaProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content });
  }

  private removeMeta(name: string): void {
    this.meta.removeTag(`name="${name}"`);
  }

  private setJsonLd(id: string, data: Record<string, unknown>): void {
    this.removeJsonLd(id);

    const script = this.document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    this.document.head.appendChild(script);
  }

  private removeJsonLd(id: string): void {
    this.document.getElementById(id)?.remove();
  }

  private absoluteUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    if (path === '/') {
      return SITE_CONFIG.url;
    }

    if (path.startsWith('/#')) {
      return `${SITE_CONFIG.url}/${path.slice(1)}`;
    }

    return `${SITE_CONFIG.url}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private normalizePath(url: string): string {
    const withoutOrigin = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
    const path = withoutOrigin.split('#')[0].split('?')[0] || '/';

    if (path === '') {
      return '/';
    }

    return path.length > 1 ? path.replace(/\/+$/, '') : '/';
  }

  private getToolDisplayName(tool: Tool): string {
    const labels: Record<string, string> = {
      'compress-pdf': 'Compress PDF',
      'merge-pdf': 'Merge PDF',
      'split-pdf': 'Split PDF',
      'protect-pdf': 'Protect PDF',
      'unlock-pdf': 'Unlock PDF'
    };

    return labels[tool.slug] ?? tool.title.replace(/\s+(Online|Free).*$/i, '');
  }
}

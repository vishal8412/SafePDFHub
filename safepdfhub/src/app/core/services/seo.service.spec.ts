import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { SeoService } from './seo.service';
import { TOOLS } from '../../config/tools.config';
import { TOOL_GUIDES } from '../../config/tool-guides.config';
import { TOOL_DISCOVERY } from '../../config/tool-discovery.config';
import { KNOWLEDGE_GUIDES } from '../../config/knowledge-guides.config';
import { KNOWLEDGE_GUIDE_CONTENT } from '../../config/knowledge-guide-content.config';

describe('public answer and entity metadata', () => {
  let seo: SeoService;
  let doc: Document;
  const schema = (id: string) => JSON.parse(doc.getElementById(id)!.textContent!);
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SeoService] });
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
  });
  afterEach(() => {
    doc.querySelectorAll('script[id^="safepdfhub-"]').forEach(node => node.remove());
  });
  it('publishes only the canonical tool answers and clears them on subsequent routes', () => {
    for (const tool of TOOLS) {
      seo.updateTool(tool);
      const overview = TOOL_DISCOVERY[tool.slug];
      expect(overview).toBeDefined();
      const faq = schema('safepdfhub-faq-jsonld');
      expect(faq.mainEntity.map((item: { name: string }) => item.name))
        .toEqual(TOOL_GUIDES[tool.slug].questions.map(item => item.question));
      expect(faq.mainEntity.map((item: { acceptedAnswer: { text: string } }) => item.acceptedAnswer.text))
        .toEqual(TOOL_GUIDES[tool.slug].questions.map(item => item.answer));
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
      expect(schema('safepdfhub-toolpage-jsonld').description).toBe(overview.answer);
      expect(schema('safepdfhub-webapplication-jsonld').name).toBe(tool.label);
      expect(schema('safepdfhub-webapplication-jsonld').featureList)
        .toEqual(overview.facts.map(fact => `${fact.label}: ${fact.value}`));
      expect(doc.querySelectorAll('#safepdfhub-faq-jsonld')).toHaveLength(1);
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'))
        .toBe(`https://safepdfhub.com/tools/${tool.slug}`);
    }
    seo.updateForUrl('/privacy');
    for (const id of ['safepdfhub-faq-jsonld', 'safepdfhub-toolpage-jsonld', 'safepdfhub-webapplication-jsonld', 'safepdfhub-breadcrumb-jsonld']) {
      expect(doc.getElementById(id)).toBeNull();
    }
  });
  it('lists only implemented tools on the homepage and keeps Studio non-indexable', () => {
    seo.updateForUrl('/');
    const directory = schema('safepdfhub-tool-list-jsonld');
    expect(directory.numberOfItems).toBe(TOOLS.length);
    expect(directory.itemListElement.map((item: { url: string }) => item.url).sort())
      .toEqual(TOOLS.map(tool => `https://safepdfhub.com/tools/${tool.slug}`).sort());
    seo.updateForUrl('/studio');
    expect(doc.getElementById('safepdfhub-tool-list-jsonld')).toBeNull();
    expect(doc.getElementById('safepdfhub-organization-jsonld')).toBeNull();
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,follow');
  });
  it('publishes complete guide content and replaces article metadata during client navigation', () => {
    expect(new Set(KNOWLEDGE_GUIDES.map(guide => guide.slug)).size).toBe(KNOWLEDGE_GUIDES.length);
    for (const guide of KNOWLEDGE_GUIDES) {
      const content = KNOWLEDGE_GUIDE_CONTENT[guide.slug];
      expect(content.steps.length).toBeGreaterThanOrEqual(3);
      expect(content.sections.length).toBeGreaterThanOrEqual(3);
      expect(content.sections.flatMap(section => section.paragraphs).join(' ').split(/\s+/).length).toBeGreaterThan(250);
      expect(new Set(content.sections.map(section => section.id)).size).toBe(content.sections.length);
      for (const slug of guide.tools) expect(TOOLS.some(tool => tool.slug === slug)).toBe(true);
      seo.updateForUrl(`/guides/${guide.slug}?ref=test`);
      const article = schema('safepdfhub-guide-article-jsonld');
      expect(article.headline).toBe(guide.title);
      expect(article.dateModified).toBe(guide.updated);
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`https://safepdfhub.com/guides/${guide.slug}`);
      expect(doc.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article');
      expect(doc.querySelector('meta[name="keywords"]')).toBeNull();
      expect(doc.getElementById('safepdfhub-faq-jsonld')).toBeNull();
    }
    seo.updateForUrl('/guides');
    expect(schema('safepdfhub-guide-hub-jsonld').mainEntity.numberOfItems).toBe(KNOWLEDGE_GUIDES.length);
    expect(doc.getElementById('safepdfhub-guide-article-jsonld')).toBeNull();
    seo.updateTool(TOOLS[0]);
    expect(doc.getElementById('safepdfhub-guide-hub-jsonld')).toBeNull();
    expect(doc.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('website');
  });
});

import { GUIDE_HUB, KNOWLEDGE_GUIDES, type KnowledgeGuide } from '../../config/knowledge-guides.config';
import { SITE_CONFIG } from '../../config/site.config';

export function knowledgeArticleSchema(guide: KnowledgeGuide): Record<string, unknown> {
  const url = `${SITE_CONFIG.url}/guides/${guide.slug}`;
  return {
    '@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`,
    headline: guide.title, description: guide.summary, url, inLanguage: 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${url}#webpage`, url },
    isPartOf: { '@id': `${SITE_CONFIG.url}/#website` },
    publisher: { '@id': `${SITE_CONFIG.url}/#organization` },
    author: { '@type': 'Organization', name: SITE_CONFIG.name, url: SITE_CONFIG.url },
    dateModified: guide.updated, isAccessibleForFree: true,
    about: guide.tools.map(slug => ({ '@id': `${SITE_CONFIG.url}/tools/${slug}#application` }))
  };
}

export function knowledgeHubSchema(): Record<string, unknown> {
  const url = `${SITE_CONFIG.url}/guides`;
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`,
    url, name: GUIDE_HUB.title, description: GUIDE_HUB.description, inLanguage: 'en',
    isPartOf: { '@id': `${SITE_CONFIG.url}/#website` },
    publisher: { '@id': `${SITE_CONFIG.url}/#organization` },
    mainEntity: { '@type': 'ItemList', numberOfItems: KNOWLEDGE_GUIDES.length,
      itemListElement: KNOWLEDGE_GUIDES.map((guide, index) => ({
        '@type': 'ListItem', position: index + 1, name: guide.title, url: `${url}/${guide.slug}`
      })) }
  };
}

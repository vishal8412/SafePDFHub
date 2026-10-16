import { SITE_CONFIG } from '../../config/site.config';
import { TOOL_DISCOVERY } from '../../config/tool-discovery.config';
import { TOOL_GUIDES } from '../../config/tool-guides.config';
import type { Tool } from '../../config/tools.config';

/** Uses the exact public answers rendered by ToolGuideComponent. */
export function toolDiscoverySchemas(tool: Tool): { page: Record<string, unknown>; faq: Record<string, unknown> } {
  const url = `${SITE_CONFIG.url}/tools/${tool.slug}`;
  const questionUrl = `${url}#${tool.slug}-questions`;
  return {
    page: {
      '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#webpage`,
      url, name: tool.label, description: TOOL_DISCOVERY[tool.slug].answer, inLanguage: 'en',
      isPartOf: { '@id': `${SITE_CONFIG.url}/#website` },
      publisher: { '@id': `${SITE_CONFIG.url}/#organization` },
      mainEntity: { '@id': `${url}#application` },
      breadcrumb: { '@id': `${url}#breadcrumbs` },
      hasPart: { '@id': questionUrl }
    },
    faq: {
      '@context': 'https://schema.org', '@type': 'FAQPage', '@id': questionUrl,
      url: questionUrl, name: `${tool.label} questions and answers`, inLanguage: 'en',
      isPartOf: { '@id': `${url}#webpage` },
      mainEntity: TOOL_GUIDES[tool.slug].questions.map((item, index) => ({
        '@type': 'Question', '@id': `${url}#${tool.slug}-question-${index + 1}`,
        name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    }
  };
}

export interface PageSeoConfig {
  title: string;
  description: string;
  canonicalPath: string;
  keywords?: string;
  indexable?: boolean;
}

/**
 * Canonical metadata for public, indexable site pages.
 * Keep this list aligned with SITE_CONFIG.staticIndexablePaths.
 */
export const PAGE_SEO: Record<string, PageSeoConfig> = {
  '/': {
    title: 'SafePDFHub — Private PDF Tools',
    description: 'Privacy-first PDF tools that process documents locally in your browser.',
    canonicalPath: '/',
    keywords: 'PDF tools, private PDF tools, browser PDF tools, PDF editor'
  },
  '/support': {
    title: 'Support SafePDFHub — Help Keep PDFs Private',
    description: 'Support SafePDFHub and help us keep building useful, privacy-first PDF tools.',
    canonicalPath: '/support',
    keywords: 'support SafePDFHub, PDF tools support, privacy-first PDF tools'
  },
  '/about': {
    title: 'About SafePDFHub — Privacy-First PDF Tools',
    description: 'Learn why SafePDFHub is building practical PDF tools around browser-based processing and document privacy.',
    canonicalPath: '/about',
    keywords: 'about SafePDFHub, privacy-first PDF tools, browser PDF tools'
  },
  '/contact': {
    title: 'Contact SafePDFHub — PDF Tools & Privacy Questions',
    description: 'Contact SafePDFHub with questions, product feedback, support issues, privacy questions, or partnership enquiries.',
    canonicalPath: '/contact',
    keywords: 'contact SafePDFHub, PDF tools support, SafePDFHub contact'
  },
  '/privacy': {
    title: 'Privacy Policy — SafePDFHub',
    description: 'Read the SafePDFHub privacy policy covering browser-based PDF processing, information handling, and third-party services.',
    canonicalPath: '/privacy',
    keywords: 'SafePDFHub privacy policy, PDF privacy, browser PDF processing'
  },
  '/terms': {
    title: 'Terms of Service — SafePDFHub',
    description: 'Read the SafePDFHub Terms of Service for use of its PDF tools, browser editor, and related website services.',
    canonicalPath: '/terms',
    keywords: 'SafePDFHub terms, PDF tools terms of service'
  }
};

export const NON_INDEXABLE_PAGE_SEO: Record<string, PageSeoConfig> = {
  '/studio': {
    title: 'SafePDFHub PDF Editor',
    description: 'Work with PDF documents in the SafePDFHub browser editor.',
    canonicalPath: '/studio',
    indexable: false
  }
};

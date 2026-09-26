export interface Tool {
  slug: string;
  title: string;
  description: string;
  keywords: string;
  category: 'merge' | 'compress' | 'convert' | 'split' | 'security' | 'sign' | 'edit';
  nextTools?: string[]; // slugs of implemented recommended tools
}

/**
 * Public, implemented PDF tools are the source of truth for:
 * - tool routes
 * - sitemap generation
 * - footer/internal links
 * - related-tool recommendations
 *
 * Do not add a tool here until its public page and processing workflow are
 * implemented. This prevents SEO from advertising an unfinished page.
 */
export const TOOLS: Tool[] = [
  {
    slug: 'protect-pdf',
    title: 'Protect PDF with Password Online Free',
    description: 'Password-protect a PDF locally in your browser with optional permissions.',
    keywords: 'protect pdf, password protect pdf, encrypt pdf',
    category: 'security',
    nextTools: ['unlock-pdf']
  },
  {
    slug: 'unlock-pdf',
    title: 'Unlock PDF Online Free',
    description: 'Remove PDF password protection locally when you know the document password.',
    keywords: 'unlock pdf, decrypt pdf, remove pdf password',
    category: 'security',
    nextTools: ['protect-pdf']
  },
  {
    slug: 'compress-pdf',
    title: 'Compress PDF Online Free | Reduce PDF Size',
    description: 'Compress PDF files online for free. Reduce file size without losing quality. 100% secure and private.',
    keywords: 'compress pdf, reduce pdf size, pdf compressor online',
    category: 'compress',
    nextTools: ['merge-pdf', 'split-pdf']
  },
  {
    slug: 'merge-pdf',
    title: 'Merge PDF Files Online Free',
    description: 'Combine multiple PDF files into one. Fast, secure, and works in your browser.',
    keywords: 'merge pdf, combine pdf files, join pdf',
    category: 'merge',
    nextTools: ['compress-pdf', 'split-pdf']
  },
  {
    slug: 'sign-pdf',
    title: 'Sign PDF Online Free',
    description: 'Add a signature, initials, text, dates, and checkboxes to a PDF locally in your browser.',
    keywords: 'sign pdf, electronic signature, e-sign pdf, fill and sign pdf',
    category: 'sign',
    nextTools: ['protect-pdf', 'unlock-pdf']
  },
  {
    slug: 'watermark-pdf',
    title: 'Watermark PDF Online Free',
    description: 'Add text or image watermarks to PDF pages locally in your browser with adjustable opacity, rotation, position, and page range.',
    keywords: 'watermark pdf, add watermark to pdf, pdf watermark, image watermark pdf, text watermark pdf',
    category: 'edit',
    nextTools: ['protect-pdf', 'sign-pdf', 'compress-pdf']
  },
  {
    slug: 'split-pdf',
    title: 'Split PDF Online Free',
    description: 'Split PDF into multiple pages instantly. No upload required.',
    keywords: 'split pdf, extract pdf pages',
    category: 'split',
    nextTools: ['merge-pdf', 'compress-pdf']
  }
];

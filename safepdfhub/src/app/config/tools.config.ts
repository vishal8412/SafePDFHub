export type ToolIcon = 'Zap' | 'Files' | 'Scissors' | 'Shield' | 'Lock' | 'Sparkles' | 'FileText';

export interface Tool {
  slug: string;
  /** SEO/page title. */
  title: string;
  /** SEO/meta description. */
  description: string;
  keywords: string;
  category: 'merge' | 'compress' | 'convert' | 'split' | 'security' | 'sign' | 'edit';
  /** Human-facing label shared by the homepage and footer. */
  label: string;
  /** Short marketing description used by compact tool cards. */
  shortDescription: string;
  /** Lucide icon key used by UI surfaces without coupling this config to Angular components. */
  icon: ToolIcon;
  /** Explicit display order for public navigation surfaces. */
  displayOrder: number;
  nextTools?: string[]; // slugs of implemented recommended tools
}

/**
 * Public, implemented PDF tools are the source of truth for:
 * - tool routes
 * - sitemap generation
 * - footer/internal links
 * - related-tool recommendations
 * - homepage toolbox
 *
 * Do not add a tool here until its public page and processing workflow are
 * implemented. This prevents SEO/navigation from advertising an unfinished page.
 */
export const TOOLS: Tool[] = [
  { slug: 'pdf-to-word', title: 'PDF to Word Converter | Editable DOCX Online',
    description: 'Convert PDFs to Word DOCX locally. Extract editable text or preserve pages as images. Recognize scanned English, Hindi or Marathi text with local OCR. Up to 200 MB with no fixed page limit.',
    keywords: 'pdf to word, pdf to docx, convert pdf to word', category: 'convert', label: 'PDF to Word',
    shortDescription: 'Convert PDFs to Word documents', icon: 'FileText', displayOrder: 8, nextTools: ['split-pdf', 'unlock-pdf'] },
  {
    slug: 'compress-pdf',
    title: 'Compress PDF Online Free | Reduce PDF Size',
    description: 'Reduce PDF size locally with lossless or image compression, or try a target size in MB. Up to 500 MB on supported desktops; device limits apply.',
    keywords: 'compress pdf, reduce pdf size, pdf compressor online',
    category: 'compress',
    label: 'Compress PDF',
    shortDescription: 'Reduce PDF file size',
    icon: 'Zap',
    displayOrder: 1,
    nextTools: ['merge-pdf', 'split-pdf']
  },
  {
    slug: 'merge-pdf',
    title: 'Merge PDF Files Online Free',
    description: 'Combine multiple PDF files into one. Fast, secure, and works in your browser.',
    keywords: 'merge pdf, combine pdf files, join pdf',
    category: 'merge',
    label: 'Merge PDF',
    shortDescription: 'Combine multiple PDFs',
    icon: 'Files',
    displayOrder: 2,
    nextTools: ['compress-pdf', 'split-pdf']
  },
  {
    slug: 'split-pdf',
    title: 'Split PDF Online Free',
    description: 'Extract pages or split a PDF into separate files locally in your browser. No document upload required.',
    keywords: 'split pdf, extract pdf pages',
    category: 'split',
    label: 'Split PDF',
    shortDescription: 'Extract pages from a PDF',
    icon: 'Scissors',
    displayOrder: 3,
    nextTools: ['merge-pdf', 'compress-pdf']
  },
  {
    slug: 'protect-pdf',
    title: 'Protect PDF with Password Online Free',
    description: 'Password-protect a PDF locally in your browser with optional permissions.',
    keywords: 'protect pdf, password protect pdf, encrypt pdf',
    category: 'security',
    label: 'Protect PDF',
    shortDescription: 'Add password protection',
    icon: 'Shield',
    displayOrder: 4,
    nextTools: ['unlock-pdf']
  },
  {
    slug: 'unlock-pdf',
    title: 'Unlock PDF Online Free',
    description: 'Remove PDF password protection locally when you know the document password.',
    keywords: 'unlock pdf, decrypt pdf, remove pdf password',
    category: 'security',
    label: 'Unlock PDF',
    shortDescription: 'Remove password protection',
    icon: 'Lock',
    displayOrder: 5,
    nextTools: ['protect-pdf']
  },
  {
    slug: 'sign-pdf',
    title: 'Sign PDF Online Free',
    description: 'Add a signature, initials, text, dates, and checkboxes to a PDF locally in your browser.',
    keywords: 'sign pdf, electronic signature, e-sign pdf, fill and sign pdf',
    category: 'sign',
    label: 'Sign PDF',
    shortDescription: 'Add a signature and fill fields',
    icon: 'Sparkles',
    displayOrder: 6,
    nextTools: ['protect-pdf', 'unlock-pdf']
  },
  {
    slug: 'watermark-pdf',
    title: 'Watermark PDF Online Free',
    description: 'Add text or image watermarks to PDF pages locally in your browser with adjustable opacity, rotation, position, and page range.',
    keywords: 'watermark pdf, add watermark to pdf, pdf watermark, image watermark pdf, text watermark pdf',
    category: 'edit',
    label: 'Watermark PDF',
    shortDescription: 'Add text or image watermark',
    icon: 'FileText',
    displayOrder: 7,
    nextTools: ['protect-pdf', 'sign-pdf', 'compress-pdf']
  }
];

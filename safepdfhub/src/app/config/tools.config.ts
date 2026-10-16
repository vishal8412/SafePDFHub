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
  { slug: 'word-to-pdf', title: 'Word to PDF – Convert DOCX in Your Browser | SafePDFHub',
    description: 'Convert a DOCX to a downloadable PDF in your browser without uploading the document. Review formatting and conversion notes before sharing.',
    keywords: 'word to pdf, docx to pdf, convert word to pdf', category: 'convert', label: 'Word to PDF',
    shortDescription: 'Turn Word documents into PDFs', icon: 'FileText', displayOrder: 9, nextTools: ['compress-pdf', 'merge-pdf'] },
  { slug: 'pdf-to-word', title: 'PDF to Word – Convert PDF to DOCX with OCR | SafePDFHub',
    description: 'Convert PDF to Word locally. Choose editable text with English, Hindi or Marathi OCR, or preserve pages as images. Review and download your DOCX.',
    keywords: 'pdf to word, pdf to docx, convert pdf to word', category: 'convert', label: 'PDF to Word',
    shortDescription: 'Convert PDFs to Word documents', icon: 'FileText', displayOrder: 8, nextTools: ['split-pdf', 'unlock-pdf'] },
  {
    slug: 'compress-pdf',
    title: 'Compress PDF Online – Reduce PDF Size | SafePDFHub',
    description: 'Compress PDFs in your browser. Choose quality or a target size, review the actual result, and download. Your documents stay on your device.',
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
    title: 'Merge PDF Online – Combine PDF Files | SafePDFHub',
    description: 'Merge two or more PDFs in your chosen order without uploading them. Review the result and download one combined PDF from your browser.',
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
    title: 'Split PDF Online – Extract PDF Pages | SafePDFHub',
    description: 'Split a PDF or extract selected pages and page ranges locally in your browser. Create new PDF files while keeping your original unchanged.',
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
    title: 'Protect PDF – Add a Password Online | SafePDFHub',
    description: 'Add password protection to a PDF in your browser. Choose your password, review optional permissions, and download a protected copy.',
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
    title: 'Unlock PDF – Remove a Known Password | SafePDFHub',
    description: 'Remove PDF password protection when you know the password. Unlock locally in your browser and download a separate copy without uploading your document.',
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
    title: 'Sign PDF Online – Add a Visible Signature | SafePDFHub',
    description: 'Place a visible signature, initials, text, dates, or checkboxes on PDF pages. Review and download the result locally, with no signup.',
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
    title: 'Watermark PDF – Add Text or Images | SafePDFHub',
    description: 'Add a text or image watermark to selected PDF pages. Adjust position, opacity, and rotation, then download the result from your browser.',
    keywords: 'watermark pdf, add watermark to pdf, pdf watermark, image watermark pdf, text watermark pdf',
    category: 'edit',
    label: 'Watermark PDF',
    shortDescription: 'Add text or image watermark',
    icon: 'FileText',
    displayOrder: 7,
    nextTools: ['protect-pdf', 'sign-pdf', 'compress-pdf']
  }
];

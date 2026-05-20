export interface Tool {
  slug: string;
  title: string;
  description: string;
  keywords: string;
  category: 'merge' | 'compress' | 'convert' | 'split';
  nextTools?: string[]; // slugs of recommended tools
}

export const TOOLS: Tool[] = [
  {
    slug: 'compress-pdf',
    title: 'Compress PDF Online Free | Reduce PDF Size',
    description: 'Compress PDF files online for free. Reduce file size without losing quality. 100% secure and private.',
    keywords: 'compress pdf, reduce pdf size, pdf compressor online',
    category: 'compress',
    nextTools: ['merge-pdf', 'pdf-to-word']
  },
  {
    slug: 'merge-pdf',
    title: 'Merge PDF Files Online Free',
    description: 'Combine multiple PDF files into one. Fast, secure, and works in your browser.',
    keywords: 'merge pdf, combine pdf files, join pdf',
    category: 'merge',
    nextTools: ['compress-pdf', 'split-pdf', 'pdf-to-word']
  },
  {
    slug: 'split-pdf',
    title: 'Split PDF Online Free',
    description: 'Split PDF into multiple pages instantly. No upload required.',
    keywords: 'split pdf, extract pdf pages',
    category: 'split',
    nextTools: ['merge-pdf', 'compress-pdf', 'pdf-to-word']
  },
  {
    slug: 'pdf-to-word',
    title: 'Convert PDF to Word Online',
    description: 'Convert PDF to editable Word documents quickly and securely.',
    keywords: 'pdf to word, convert pdf to doc',
    category: 'convert',
    nextTools: ['compress-pdf', 'split-pdf', 'pdf-to-word']
  }
];
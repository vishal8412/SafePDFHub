export interface KnowledgeGuide {
  slug: string; title: string; seoTitle: string; description: string; summary: string;
  category: string; tools: readonly string[]; updated: string; primaryKeyword: string;
}

export const GUIDE_HUB = {
  title: 'PDF guides: smaller files, cleaner conversions, fewer surprises',
  seoTitle: 'PDF Guides: Compression, Conversion & Privacy | SafePDFHub',
  description: 'Practical PDF guides for target file sizes, scanned documents, merging, page extraction, OCR, Word formatting, and private browser processing.'
};

/** One canonical guide per distinct problem; size and device variants share a guide. */
export const KNOWLEDGE_GUIDES: readonly KnowledgeGuide[] = [
  {
    slug: 'compress-pdf-to-target-size', title: 'How to compress a PDF to a specific size',
    seoTitle: 'Compress PDF to 1 MB, 2 MB or 5 MB: A Guide | SafePDFHub',
    description: 'Set a PDF target size in MB, check the actual result, and decide what to do when a document cannot fit a 1 MB, 2 MB or 5 MB limit.',
    summary: 'A file-size limit is an acceptance rule, not a guarantee that every PDF can fit. Start with the required size, compare the actual output, and protect readability before trying a stronger reduction.',
    category: 'Compression', tools: ['compress-pdf', 'split-pdf'], updated: '2026-10-16', primaryKeyword: 'how to compress PDF to a specific size'
  },
  {
    slug: 'compress-scanned-pdf', title: 'How to compress a scanned PDF and keep it readable',
    seoTitle: 'Compress a Scanned PDF: Size vs Readability | SafePDFHub',
    description: 'Understand image-heavy PDFs, choose a compression mode, and check text, stamps, and diagrams before sharing a smaller scanned document.',
    summary: 'A scanned PDF usually stores a picture of each page. Smaller image data can reduce the file size, but aggressive compression can erase fine detail. The useful result is a readable document that meets the submission requirement.',
    category: 'Compression', tools: ['compress-pdf', 'pdf-to-word'], updated: '2026-10-16', primaryKeyword: 'how to compress a scanned PDF'
  },
  {
    slug: 'why-pdf-size-is-not-reducing', title: 'Why your PDF is not getting much smaller',
    seoTitle: 'PDF Not Compressing? Causes and Next Steps | SafePDFHub',
    description: 'Learn why optimized PDFs may shrink very little, how compression modes differ, and which checks to make before trying again.',
    summary: 'Small savings do not always mean that compression failed. A PDF may already contain compact images and compressed text, or its largest objects may not be suitable for further reduction with the selected method.',
    category: 'Troubleshooting', tools: ['compress-pdf', 'split-pdf'], updated: '2026-10-16', primaryKeyword: 'why PDF size is not reducing'
  },
  {
    slug: 'merge-pdf-files-in-order', title: 'How to merge PDF files in the right order',
    seoTitle: 'Merge PDFs in the Right Order: Step-by-Step | SafePDFHub',
    description: 'Prepare PDF files, arrange their order, merge locally, and check page boundaries, orientation, and file size in the finished document.',
    summary: 'A successful merge combines the right files in the right sequence. Prepare a simple order first, arrange the PDFs in the workspace, and check the transitions between documents in the downloaded result.',
    category: 'Organizing pages', tools: ['merge-pdf', 'split-pdf', 'compress-pdf'], updated: '2026-10-16', primaryKeyword: 'how to merge PDF files in order'
  },
  {
    slug: 'extract-pages-from-pdf', title: 'How to extract selected pages from a PDF',
    seoTitle: 'Extract Pages from a PDF: Ranges Explained | SafePDFHub',
    description: 'Select PDF pages using workspace positions, avoid printed-page-number confusion, and verify the extracted files before sharing.',
    summary: 'Extracting pages makes a new PDF from part of an existing document. Use the page positions shown in the workspace, which may differ from page numbers printed inside the document.',
    category: 'Organizing pages', tools: ['split-pdf', 'merge-pdf'], updated: '2026-10-16', primaryKeyword: 'how to extract pages from a PDF'
  },
  {
    slug: 'convert-scanned-pdf-to-word', title: 'How to convert a scanned PDF to Word with OCR',
    seoTitle: 'Scanned PDF to Word with OCR: A Guide | SafePDFHub',
    description: 'Choose editable text or page appearance, select English, Hindi or Marathi OCR, and proofread uncertain words and numbers in the DOCX.',
    summary: 'An image of a word is different from editable text. OCR attempts to recognize letters in scanned pages. SafePDFHub can use OCR during PDF-to-Word conversion, while uncertain pages may remain images rather than becoming unreliable text.',
    category: 'Conversion', tools: ['pdf-to-word', 'unlock-pdf'], updated: '2026-10-16', primaryKeyword: 'how to convert scanned PDF to Word'
  },
  {
    slug: 'word-to-pdf-formatting', title: 'Why Word-to-PDF conversion can change your layout',
    seoTitle: 'Word to PDF Formatting Problems: What to Check | SafePDFHub',
    description: 'Troubleshoot font substitution, wrapping, spacing, tables, and extra pages when converting a DOCX to PDF in the browser.',
    summary: 'Word lays out a flowing document; PDF stores the final page arrangement. If a converter uses different fonts or interprets document features differently, line wrapping and page breaks can change.',
    category: 'Troubleshooting', tools: ['word-to-pdf', 'compress-pdf'], updated: '2026-10-16', primaryKeyword: 'Word to PDF formatting changes'
  },
  {
    slug: 'private-pdf-tools', title: 'How to choose a private PDF workflow',
    seoTitle: 'Private PDF Tools: Local vs Cloud Processing | SafePDFHub',
    description: 'Compare local browser and server processing, understand device limits, and check the privacy details of a PDF workflow before selecting a file.',
    summary: 'A tool opening in your browser does not necessarily mean the document stays there. Check where document processing happens, which resources the website loads, and what the tool says about storage and data handling.',
    category: 'Privacy', tools: ['compress-pdf', 'merge-pdf', 'protect-pdf'], updated: '2026-10-16', primaryKeyword: 'private PDF tools without uploading'
  }
];

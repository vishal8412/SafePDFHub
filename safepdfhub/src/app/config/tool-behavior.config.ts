export interface ToolBehavior {

  slug: string;

  // upload
  allowMultiple: boolean;

  replaceOnUpload: boolean;

  acceptedTypes: string;

  // ui
  heroTitle: string;

  heroDescription: string;

  uploadTitle: string;

  uploadButtonText: string;

  uploadHint: string;

  // workflow
  autoAnalyze?: boolean;

  showWorkflowSuggestions?: boolean;

  showQuickActions?: boolean;

  primaryActionText?: string;
}

export const TOOL_BEHAVIORS: ToolBehavior[] = [

  // =========================
  // MERGE PDF
  // =========================
  {
    slug: 'merge-pdf',

    allowMultiple: true,

    replaceOnUpload: false,

    acceptedTypes: '.pdf,application/pdf',

    heroTitle: 'Merge PDFs instantly',

    heroDescription:
      'Fast and private browser-based processing. No uploads required.',

    uploadTitle: 'Drag & drop PDFs here',

    uploadButtonText: 'Select PDF files',

    uploadHint:
      'Max per file: 100 MB • Max total: 400 MB',

    showWorkflowSuggestions: true,

    showQuickActions: true,

    primaryActionText: 'Merge PDFs'
  },

  // =========================
  // COMPRESS PDF
  // =========================
  {
    slug: 'compress-pdf',

    allowMultiple: false,

    replaceOnUpload: true,

    acceptedTypes: '.pdf,application/pdf',

    heroTitle: 'Compress PDFs instantly',

    heroDescription:
      'Reduce PDF size without losing quality',

    uploadTitle: 'Drop your PDF here',

    uploadButtonText: 'Select PDF File',

    uploadHint:
      'Supports single PDF up to 100 MB',

    autoAnalyze: true,

    showWorkflowSuggestions: false,

    showQuickActions: true,

    primaryActionText: 'Compress PDF'
  },

  // =========================
  // SPLIT PDF
  // =========================
  {
    slug: 'split-pdf',

    allowMultiple: false,

    replaceOnUpload: true,

    acceptedTypes: '.pdf,application/pdf',

    heroTitle: 'Split PDFs instantly',

    heroDescription:
      'Extract pages securely in your browser.',

    uploadTitle: 'Drop your PDF here',

    uploadButtonText: 'Select PDF',

    uploadHint:
      'Supports single PDF up to 100 MB',

    showQuickActions: true,

    primaryActionText: 'Split PDF'
  }

];
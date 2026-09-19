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
  maxFilesOverride?: number;
  maxPagesOverride?: number;
}

export const TOOL_BEHAVIORS: ToolBehavior[] = [

  // =========================
  // PDF SECURITY
  // =========================
  {
    slug: 'protect-pdf',
    allowMultiple: false,
    replaceOnUpload: true,
    acceptedTypes: '.pdf,application/pdf',
    heroTitle: 'Protect your PDF with a password',
    heroDescription: 'Encrypt and protect your PDF locally in your browser.',
    uploadTitle: 'Drop your PDF here',
    uploadButtonText: 'Select PDF',
    uploadHint: 'Your PDF and password stay on your device',
    showQuickActions: false,
    primaryActionText: 'Protect PDF'
  },
  {
    slug: 'unlock-pdf',
    allowMultiple: false,
    replaceOnUpload: true,
    acceptedTypes: '.pdf,application/pdf',
    heroTitle: 'Unlock a password-protected PDF',
    heroDescription: 'Remove PDF password protection locally when you know its password.',
    uploadTitle: 'Drop your protected PDF here',
    uploadButtonText: 'Select PDF',
    uploadHint: 'The password is used only in your browser',
    showQuickActions: false,
    primaryActionText: 'Unlock PDF'
  },


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
      'Capacity is adjusted for your device • PDF files stay on your device',

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
      'Capacity is adjusted for your device • PDF stays on your device',

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
      'Capacity is adjusted for your device • PDF stays on your device',

    showQuickActions: true,

    primaryActionText: 'Split PDF'
  }

];
/** User-facing guidance describing implemented workflows and their limitations. */
export interface ToolGuide { steps: string[]; questions: { question: string; answer: string }[]; }
export const TOOL_GUIDES: Record<string, ToolGuide> = {
  'pdf-to-word': {
    steps: ['Choose a PDF from your device.', 'Choose Editable text with automatic OCR and your document language, or Keep page appearance.', 'Convert, review the result and any image-only page notices, then download your Word document.'],
    questions: [
      { question: 'Will the Word text be editable?', answer: 'Editable mode extracts selectable text and offers OCR in English, Hindi or Marathi after you choose the language. Low-resolution scans, detected tables, and uncertain recognition are preserved as images. Review recognized words and numbers. Pages that cannot be recognized are preserved as images and identified in the result.' },
      { question: 'Will the layout match exactly?', answer: 'Editable conversion can change fonts, spacing, columns and tables. Review your DOCX in Word. Keep page appearance mode preserves the page visually as an image, but text inside the image cannot be edited.' },
      { question: 'Are my files uploaded?', answer: 'No. PDF reading, OCR and DOCX generation run locally in your browser. OCR software and selected language assets load from this website. Your original PDF stays unchanged.' },
      { question: 'How large can my PDF be?', answer: 'PDF to Word accepts files up to 200 MB with no fixed page-count limit. Processing runs one page at a time. Large scans take longer, and available device memory still affects completion.' },
      { question: 'Can I convert a password-protected PDF?', answer: 'First use Unlock PDF with the document password. Conversion also requires permission to copy content.' }
    ]
  },
  'compress-pdf': {
    steps: ['Choose a PDF from your device.', 'Select High Quality, Smart Compression, Maximum Reduction, or a target size in MB.', 'Compress, check the actual result size, and download your PDF.'],
    questions: [
      { question: 'Which compression option should I use?', answer: 'High Quality uses lossless optimization. Smart Compression and Maximum Reduction can recompress supported JPEG images, with Maximum Reduction using lower image quality. PDFs with little compressible content may produce similar results across modes.' },
      { question: 'Can I compress a PDF to 1 MB, 2 MB, or 5 MB?', answer: 'Enter your target size in MB. The tool tries to reach it while keeping a valid PDF. Some documents cannot reach the requested size; the result shows the actual size and whether the target was met.' },
      { question: 'What is the maximum PDF size?', answer: 'Supported desktops can accept up to 500 MB. Phones and tablets have lower limits based on available browser features and reported memory. The upload area shows this device’s limit. PDFs above 200 MB use lossless compression, and large-file processing requires temporary browser storage.' },
      { question: 'Will compression always make my PDF smaller?', answer: 'No. Already optimized PDFs and unsupported image formats may offer little reduction. Image recompression can affect appearance, so check the downloaded PDF before sharing it.' }
    ]
  },
  'merge-pdf': {
    steps: ['Choose two or more PDFs.', 'Arrange the files in the order you want.', 'Merge and download the combined PDF.'],
    questions: [{ question: 'Does file order affect the merged PDF?', answer: 'Yes. The exported PDF follows the file order shown in the workspace. Arrange the files before merging.' }]
  },
  'split-pdf': {
    steps: ['Choose a PDF.', 'Select the pages or page ranges you need in the split workspace.', 'Split and download the resulting PDF files.'],
    questions: [{ question: 'Can I extract specific pages?', answer: 'Yes. Select the pages or ranges you want to keep. Check the resulting files before sharing them.' }]
  },
  'protect-pdf': {
    steps: ['Choose a PDF.', 'Set a password and review the available permissions.', 'Protect and download the encrypted PDF.'],
    questions: [{ question: 'Can SafePDFHub recover a forgotten password?', answer: 'No. Keep your password somewhere safe. Your PDF and password are processed on your device.' }]
  },
  'unlock-pdf': {
    steps: ['Choose a password-protected PDF you are authorized to modify.', 'Enter its password.', 'Unlock and download the resulting PDF.'],
    questions: [{ question: 'Can I unlock a PDF without its password?', answer: 'This tool requires the document password. It does not recover or guess forgotten passwords.' }]
  },
  'sign-pdf': {
    steps: ['Choose a PDF.', 'Place your signature, initials, text, dates, or checkboxes.', 'Review and download the signed PDF.'],
    questions: [{ question: 'Is this a certificate-based digital signature?', answer: 'The tool places a visible signature on PDF pages. It does not issue a cryptographic signing certificate. Legal requirements for electronic signatures depend on your use case and location.' }]
  },
  'watermark-pdf': {
    steps: ['Choose a PDF.', 'Add a text or image watermark and set its position, opacity, rotation, and page range.', 'Apply the watermark and download your PDF.'],
    questions: [{ question: 'Can I watermark only selected pages?', answer: 'Yes. Set the page range before applying the watermark and review the exported PDF.' }]
  }
};

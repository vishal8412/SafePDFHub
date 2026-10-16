/** Public product facts. Render these same answers in HTML and structured data. */
export interface ToolDiscovery {
  question: string;
  answer: string;
  facts: readonly { label: string; value: string }[];
  consideration: string;
}

export const TOOL_DISCOVERY: Record<string, ToolDiscovery> = {
  'compress-pdf': {
    question: 'How can I reduce the size of a PDF?',
    answer: 'SafePDFHub compresses PDF files in your browser using lossless optimization or image compression. Choose a compression mode or enter a target size, then review the actual output size before downloading. The achievable reduction depends on the document’s existing compression and image content.',
    facts: [{ label: 'Input', value: 'One PDF document' }, { label: 'Output', value: 'A PDF with its actual compressed size shown' }, { label: 'Processing', value: 'Local browser processing; device limits apply' }],
    consideration: 'A target size is a request, not a guarantee. Check that small text and scanned pages remain readable.'
  },
  'merge-pdf': {
    question: 'How do I combine PDF files into one document?',
    answer: 'Choose two or more PDFs in SafePDFHub, arrange their order, and merge them into one downloadable PDF. The page order follows the file order in the workspace. Merging combines documents; it does not automatically reduce their file size.',
    facts: [{ label: 'Input', value: 'Two or more PDF documents' }, { label: 'Output', value: 'One combined PDF in your chosen order' }, { label: 'Processing', value: 'Files are processed in your browser' }],
    consideration: 'Unlock password-protected files first using their document passwords. Review page order in the finished PDF.'
  },
  'split-pdf': {
    question: 'How do I extract pages from a PDF?',
    answer: 'Open your PDF in SafePDFHub and select the pages or page ranges you want to extract. The split tool creates new PDF files from your selection while leaving the original file unchanged. Use the displayed page numbers to check your selection before exporting.',
    facts: [{ label: 'Input', value: 'One PDF document' }, { label: 'Output', value: 'PDF files containing the selected pages' }, { label: 'Processing', value: 'Page extraction runs in your browser' }],
    consideration: 'Printed page labels can differ from the page positions shown in the workspace. Verify the selected pages before sharing.'
  },
  'protect-pdf': {
    question: 'How do I add a password to a PDF?',
    answer: 'SafePDFHub adds password protection to a PDF locally in your browser. Select a document, enter the password you want to use, review the optional permissions, and download the protected copy. Keep the password safe because SafePDFHub cannot recover it for you.',
    facts: [{ label: 'Input', value: 'A PDF and the password you choose' }, { label: 'Output', value: 'A password-protected PDF copy' }, { label: 'Processing', value: 'Your PDF and password are processed locally' }],
    consideration: 'Permissions depend on PDF reader support. They should not be treated as a guarantee against copying or screenshots.'
  },
  'unlock-pdf': {
    question: 'How do I remove a PDF password that I know?',
    answer: 'Open the protected PDF in SafePDFHub, enter its document password, and download an unlocked copy. Processing happens in your browser. This tool requires the password and does not guess or recover forgotten passwords.',
    facts: [{ label: 'Input', value: 'A protected PDF and its document password' }, { label: 'Output', value: 'An unlocked PDF copy' }, { label: 'Processing', value: 'Your PDF and password stay on your device' }],
    consideration: 'Only unlock documents you own or have permission to modify. Keep the original protected file if you still need it.'
  },
  'sign-pdf': {
    question: 'How do I add a visible signature to a PDF?',
    answer: 'Use SafePDFHub to place a visible signature, initials, text, dates, or checkboxes on PDF pages, then review and download the signed copy. Editing runs in your browser. This tool adds visible marks; it does not create a certificate-based digital signature.',
    facts: [{ label: 'Input', value: 'A PDF to fill or sign' }, { label: 'Output', value: 'A PDF containing your placed signature and fields' }, { label: 'Processing', value: 'Signing edits run locally in your browser' }],
    consideration: 'Confirm the recipient’s signing requirements before relying on a visible signature for a document submission.'
  },
  'watermark-pdf': {
    question: 'How do I add a text or image watermark to a PDF?',
    answer: 'Choose your PDF in SafePDFHub, add a text or image watermark, and adjust its position, opacity, rotation, and page range. Apply the watermark and download a new PDF. Your document and watermark are processed locally in the browser.',
    facts: [{ label: 'Input', value: 'A PDF plus watermark text or an image' }, { label: 'Output', value: 'A PDF with the watermark on selected pages' }, { label: 'Processing', value: 'Watermark placement happens on your device' }],
    consideration: 'A visible watermark identifies content but does not encrypt the PDF or prevent someone from copying it.'
  },
  'pdf-to-word': {
    question: 'How do I convert a PDF to a Word document?',
    answer: 'SafePDFHub converts a PDF to a DOCX file in your browser. Choose editable text with automatic OCR for supported scans, or keep page appearance by placing page images in Word. Editable conversion can change formatting, so review the generated document before using it.',
    facts: [{ label: 'Input', value: 'One PDF document' }, { label: 'Output', value: 'A Word DOCX with editable text or page images' }, { label: 'Processing', value: 'PDF reading, OCR, and DOCX generation run locally' }],
    consideration: 'OCR supports English, Hindi, and Marathi. Uncertain recognition and detected scanned tables may remain page images.'
  },
  'word-to-pdf': {
    question: 'How do I convert a Word document to PDF in my browser?',
    answer: 'Choose a DOCX file in SafePDFHub and convert it into a downloadable PDF locally in your browser. No print dialog is required. Browser font substitution and pagination can affect layout, so compare the output with your Word document before sharing it.',
    facts: [{ label: 'Input', value: 'An unencrypted Word DOCX file' }, { label: 'Output', value: 'A directly downloadable PDF file' }, { label: 'Processing', value: 'DOCX reading and PDF generation run locally' }],
    consideration: 'Older DOC files must be saved as DOCX first. Advanced Word layouts and some embedded content are not supported.'
  }
};

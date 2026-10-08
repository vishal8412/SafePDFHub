/** User-facing guidance describing implemented workflows and their limitations. */
export interface ToolGuide { steps: string[]; questions: { question: string; answer: string }[]; }
export const TOOL_GUIDES: Record<string, ToolGuide> = {
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
    steps: [
      'Select two or more PDF files from your device. Check the upload area for this device’s file and size limits.',
      'Review the selected files and arrange them in the order you want. Remove any file you do not need before merging.',
      'Select Merge PDFs. On the result page, review the final file size, then choose Download merged PDF.'
    ],
    questions: [
      { question: 'What order will the pages appear in?', answer: 'Files are combined in the order shown in the workspace. All pages from the first PDF come first, followed by all pages from the next PDF. Page order within each source file stays the same.' },
      { question: 'Does merging reduce the file size?', answer: 'Merging combines documents; it does not target a smaller file size. The result size depends on the contents of your PDFs. If you need a smaller file, use Compress PDF after merging and review the result.' },
      { question: 'Will my text and images keep their quality?', answer: 'The merge tool copies PDF pages without converting them to screenshots or lowering image quality. Check the downloaded document before sharing it, especially if your source files contain interactive elements.' },
      { question: 'Can I merge large PDFs on a phone or tablet?', answer: 'The upload area shows the limits supported by your device. Large PDFs require more browser memory, so a desktop is better suited to demanding merges. Keep this tab open while the files are being processed.' }
    ]
  },
  'split-pdf': {
    steps: [
      'Select a PDF from your device. Check the upload area for the file-size limit supported by this device.',
      'Use Range, Every Page, Every N, or Extract. Enter the page numbers or group size, then review the list of files to be created.',
      'Run the split operation. Save the ZIP containing your new PDFs, or download individual PDFs from the result page.'
    ],
    questions: [
      { question: 'What is the difference between Range and Extract?', answer: 'Range creates a separate PDF for each comma-separated page range. For example, 1-3,4-10 creates two PDFs. Extract places selected individual pages, such as 1,5,8, together in one PDF.' },
      { question: 'Which page numbers should I enter?', answer: 'Use the page position in the PDF, starting at 1. A printed page label may be different: a cover or contents page also counts. Choose only page numbers that exist in your document.' },
      { question: 'How do I download the split files?', answer: 'The tool creates a ZIP containing the resulting PDFs. The result page also lets you download individual PDFs or download the ZIP again. Open the ZIP on your device to access all of its files.' },
      { question: 'Does splitting change my original PDF or reduce image quality?', answer: 'Your original file stays unchanged. Selected pages are copied into new PDFs without converting them to screenshots or recompressing their images. Review the exported files before sharing them.' },
      { question: 'Will splitting make my PDF smaller?', answer: 'A PDF containing fewer pages may be smaller, but splitting does not target a file size. Images, fonts, and other resources can be included in multiple outputs, so their combined size may exceed the original. Use Compress PDF if you need to reduce an output file further.' }
    ]
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

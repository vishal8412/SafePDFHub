/** User-facing guidance describing implemented workflows and their limitations. */
export interface ToolGuide { steps: string[]; questions: { question: string; answer: string }[]; }
export const TOOL_GUIDES: Record<string, ToolGuide> = {
  'word-to-pdf': {
    steps: ['Choose a DOCX file from your device.', 'Click Convert to PDF and keep the tab open while it processes locally.', 'Download the generated PDF from the result screen.'],
    questions: [
      { question: 'Does my Word file leave my device?', answer: 'No. DOCX reading and PDF generation run locally in your browser. Only bundled conversion fonts are loaded from this website.' },
      { question: 'Will the layout match Microsoft Word?', answer: 'Compatible fonts and local pagination can change line breaks. Ordinary text, images, simple tables, and text headers and footers are supported. Advanced layouts may be rejected. Check the converted PDF and any conversion notes.' },
      { question: 'Do I need the print dialog?', answer: 'No. The converter generates a PDF file directly. Click Download PDF when conversion finishes.' },
      { question: 'How large can my DOCX be?', answer: 'The input limit is 200 MB. Archive parts are read as needed without copying the complete file into JavaScript memory. Available device memory and document complexity still affect conversion. Individual parts have resource limits.' },
      { question: 'Which files are supported?', answer: 'Use an unencrypted DOCX with embedded PNG or JPEG images. Save older DOC files as DOCX first. Grouped drawings and DrawingML text boxes are supported. Macros, external images, equations, legacy VML-only drawings, footnotes, nested tables and multi-column layouts are not currently supported.' }
    ]
  },
  'pdf-to-word': {
    steps: ['Choose a PDF from your device.', 'Choose Editable text with automatic OCR and your document language, or Keep page appearance.', 'Convert, review the result and any image-only page notices, then download your Word document.'],
    questions: [
      { question: 'Will the Word text be editable?', answer: 'Choose Editable text to extract selectable text or attempt OCR on scans in English, Hindi or Marathi. Low-resolution scans, detected tables and uncertain recognition stay as images; the result identifies those pages. Proofread recognized words and numbers. Keep page appearance produces page images with no editable text inside them.' },
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
      { question: 'What is the maximum PDF size?', answer: 'Compress PDF accepts up to 300 MB on supported desktops. Phones and tablets may have lower limits based on available browser features and reported memory. The upload area shows this device’s limit. Smart Compression, Maximum Reduction and target-size attempts can reduce supported images up to this limit. Large-file processing requires temporary browser storage; resource or validation limits may retain a lossless result.' },
      { question: 'Will compression always make my PDF smaller?', answer: 'No. Already optimized PDFs and unsupported image formats may offer little reduction. Image recompression can affect appearance, so check the downloaded PDF before sharing it.' },
      { question: 'Can I compress a scanned PDF?', answer: 'Scanned PDFs store page content as images. Image compression can reduce supported image content, but the result depends on its resolution, encoding, and existing compression. Use a target size or an image compression mode and check the readability of small text in the downloaded file.' }
    ]
  },
  'merge-pdf': {
    steps: ['Choose two or more PDFs.', 'Arrange the files in the order you want.', 'Merge and download the combined PDF.'],
    questions: [
      { question: 'Does file order affect the merged PDF?', answer: 'Yes. The exported PDF follows the file order shown in the workspace. Arrange the files before merging.' },
      { question: 'How many PDFs do I need to merge?', answer: 'Select at least two PDF files. The Merge PDF button becomes available when there are enough valid files. Device capacity and document complexity limit how many files can be processed together.' },
      { question: 'Will merging also compress my PDFs?', answer: 'Merging combines pages into one document. It is not a compression setting, and the output size can differ from the combined input size because PDF resources and document structure must be rewritten. Use Compress PDF afterward if you need a smaller file.' },
      { question: 'Can I merge password-protected PDFs?', answer: 'Unlock each protected PDF with its document password before merging. Only process files you own or are authorized to modify.' },
      { question: 'Are the original PDF files changed or uploaded?', answer: 'Merging runs locally in your browser and produces a new PDF. The original files on your device are not modified or uploaded for merging.' }
    ]
  },
  'split-pdf': {
    steps: ['Choose a PDF.', 'Select the pages or page ranges you need in the split workspace.', 'Split and download the resulting PDF files.'],
    questions: [
      { question: 'Can I extract specific pages?', answer: 'Yes. Select the pages or ranges you want to keep. Check the resulting files before sharing them.' },
      { question: 'Which page numbers should I use?', answer: 'Use the page positions shown in the split workspace, starting with page 1. A document can have printed labels or an introduction that make its printed page numbers differ from these positions.' },
      { question: 'Does splitting remove pages from my original PDF?', answer: 'No. Splitting creates new output files from your selection. The original PDF on your device remains unchanged.' },
      { question: 'Are my files uploaded to split a PDF?', answer: 'No. Page selection and PDF extraction run locally in your browser. Larger documents can require more browser memory and processing time.' }
    ]
  },
  'protect-pdf': {
    steps: ['Choose a PDF.', 'Set a password and review the available permissions.', 'Protect and download the encrypted PDF.'],
    questions: [
      { question: 'Do I have to include uppercase letters, numbers, and symbols?', answer: 'No. SafePDFHub does not require a particular mixture of character types. Choose a password you can store securely; a long, unique password is a better choice than a short, predictable one.' },
      { question: 'Can SafePDFHub recover a forgotten password?', answer: 'No. Keep your password somewhere safe. Your PDF and password are processed on your device.' },
      { question: 'Will PDF permissions prevent all copying?', answer: 'No. Permission settings depend on the PDF reader and cannot prevent screenshots or every way of copying content. Password protection and reader permissions serve different purposes.' },
      { question: 'Will my original PDF be overwritten?', answer: 'No. SafePDFHub creates a separate protected PDF for download. Test the downloaded copy with your chosen password before distributing it.' }
    ]
  },
  'unlock-pdf': {
    steps: ['Choose a password-protected PDF you are authorized to modify.', 'Enter its password.', 'Unlock and download the resulting PDF.'],
    questions: [
      { question: 'Can I unlock a PDF without its password?', answer: 'This tool requires the document password. It does not recover or guess forgotten passwords.' },
      { question: 'Are my PDF and password sent to a server?', answer: 'No. The unlock operation uses the password locally in your browser. Your PDF and password are not uploaded for this operation.' },
      { question: 'Does unlocking compress or convert the document?', answer: 'Unlocking removes password protection from an output copy. It is not a conversion or compression operation, and the resulting file size can change when its PDF structure is rewritten.' },
      { question: 'Will the protected original still exist?', answer: 'Yes. The original file on your device remains unchanged. The tool produces a separate unlocked copy for download.' }
    ]
  },
  'sign-pdf': {
    steps: ['Choose a PDF.', 'Place your signature, initials, text, dates, or checkboxes.', 'Review and download the signed PDF.'],
    questions: [
      { question: 'Is this a certificate-based digital signature?', answer: 'The tool places a visible signature on PDF pages. It does not issue a cryptographic signing certificate. Check the recipient’s signing requirements before submitting the document.' },
      { question: 'What can I add to a PDF?', answer: 'You can place a visible signature, initials, text, dates, and checkboxes. Review their position and size on the selected pages before exporting.' },
      { question: 'Are my signature and PDF uploaded?', answer: 'Signing edits and PDF generation run locally in your browser. Your original file remains unchanged, and the signed copy is provided for download.' },
      { question: 'What should I check before downloading?', answer: 'Check the spelling of names, dates, selected pages, and signature placement. Review the exported PDF as well as the editing preview before sharing it.' }
    ]
  },
  'watermark-pdf': {
    steps: ['Choose a PDF.', 'Add a text or image watermark and set its position, opacity, rotation, and page range.', 'Apply the watermark and download your PDF.'],
    questions: [
      { question: 'Can I watermark only selected pages?', answer: 'Yes. Set the page range before applying the watermark and review the exported PDF.' },
      { question: 'Can I use text or an image as a watermark?', answer: 'Yes. Add your watermark text or choose an image, then adjust the position, opacity, and rotation. Check that the result does not hide important document content.' },
      { question: 'Does a watermark password-protect my PDF?', answer: 'No. A watermark adds visible content to pages. Use Protect PDF separately if you need a password-protected copy.' },
      { question: 'Are my PDF and watermark image uploaded?', answer: 'No. Watermark placement and PDF generation run locally in your browser. Your original PDF is not overwritten.' }
    ]
  }
};

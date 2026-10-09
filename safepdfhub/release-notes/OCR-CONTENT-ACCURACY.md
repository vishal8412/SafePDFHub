# PDF-to-Word content accuracy update — 9 October 2026

## Confirmed cause
The supplied PDF has 189 scanned pages without an extractable text layer. Its content is predominantly Marathi, with tables, handwriting and stamps. The previous English default and acceptance of any nonempty OCR output produced unrelated Latin text. The supplied Word file contains 105,192 Latin letters and no Devanagari characters.

## Changes
- Require explicit OCR language selection; add local Marathi and Marathi + English models alongside English and Hindi.
- Reject OCR without word-level evidence, page confidence below 90, more than 5% weak words (confidence below 80), or any extremely uncertain word (below 45).
- Preserve low-resolution full-page scans below 150 DPI and detected ruled tables as page images. These thresholds and table detection are conservative heuristics, not guarantees of correctness.
- Preserve rejected pages as PNG images rather than replacing source content with uncertain recognized text. Report page-specific preservation reasons and require proofreading of all accepted OCR.
- Retain the common loader/result/download flow, 200 MB input support and no fixed page-count limit.

## Validation
- Production Angular build passed; dependency CommonJS warnings remain nonblocking.
- 25 focused tests passed across seven Word/loader test files.
- Actual supplied 189-page PDF: 189 output sections, 189 preserved page images, no garbled OCR text nodes. Every embedded PNG matched the corresponding converter-rendered image SHA-256. Conversion measured 7.916 seconds on the test host; this is not a performance guarantee.
- Independently rendered every original PDF page and compared it with its matching output image. Minimum normalized pixel correlation was 0.912; differences include rasterization and resampling. Inspected the lowest-scoring page visually: source content remained present.
- Rendered a Word sample containing original pages 1, 3, 95 and 189; checked text, tables, document photographs and handwriting for clipping or omissions.
- Clear English scanned fixture still converted to editable text, including the expected invoice number; missing-language validation passed. Local Marathi OCR was separately exercised on source samples, and the production build includes the Marathi model asset. The 189-page preservation run does not establish editable Marathi transcription accuracy.
- The full application suite was not rerun for this update. Previously documented unrelated Merge/Studio failures are not claimed fixed.

## Important limits
Your low-resolution PDF is now preserved visually inside Word; these preserved pages are NOT editable transcription. OCR cannot reliably recover every character from these scans. Higher-resolution sources and human proofreading are required for dependable editable content. Editable table reconstruction and handwriting recognition are not guaranteed; table detection cannot identify every table.

PNG preservation avoids another lossy image encoding step but increases output size: the supplied 12,931,949-byte PDF produced a 106,632,909-byte DOCX. The feature does not promise compression. Test input documents and their personal content are excluded from this project archive.

## Install and run
Run `npm ci` after extracting the project, then `npm start`. The lockfile includes the new Marathi language dependency. To repeat the browser regression, set PLAYWRIGHT_MODULE to an installed Playwright module, WORD_BROWSER to a Chromium executable, and ACCURACY_PDF to the supplied PDF, then run `node scripts/ocr-content-accuracy.cjs`.

Supporting metrics: OCR-content-browser.json and OCR-language-comparison.json. Language-comparison evidence intentionally excludes recognized document text.

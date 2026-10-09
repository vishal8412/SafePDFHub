# PDF to Word OCR and 200 MB update

Built on the previously delivered PDF-to-Word source, which uses the supplied src(6) project. Existing dependencies retain their previous locked versions; added packages are pinned. This update does not change the compressor engine.

## Delivered behavior

- English, Hindi, and combined English + Hindi OCR in Editable text mode.
- Automatic OCR for scanned/outlined pages without useful native text; Every page mode for a broken text layer; OCR Off and Keep page appearance retain visual output.
- Pages with no recognized words are preserved as images. Result notices identify image fallbacks and recognition that needs review. OCR does not reconstruct scanned graphics, table cells, exact fonts or complex layouts.
- PDF upload allowance is 200,000,000 bytes on all device profiles. Removed the fixed page and total-character caps. No fixed page count is enforced.
- PDF.js reads Blob ranges with automatic full-file prefetch disabled. Its worker can still retain required source ranges internally.
- Incremental DOCX ZIP output releases per-page working data. Canvases and OCR workers are disposed. Mobile/conservative profiles use smaller render buffers. Browser memory and ZIP32/Word format limits still apply; successful conversion of every 200 MB PDF on every phone cannot be guaranteed.
- Uses the existing common full-screen loader with actual progress, page X of Y, OCR status and cancellation. Fixed generic timer messages overwriting real status and delayed hides dismissing newer tasks.
- Same shared result component and user-triggered Word download.

## Verification on 2026-10-09

- Production Angular SSR build: PASS. Existing stylesheet/CommonJS warnings remain; Tesseract's server-side dependency graph also produces CommonJS warnings. No build errors.
- Focused Word, OCR, range-reading, archive and loader tests: 20 PASS.
- Full application suite: 333 PASS, 2 existing failures. The Merge resource-copy expectation and Studio renderer queue timeout are unchanged from the prior delivered source; their engine/test source files remain unchanged. They are not presented as passing.
- SEO architecture audit: PASS (14 sitemap routes).
- Chromium browser conversion/download: native text, scanned English, mixed native/scanned pages, Hindi, combined languages with Every page OCR, OCR Off, appearance mode and vector-only fallback all PASS.
- 350-page native-text PDF: all 350 sections and final-page text present. Also passed using the conservative/mobile render profile. This was a desktop-browser simulation, not a physical-phone benchmark.
- 199,699,748-byte PDF with 16 real, uncompressed raster image pages: appearance conversion and download PASS, producing 22,445,499 bytes. This exercises parsing/rendering of image data, not padding alone. It is not a 200 MB OCR speed benchmark.
- Exact 200,000,000-byte upload accepted; 200,000,001 rejected. This boundary selection test used a padded Blob and is distinct from the real-image conversion above.
- Failed OCR core asset -> clear error -> successful retry: PASS. Cancellation during OCR initialization returned control in about 0.84 seconds on the test host. Cancellation and restart passed.
- Mobile-width layout: no horizontal overflow. Common loader and result screenshots inspected.
- Downloaded mixed-content and Hindi DOCX files rendered with LibreOffice and visually inspected: correct editable text, glyphs and source page order; OCR sizing remains approximate.

Small synthetic fixture timings (around 1–1.5 seconds for one/two OCR pages) and the approximately 2.46-second image-heavy appearance test are local test-host observations. They are not production SLAs, cross-device benchmarks, or accuracy guarantees.

Machine-readable evidence: OCR-browser.json, OCR-large-hindi.json, OCR-recovery.json, OCR-fallback.json in this directory. Browser acceptance scripts live in scripts/ocr-*-browser-validation.cjs. The optional large test requires generating ocr-validation/large-images.pdf; it is intentionally excluded from the source ZIP. Test scripts require separately installed Playwright and Chromium; production dependencies do not include them.

## Install and deploy

1. Extract the complete source package.
2. Run `npm ci` (new OCR and ZIP dependencies are in package-lock.json).
3. Run `npm start` for local review or `npm run build` for deployment.
4. Deploy the complete build including assets/ocr and assets/pdfjs. OCR workers, WASM cores and language data are served from the same origin; no document is uploaded for OCR.

First OCR use downloads the selected language data and matching WASM core. HTTPS/localhost and a compatible CSP are required for browser workers/WebAssembly. The first load can take longer than later conversions.

# Marathi OCR asset 404 fix - 9 October 2026

## Reported failure
The screenshots show HTTP 404 for assets/ocr/lang/mar.traineddata.gz. The OCR worker cannot initialize its selected language when this model is unavailable. This error does not establish PDF corruption. The previous project listed the model in Angular asset globs, but a missing package/model can silently produce no copied asset. The exact state of the user's local node_modules was not available to inspect.

## Changes
- English, Hindi and Marathi models are staged under src/assets/ocr/lang and included in this source ZIP, so Angular uses its normal assets folder in both development and production.
- Removed the duplicated per-language node_modules glob rules from angular.json.
- Added scripts/prepare-ocr-assets.mjs. npm start, npm run watch and npm run build validate all three installed gzip models before proceeding, repair staged copies, and write a checksum manifest. Missing/corrupt dependencies stop with explicit npm ci instructions, instead of a delayed conversion-time 404.
- Missing-model startup errors now explain how users can retry or choose Keep page appearance. Internal worker URLs are not shown to end users.
- Added missing-model error coverage and a browser regression for a real 404, successful retry and optional supplied PDF conversion.

## Validation
- Production build passed. Existing nonblocking dependency CommonJS warnings remain.
- 26 focused Word and loader tests passed across seven test files.
- Asset preparation correctly rejected a missing dependency and a corrupt model, and successfully staged all three valid models.
- Fresh browser context: deliberately returned 404 for Marathi; confirmed actionable error and dismissed loader. Restored the asset and retried without uploading again: Marathi + English worker loaded both models with HTTP 200 and successfully recognized the clear English fixture.
- Supplied 39,514,672-byte PDF: all 201 pages processed; downloaded DOCX has 201 sections. No uncaught browser page errors. Duration 32.171 seconds on the test host (not a performance guarantee). 184 pages explicitly preserved by quality checks; 185 image pages overall. No OCR page passed the conservative editable-text acceptance rules. This confirms successful conversion and download, not accurate editable transcription of scanned pages.
- Source output: 325,703,646 bytes. Lossless PNG fallback preserves rendered pages but substantially increases this document's size. This existing tradeoff remains; this fix does not compress Word output.
- Production SSR HTTP checks returned 200 for English, Hindi and Marathi; served bytes matched each model's SHA-256 manifest.
- Full unrelated application test suite not rerun; no claim that previously recorded unrelated Merge/Studio failures are fixed.

## Apply this release
1. Stop the existing ng serve process with Ctrl+C.
2. Extract the full updated ZIP to a fresh folder. Do not replace only src.
3. Run npm ci, then npm start in the extracted project folder.
4. Reload the browser and select Marathi + English for the supplied mixed-language scan.

For direct ng serve/ng build commands, run npm run ocr:assets first. Keep all assets/ocr files in the deployed build. A route returning HTML with status 200 is not a valid model asset. Your PDF and screenshots, rendered previews and generated Word file are not included in the source archive.

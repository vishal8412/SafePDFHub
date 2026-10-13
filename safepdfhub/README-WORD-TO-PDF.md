# Word-to-PDF update — 2026.10.13.2

This project is assembled from the newly uploaded src(8), scripts(8), package and Angular configuration files. The changes are scoped to Word-to-PDF. Other application tools and dependencies retain the uploaded versions.

## Run the corrected project

1. Extract this ZIP into a new folder. Do not overlay only selected files onto an older installation.
2. Open a terminal in SafePDFHub (the folder containing package.json).
3. Run `npm ci`, then `npm start`.
4. Reload the browser and prepare the DOCX again. The new save panel explicitly shows the source paper size and explains the Windows print destination.

For production, run `npm run build` and deploy the resulting complete build. The preview host has `data-word-renderer="2026.10.13.2"` for checking which renderer was deployed.

## What was wrong

The newly supplied source still contained the earlier rendering path: custom tab alignment was disabled, fonts were overridden with Arial, text boxes could overlap body content, and print sizing depended on section padding. It did not contain the previously developed layout corrections.

The supplied testing.pdf was produced by Microsoft Print to PDF, with four US Letter pages and no extractable text. The original DOCX specifies A4. The printer destination and paper settings are a separate source of differences from the document renderer.

## Latest export correction

The newly supplied output again contains four Letter-sized raster pages, with browser date/title/page-number decorations. The source document still specifies A4. These observations do not prove every difference is caused by the printer: the Windows driver is not available in this environment.

The print stylesheet now places Word margins inside the printed content and requests zero outer page margins. Padding is cloned on automatic continuation pages. This prevents loss of the content inset and suppresses default browser decorations in the tested Chromium print engine, even with headers/footers enabled. Source A4 dimensions and selectable text are retained. User-selected printer settings can still override page sizing.

The save panel now explains the margins setting and provides **Check saved PDF**. This optional local PDF.js check reads every page's effective size/orientation and checks for any selectable text. It flags the supplied Letter/raster export. It is deliberately labeled a basic export check: it does not certify text accuracy, missing images, fonts, spacing, page order, or pagination. Mixed-size documents accept any of their source dimensions, and section count is never mistaken for page count. Checks can be cancelled and release their PDF worker; a 60-second timeout bounds the operation. Original files are never changed or uploaded.

## Corrections

- Preserve the source paper size and margins, including automatic continuation pages.
- Eliminate empty section-break line boxes and fixed print heights that introduce blank pages.
- Measure layout in a hidden but measurable frame.
- Preserve supported standalone rectangular text-box headings and separators in normal document flow.
- Prefer original Calibri faces when installed; otherwise use bundled Carlito faces with compatible metrics.
- Render recognized Wingdings/Symbol list markers using Unicode and a bundled symbol font.
- Recalculate custom tab positions after fonts and images load, using original tab stops instead of timing-dependent word spacing. Include inherited paragraph-style stops.
- Keep the preview CSP and document title when rendering styles.
- Request exact print colors and provide explicit PDF-save instructions and paper-size guidance.

## Save settings

Choose the browser destination **Save as PDF**. On Windows, **Microsoft Print to PDF** is a separate printer destination; it may use different paper defaults and text handling.

For the supplied resume: choose **A4**, **Margins: None** (the Word margins are already inside the page), **100% scale**, turn **Background graphics on**, and turn **Headers and footers off**. Check the final preview before saving. A website cannot force or inspect all native printer settings or confirm that a print dialog was saved.

## Verification and limits

The supplied resume exported as three A4 pages with selectable text. Its complete text matches the DOCX after removing whitespace/punctuation and duplicate OOXML compatibility branches. All three output pages were visually inspected. Normal desktop rendering and delayed font loading from a 390px initial viewport produced pixel-identical rendered PDF pages in the tested Chromium environment.

The production build and 34 focused unit tests pass. Browser regression checks cover the preview/print action, mobile widths, inherited headers, mixed page orientation, rejection of damaged/unsafe inputs, cancellation and no document uploads. The automated PDF comparison uses Chromium's print engine with the prepared document; it does not automate or validate the Windows Microsoft Print to PDF driver.

Browser rendering remains different from Microsoft's Word layout engine. Complex floating artwork, advanced fields, repeated headers on automatic continuation pages, footer placement and unavailable fonts can differ. This update does not claim perfect conversion for every DOCX. The uploaded worker, capacity checks and scanned-document processing are unchanged in this release.

Additional validation for this version:
- The supplied source produced 3 A4 pages; complete normalized text matched the DOCX.
- Enabling browser headers and footers did not add date/title/page-number text to those pages.
- The saved-PDF check accepted that output and flagged the supplied incorrect Letter/raster output.
- A synthetic 130-line continuation document printed across 4 pages with every line retained in order and source top/bottom margins on every page.
- Production build and 34 focused tests passed; browser regressions retained the mixed-orientation, inherited-header, mobile width, cancellation, and unsafe-input checks.

Private customer documents, screenshots and generated comparison PDFs are not included.

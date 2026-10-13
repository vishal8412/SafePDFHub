# SafePDFHub Word-to-PDF correction — 2026.10.13.3

This project is based on the latest uploaded src(9), scripts(9), package lock and Angular configuration. Other tool source files are preserved. Conversion remains browser-only.

## Install

Extract the complete ZIP into a new folder, open SafePDFHub (containing package.json), then run:

```sh
npm ci
npm start
```

For production use `npm run build`. Deploy the complete build and reload before preparing a new preview. The preview host's data-word-renderer attribute is `2026.10.13.3`.

## Corrections and causes

1. **Wrapped list text:** docx-preview places markers inside the paragraph's first line, while the source uses a hanging indent. The new adapter gives the marker a zero-width inline box offset into the hanging-indent area. First and continuation text lines align, and the paragraph remains in ordinary flow to preserve PDF text extraction order. Existing counter and glyph definitions are retained.
2. **Heading gaps and shaded boxes:** supported standalone heading drawings were flattened without their vertical offset, height or full horizontal geometry. The adapter now transfers those values into the flow layout. The separator's horizontal placement is also retained. Unsupported floating/rotated artwork is not flattened.
3. **Table position:** the pinned parser treats tblInd as paragraph indentation and ignores its w:w value. An in-memory XML adapter passes supported fixed table indentation to the parser. Cell padding remains separate, and center/right/floating/percentage-positioned tables are excluded from this adaptation. The original DOCX bytes are never modified.
4. **Excess pages:** paragraph mark font sizing and paragraph/default style font sizing were omitted from the paragraph box, allowing the browser's default 12pt line box to enlarge lines containing 10pt text. Paragraph typography is now propagated. Automatic line spacing uses the loaded font's measured natural line height, while exact line spacing is preserved.
5. **Test fidelity:** the earlier snapshot test omitted the HTML doctype and therefore used quirks mode, unlike the live iframe. That earlier three-page result was insufficient. Both preview and export tests now assert CSS1Compat, preserve the doctype, and can assert an expected PDF page count. The corrected source document passes with three pages in standards mode.

These are adapters for the pinned docx-preview 0.3.7 renderer. Revalidate them before changing that dependency. Transient XML adaptations are never written back to user files.

## Saving

Use the browser's **Save as PDF**, select the source paper size (A4 for the supplied document), **Margins: None**, **Scale: 100%**, enable backgrounds, and disable browser headers/footers. Word margins are already part of the document content.

The supplied Testing5.pdf was produced by Windows Microsoft Print to PDF on Letter paper. Its driver settings are outside the web application's control. The updated local Check saved PDF function flags incorrect page sizes and missing selectable text; it is not a full visual/content certification. The Windows driver was not automated in this environment. Verify the final native print preview before saving.

## Validation

- Production build and 41 focused tests pass.
- Standards-mode export of the supplied DOCX: 3 A4 pages, selectable text, complete normalized text retained in source order.
- The first and wrapped lines of the reported bullet both start at x=89.988 pt.
- Restored vertical gap before Work Experience and the table's source indent were checked in the final PDF.
- All three pages visually reviewed; no clipped content or additional blank pages in this sample.
- Initial 390px viewport with delayed fonts yields pixel-identical PDF pages to desktop.
- Synthetic browser regression: mixed portrait/landscape, inherited headers, images, privacy/no uploads, print action, cancellation and corrupt/external/macro rejection.
- ZIP CRC, source-byte comparison and full extraction checked before delivery.

Run focused tests:

```sh
npm test -- --watch=false --include='src/app/core/word-to-pdf/*.spec.ts' --include='src/app/shared/services/loader.service.spec.ts'
```

Browser scripts require Playwright and a Chromium executable. Set PLAYWRIGHT_MODULE and WORD_BROWSER as needed. Generate synthetic fixtures with `python scripts/create-word-layout-fixtures.py`, then run `node scripts/word-to-pdf-local-browser.cjs`. For the supplied document set WORD_DOCX, WORD_EXPECTED_PAGES=3, and optionally WORD_BAD_PDF before running `node scripts/word-to-pdf-document-browser.cjs`.

Browser rendering is not Microsoft's Word layout engine. Different fonts, complex floating objects, advanced fields and native printer choices can still change output. This release addresses and tests the reported layout bugs; it does not claim flawless conversion of every DOCX.

Customer documents, comparison PDFs, screenshots, node_modules and build outputs are excluded from this project ZIP.

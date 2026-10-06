# SafePDFHub Studio: PDF text and image fixes

## Apply the update

This package contains the updated project source, configuration, existing assets, and regression tests. Extract it into a new folder, or merge its `src/` and `scripts/` changes into your project. Keep `regression-fixtures/studio/` for the browser tests. Review `studio-fixes.patch` for the exact source changes.

```bash
npm ci
npm start
```

Open `/studio`. Build fresh deployment assets with `npm run build`; the uploaded deployment archive contains the older implementation and must not be used for this update. Dependencies and the lockfile are unchanged. No deployment was performed.

## Confirmed causes and corrections

| Problem | Cause in the supplied code | Correction |
| --- | --- | --- |
| Resume text edit fails; preview/export cannot finish | Stripped Satoshi font programs pass parsing but fail during deferred font serialization (`tables` / `italicAngle`). An unusable font could remain in the real document even after fallback. | Validate serialization in an isolated PDF before adding a source font to the output. Reuse valid source programs without subsetting them again; choose a supported fallback when necessary. |
| Old letter fragments remain after replacement | PDF.js reported Satoshi ascent/descent about half the PDF descriptor values. The original erase area missed parts of glyphs. | Read descriptor metrics in PDF thousandths, independently of embedded-font units-per-em. Use these for selection and source erase geometry. |
| Thin white outline on colored backgrounds | The original-content removal clip was larger than the background cover. | Cover the clip's antialiased boundary without moving the text baseline. |
| Blue headings become dark | Text-show operator count was assumed to equal extracted text-item count. They differ in the resume. | Match extracted text against normalized Unicode glyph content while tracking the graphics-state color. |
| Paragraph, line, and partial-line selection varies | Exact baseline sorting, adjacency to only the last group, and font aliases split fragments. Rows in other columns interrupted paragraphs. | Cluster near-equal baselines, order runs horizontally, group paragraphs independently by column, and compare exact source face names instead of PDF.js aliases. |
| Indented paragraphs lose their full extent | Group bounds used maximum width without including each line's horizontal position. | Use the union of source line bounds; preserve original per-line erase geometry. |
| Unrelated text gets grouped | Same-line grouping omitted a font-size check and allowed large gaps. | Check size, face, weight, style, color and geometry. Respect list starts, heading boundaries and column gaps. |
| Source fonts differ by page | Native font lookup was cached for the first analyzed page only and matched simplified family names. | Cache by page, retain face variants such as Medium/Italic/Bold, and visit nested Form XObject resources. |
| Long text overruns its area | A long token following a short word skipped token splitting. Fit height also counted an extra line-spacing interval. | Split every oversized token and verify width and actual occupied line height. |
| Editing a tight layout moves other content unexpectedly | Existing PDF text defaulted to paragraph expansion. | Default to **Fit within original area**. Original-size expansion remains an explicit option. |
| A failed edit displays a stale successful preview | The previous preview raster remained active after the new preview failed. | Clear stale preview and layout snapshots, retain the edit, and expose the error. |
| Source bytes become unavailable during export | PDF.js may transfer ownership of a supplied typed-array buffer. | Give the font extraction worker its own byte copy. |
| Some repeated images cannot be selected | Optimized repeated/grouped image paint operators were ignored. | Extract every occurrence, with the accumulated graphics transform. |
| Partially overlapping text disappears from selection/export | Image replacement hid a text object based only on its center. | Hide only fully contained source objects; preserve paragraphs extending outside the region. |
| Image replacement erases surrounding edges | Removal expanded an image's bounds by one point on every side. | Remove the exact detected image region. |
| Image background controls have no effect in export | Reconstruction was skipped after the source region had been removed. | Apply the selected reconstruction behind the replacement at its destination. |
| JPEG preview/export orientation differs | The browser applied EXIF rotation, but PDF embedding used the original JPEG pixels. | Normalize JPEG orientation once during import. Both editing entry points use the same decoder and 20 MB / 40 megapixel limits. |
| Canvas and inspector imports behave differently | Separate import implementations had different limits and silent validation failures. | Share file-signature validation, decoding, sizing and error handling. |
| Inspector replacement requires multiple undo actions | Replacement pixels and reconstructed background were separate history mutations. | Commit them together as one replacement operation. |
| Inspector reconstruction proportions are wrong | Its target ratio used normalized width/height without the page dimensions. | Convert normalized bounds using the displayed page dimensions. |
| Restore leaves selection at the moved replacement position | Restore selected the pre-reset bounds. | Select the restored object's original bounds. |
| Browser font faces accumulate between documents | Registered font faces were never released. | Remove owned font faces on reset and reject stale asynchronous registration. |

## Selection behavior

PDFs usually store positioned glyphs, not semantic paragraphs. The editor now consistently joins compatible runs and same-style paragraph lines despite small baseline differences or interleaved columns. It deliberately keeps different faces, sizes, colors, headings and list entries separate rather than silently discarding their formatting. A mixed-style paragraph can therefore still have multiple edit targets; full rich-text editing across those targets is not implemented by this patch.

## Font behavior

Preserve the exact source program when it can encode and serialize the replacement. Otherwise use the existing Calibri-compatible Carlito assets, a matching PDF standard-font style, or the bundled Unicode fallback. A fallback can change glyph appearance and line breaks. The supplied stripped Satoshi font cannot be reused reliably by pdf-lib, so affected replacements use fallback fonts. Characters absent from all available fonts produce an explicit error; this is not universal font/script support.

## Validation

- 44 Studio unit tests pass across 8 suites (28 passed in the supplied baseline).
- TypeScript application compilation passes.
- Production Angular build passes. Existing warnings remain for the workspace SCSS size and CommonJS dependencies (`file-saver`, `jszip`, `pako`).
- Browser tests cover both supplied PDFs: text editing, same-page multiple edits, Unicode fallback, paragraph grouping, multi-page editing, JPEG orientation, image fit/fill/stretch, restoration, undo/redo and PDF download.
- Additional resume checks cover inspector replacement as one undo step and pointer dragging while preserving original source geometry.
- Rendered output was inspected after export. The cleared final line of the resume paragraph contains zero residual dark glyph pixels.
- The large output retains all 842 pages. Sampled unedited pages 421 and 842 render pixel-identically to their originals. This is a sample-based preservation check, not inspection of every page.

### Re-run tests

```bash
npm test -- --watch=false --include="src/app/features/studio/**/*.spec.ts"
npm run build
```

The standalone browser test uses Playwright. Install it without changing the project's lockfile, then install Chromium:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

PowerShell example:

```powershell
$env:STUDIO_RESUME_PDF = "C:\PDFs\Resume_Vishal (1)(1).pdf"
$env:STUDIO_LARGE_PDF = "C:\PDFs\15-MB(1).pdf"
node scripts/studio-text-image-regression.cjs
```

The script starts a local development server on port 4930 and writes results under `benchmark-results/studio-fixes/`. Set `STUDIO_SAMPLE=resume` to run only the resume checks. Set `CHROMIUM_EXECUTABLE` if using an existing Chromium installation. Test image fixtures are included; the supplied personal PDFs and generated test PDFs are not included in this source package.

## Remaining limits

- This is visual PDF replacement, not secure redaction; original content can remain in underlying PDF streams.
- Scanned text needs OCR. Vector artwork is not necessarily an editable raster image.
- Background reconstruction over gradients, photographs or overlapping artwork is approximate. Arbitrarily skewed/masked content still needs manual review.
- Original-size paragraph expansion moves lower page content; it is not a full document layout engine, and rotated-page expansion remains unsupported.
- The supplied samples and regression cases pass; that does not establish that every PDF producer, font or script is supported.

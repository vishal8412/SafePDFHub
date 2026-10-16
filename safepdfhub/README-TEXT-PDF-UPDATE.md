# Text/vector PDF and format coverage update

This update extends the latest 15 October project and retains the scanned-PDF repair and compact preview fallback.

## Install
Stop the previous dev server. Extract into a fresh folder, enter SafePDFHub, run `npm ci`, then `npm start`.

## Why this file previously stayed unchanged
2023050186.pdf is a 403-page born-digital text/vector PDF, not a scanned document. It contains only a tiny indexed image. The existing lossless writer produced 6,745,941 bytes from a 6,676,195-byte input, so the engine correctly rejected that larger output. JPEG quality changes cannot meaningfully reduce its text/font data.

The new pass re-encodes existing single-Flate streams with higher-effort DEFLATE. It preserves decoded bytes and every decoding parameter, including image predictors. That covers page streams, embedded font programs, eligible image data, metadata and embedded files without interpreting or removing their contents. It runs sequentially in the existing worker, with an 8 MB expansion limit per stream and 128 MB total decoded-work budget. Malformed and over-budget streams stay unchanged.

The PDF also has unresolved references 135678 and 135679. These object numbers are now reserved during serialization so they cannot accidentally point to newly generated object streams. A dedicated regression fixture checks that behavior.

An unchanged result is now labeled Original PDF / Download original PDF, rather than Compressed PDF.

## Real website validation
- Input: 6,676,195 bytes; 403 pages.
- Download: 6,414,859 bytes (6.41 MB); 3.91% saved; 16.172 seconds in the desktop Chromium 138 / 8 GiB capability-profile test.
- All page drawing-stream bytes, page boxes, rotations, annotation counts and document metadata match.
- All 965 unique reachable decoded content streams match exactly, including fonts, image data, XML metadata and other content streams. Both pre-existing unresolved references remain unresolved. Obsolete linearization hints are rebuilt/removed as part of ordinary rewriting, not document content.
- Pages 1 and 200 visually checked; final page-1 rendering matches the earlier inspected rendering byte-for-byte.
- Previous scanned-PDF regression: 39,514,672 bytes -> 17,484,831 bytes in 18.395 seconds.
- Production build passed; 45 tests passed across 10 focused files.

## Coverage and limits
| PDF content | Current behavior |
|---|---|
| Text/vector pages and embedded fonts | Bounded lossless stream recompression, graph cleanup and exact-stream deduplication; no text rasterization |
| Supported RGB JPEG scans, including single-element filter arrays and Flate-wrapped JPEG | Existing adaptive image recompression/downsampling and validation |
| Eligible raw/Flate RGB images | Existing image optimization; lossless Flate recompression also available |
| Grayscale, indexed, CMYK, ICC, masked images, predictor streams | Eligible single-Flate bytes can be losslessly recompressed without color conversion; unsupported lossy transformations are skipped |
| JPEG 2000, JBIG2, CCITT and other unsupported image codecs | Original encoded image data retained; surrounding document may still benefit from lossless cleanup |
| Forms, links, annotations, tags, attachments and metadata | Retained in the reachable document graph; this pass does not flatten or remove them |
| Encrypted/signed documents | Existing security safeguards remain; this update does not bypass them |
| Already optimized, over-budget or unsupported content | Keep the smallest validated output or the original, with truthful result labels |

This matrix describes implemented paths, not exhaustive certification of all PDF variants. A smaller output cannot be guaranteed for every PDF. High Quality stays lossless; lossy modes may soften scan detail. No pages, fonts or accessibility data are discarded to force a percentage saving. Timings depend on device and file complexity.

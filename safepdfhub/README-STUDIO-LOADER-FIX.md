# Studio loader completion fix

Studio uses the same application-wide loader as the other PDF tools. The fixes in this update address the Studio-specific handoff points that had made its progress feel inconsistent:

- Bulk signing reports the number of pages processed through the shared page counter and supports cancellation between bounded batches.
- Studio PDF export keeps the editor visible while processing, then shows a clear, non-estimated 100% completion state before switching to the result screen.
- Page extraction no longer displays a page counter that could not be backed by actual per-page progress. It shows completion before the browser download starts.
- PDF security operations show completion before starting the download.
- The shared page counter accepts a real zero-based starting count and clamps values to the document's page total.

Validation completed:

- Focused loader and Studio PDF export tests: 29 passed.
- Angular production build: passed. Existing workspace budget and CommonJS optimization warnings remain.

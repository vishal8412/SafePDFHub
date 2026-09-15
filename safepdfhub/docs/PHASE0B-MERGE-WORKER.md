# SafePDFHub Phase 0B — Merge Worker Engine

## Goal

Move the Merge PDF operation off Angular's main/UI thread while preserving the privacy-first architecture. PDF bytes remain in the browser and are never sent to SafePDFHub cloud services.

## Implementation

- Added `src/app/core/workers/pdf-merge.worker.ts`.
- `MergeEngine` uses a module Web Worker when browser workers are available.
- Files are transferred to the worker **one at a time** after the worker requests them. This avoids sending all input ArrayBuffers into the worker at once.
- Input ArrayBuffers are transferred rather than cloned.
- The worker processes page chunks of 25 and yields between chunks so cancellation can be observed.
- The final merged ArrayBuffer is transferred back to the Angular thread.
- Existing capacity validation remains authoritative before processing.
- The worker also enforces the maximum page budget after reading actual page counts.
- A compatibility main-thread fallback remains for environments where a module Worker cannot be constructed.
- Merge cancellation is wired through `AbortController`; the shared loader exposes Cancel only while Merge owns a cancellation handler.

## Memory expectations

This phase improves UI responsiveness and reduces unnecessary cross-thread copies. It does **not** make pdf-lib streaming or constant-memory. `PDFDocument.save()` still serializes the complete output, and the merged PDF document remains in memory. Therefore higher capacity limits are intentionally not unlocked by Phase 0B alone.

## Next benchmark phase

Compare:

1. current main-thread pdf-lib
2. Phase 0B Worker + pdf-lib
3. qpdf/WASM prototype when available

Measure elapsed time, peak memory where observable, success/failure rate, UI responsiveness, output validity, and cancellation latency.

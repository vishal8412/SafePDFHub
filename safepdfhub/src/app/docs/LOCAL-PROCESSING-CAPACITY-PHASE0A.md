# SafePDFHub Local Processing Capacity — Phase 0A

## Goal

Create one privacy-first, device-aware capacity and validation foundation for all browser PDF tools.

PDF bytes are never sent to a SafePDFHub server by this layer.

## What is implemented

- `LocalProcessingCapabilityService` is the single source of truth for current local capacity.
- Device memory is used as the primary capability signal when `navigator.deviceMemory` is available.
- Hardware concurrency is only a secondary signal.
- Viewport width is no longer used to decide PDF processing capacity.
- `PdfValidationService` performs type, duplicate, per-file, total-size and file-count validation.
- `PdfWorkloadAnalyzerService` combines file size, file count and known page counts into a workload assessment.
- Workspace files expose `validationState` and `validationMessage`.
- Merge performs a second engine-side validation before and during processing.
- Merge page-count checks prevent extreme page-count workloads from reaching the expensive save stage.
- Merge progress uses known page counts when available and falls back to file progress.
- Initial thumbnail work is reduced for larger selections to avoid unnecessary memory pressure.
- The shared file-upload component uses the same central validation/capacity services.
- PDF file inputs no longer request camera capture; camera capture belongs to a future Scan-to-PDF workflow.

## Current capacity policy

The current `pdf-lib` engine has not yet been benchmarked sufficiently to unlock multi-gigabyte browser workloads. Therefore higher device tiers are intentionally capped by the current engine ceiling.

Current effective limits are conservative:

- Conservative/unknown: 50 MB per file / 150 MB total / 5,000 pages
- Standard desktop: 100 MB per file / 400 MB total / 20,000 pages
- Mobile: at most 80 MB per file / 250 MB total / 10,000 pages
- Tablet: at most 80 MB per file / 300 MB total / 15,000 pages
- High/maximum desktop: still capped at 100 MB per file / 400 MB total until the Worker/WASM benchmark phase

The higher theoretical device budgets are retained in the capability service as a future policy envelope, but are not currently exposed by the engine ceiling.

## Next phase

1. Benchmark current `pdf-lib` Merge with real PDFs.
2. Move Merge into a Web Worker.
3. Use transferable buffers.
4. Add OPFS-backed temporary storage where it provides a measurable benefit.
5. Prototype qpdf/WASM without adding a paid dependency.
6. Compare speed, peak memory, reliability and PDF fidelity.
7. Raise the engine ceiling only from measured results.

## Non-goals in Phase 0A

- No cloud PDF processing.
- No commercial PDF SDK.
- No claim of 1 GB or 2 GB support.
- No automatic upload fallback.

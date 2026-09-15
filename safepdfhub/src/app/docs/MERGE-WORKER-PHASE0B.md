# SafePDFHub — Phase 0B: Complete Merge Worker Engine

## Scope

Phase 0B moves the existing `pdf-lib` merge workload off the Angular main thread into a dedicated Web Worker while preserving the current local-only processing model and conservative Phase 0A capacity limits.

This phase covers 0B.1–0B.8 as one implementation batch:

1. Worker protocol and typed messages
2. Worker-side merge execution
3. ArrayBuffer transfer into the worker
4. Worker-side capacity/page validation
5. Honest staged/page-weighted progress
6. Transferable output buffer back to the main thread
7. Worker lifecycle/error handling
8. Cooperative cancellation with worker termination fallback

## Message protocol

### Main → Worker

- `START` — starts one merge operation and transfers PDF `ArrayBuffer`s.
- `CANCEL` — requests cooperative cancellation.

### Worker → Main

- `STAGE` — reports `reading`, `parsing`, `copying`, `serializing`, or `finalizing`.
- `PROGRESS` — reports a bounded 0–100 progress value.
- `ERROR` — reports an actionable local-processing failure and optional error code.
- `COMPLETE` — returns the merged PDF as a transferable `ArrayBuffer`.
- `CANCELLED` — confirms cancellation.

## Memory and privacy behavior

PDF bytes are processed locally. The main thread transfers ownership of input `ArrayBuffer`s to the Worker instead of cloning them. The output `ArrayBuffer` is transferred back to the main thread and wrapped in a `File`.

The Worker receives the file name/type because the UI needs useful error and stage messages, but there is no network call, upload path, document telemetry, hash, or cloud-processing fallback.

The Worker does **not** make `pdf-lib` streaming. Source document graphs and the growing merged graph remain in memory, and final `merged.save()` is still a serialization step that can be memory-intensive. Phase 0B therefore does not increase the Phase 0A public capacity ceiling.

## Progress semantics

Progress is weighted toward actual page-copy work when page counts are already known. Reading/parsing and final serialization are represented as explicit stage boundaries rather than invented byte-level precision. Serialization reports a stage transition because `pdf-lib` does not expose reliable incremental serialization progress.

## Cancellation semantics

Cancellation is cooperative between Worker scheduling boundaries. A `CANCEL` message is checked before/after major operations and between 25-page copy batches. If the Worker is inside a synchronous `pdf-lib` operation and cannot process `CANCEL`, the main thread terminates that Worker after a short fallback window and rejects the active operation as cancelled. A later merge creates a fresh Worker.

Cancellation is therefore reliable as an operation-level abort, but it is not promised to interrupt a synchronous `pdf-lib` call at the exact instant the user requests it.

## Capacity policy

Phase 0B reuses the Phase 0A budget supplied by `LocalProcessingCapabilityService`. The Worker repeats file-count, byte-size, and page-count checks as a second safety boundary. No 1 GB/2 GB public capacity increase is made in this phase.

Capacity should only be raised after benchmark evidence demonstrates stable behavior across representative devices and PDF complexity classes.

## Preserved architecture

- PDF.js remains the rendering/analysis/viewer engine.
- Studio files and Studio export/fidelity behavior are unchanged.
- Existing preview lazy-loading behavior is unchanged.
- Existing `WorkspaceUploadService` TypeScript typing fix is preserved.
- `WorkflowService` continues to use the same `MergeEngine` boundary and now forwards known page counts to the Worker-backed merge path.
- Main-thread fallback remains available when `Worker` is not available.

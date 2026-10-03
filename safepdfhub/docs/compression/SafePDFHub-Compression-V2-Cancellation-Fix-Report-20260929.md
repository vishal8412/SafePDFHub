# SafePDFHub Compression V2 — Cancellation Compile Fix

Date: 2026-09-29

## Root causes fixed

1. `pdf-final-integrity.service.ts` used `throwIfCompressionCancelled()` without importing it.
2. `CompressEngine.compress()` accidentally accepted an external `signal?: AbortSignal` while also declaring its own local `const signal = controller.signal`. This caused the duplicate-identifier compiler errors and was inconsistent with existing callers, which pass five arguments.
3. `compress.engine.spec.ts` was inspected against the corrected five-argument `CompressEngine.compress()` contract. Its existing call sites remain compatible; no sixth cancellation argument should be added to the tests. The engine owns the active controller and exposes `cancel()` for the facade/loader cancellation path.

## Validation performed

- TypeScript transpile/syntax validation: 4/4 PASS for the cancellation helper, final-integrity service, compression engine, and compression-engine spec.
- Full Angular build/test suite: not run in this environment.
- Real browser compression/cancellation stress test: not run.

## Important

The fixes remove the compile blockers without weakening the cancellation architecture. `CompressEngine.compress()` creates and owns the active `AbortController`; `CompressEngine.cancel()` aborts it and also cleans up qpdf/worker resources.

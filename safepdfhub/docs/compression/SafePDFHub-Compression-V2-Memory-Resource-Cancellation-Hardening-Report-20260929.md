# SafePDFHub Compression V2 — Memory/Resource Hardening + Large-PDF Cancellation Stress

Date: 2026-09-29

## Scope

This stage hardens the existing V2 compression/cancellation architecture against browser memory amplification, bounded candidate fan-out, and cancellation races during PDF.js/qpdf analysis and execution.

The target large-document validation corpus is the authoritative 15-MB / 842-page PDF used in prior compression validation:

- File: `15-MB(7).pdf`
- Size: 15,513,995 bytes
- Pages: 842

## Implemented

### 1. Resource-aware candidate fan-out

Added `CompressionResourceGuardService`.

Strategy branch limits are now workload-aware:

- normal workload: up to 3 strategy branches
- high workload: up to 2
- large workload: 1

This does not reject large PDFs. It reduces optional candidate multiplication so the browser does not retain multiple large representations unnecessarily.

### 2. Cancellation during initial PDF analysis

`CompressionFacade` now owns an analysis `AbortController` while PDF analysis is running.

Cancellation is propagated into `PdfAnalyzer` and the PDF.js loading task. A cancelled load is explicitly destroyed when possible.

### 3. Forensic analyzer memory hardening

The forensic analyzer previously retained decoded stream payloads in every raw-object record. It now retains only object references and stream byte counts. Stream bytes are extracted and fingerprinted one object at a time.

This preserves duplicate-stream analysis while avoiding an additional long-lived decoded-stream byte copy for the entire PDF.

### 4. qpdf cancellation race hardening

`QpdfWasmRuntimeService` now uses a generation/token lifecycle. If cancellation happens while a qpdf runner is still being created, the late-created runner is immediately destroyed and never starts execution.

This closes the race where cancellation could previously be overwritten by a later `run()` initialization.

### 5. Optional candidate phases propagate cancellation

Structural and image optimization phases now accept `AbortSignal` and rethrow cancellation instead of swallowing it as an ordinary optional-candidate failure.

### 6. Strategy preflight cancellation/resource behavior

Strategy-source fingerprinting now checkpoints cancellation and respects the resource guard's maximum branch count.

The SHA-256 preflight path no longer creates an unnecessary second byte-array copy before `crypto.subtle.digest()`.

### 7. Browser stress harness

Added:

`scripts/compression-v2-memory-cancellation-stress.py`

The harness:

1. starts/uses the Angular app;
2. opens `/tools/compress-pdf`;
3. uploads the supplied PDF;
4. starts compression;
5. samples Chromium JS heap through CDP;
6. requests cancellation after a configurable delay;
7. verifies the loader/cancellation UI terminates;
8. samples post-cancellation heap for 3 seconds;
9. repeats the workload to expose resource leaks.

Default configuration:

- 5 runs
- cancel after 1500 ms
- 250 ms memory sampling interval
- 30-second cancellation completion ceiling

Package command:

```bash
npm run compress:v2:memory-cancellation:stress -- "C:\\path\\to\\15-MB(7).pdf" --start-server
```

## Validation actually performed

### Static hardening audit

**20/20 PASS**

### Existing cancellation audit

**15/15 PASS**

### TypeScript transpile/syntax validation

**11/11 PASS** using the globally available TypeScript 5.8.3 transpiler.

### Python syntax validation

`compression-v2-memory-cancellation-stress.py`: PASS.

### JavaScript syntax validation

`compression-v2-memory-hardening-audit.mjs`: PASS.

## Not executed / not claimed

The following require the user's fully installed Angular environment and real browser execution and therefore are not claimed as passed here:

- `npm test`
- `npm run build`
- `npm start` with the production project dependencies
- real-browser compression of the 842-page PDF
- real cancellation stress against the 842-page PDF
- real JS heap measurements during compression
- long-run worker/WASM leak/soak validation
- full Angular/Vitest regression suite

An attempted `npm ci --no-audit --no-fund` in the isolated validation environment timed out, so a full Angular build/test could not be completed in this environment.

## Production interpretation

This stage improves the lifecycle architecture but does not by itself certify production readiness. Real-browser evidence is still required before declaring memory/cancellation behavior production-certified.

## Next stage — mandatory

**Next: Compression V2 Real-Browser Benchmark & Acceptance Validation.**

Use the 15,513,995-byte / 842-page PDF and execute real `light`, `recommended`, and `strong` compression runs. Capture:

- actual output bytes
- reduction percentage
- runtime
- page count
- page geometry
- page rotation
- text fingerprint
- annotations/links/forms
- metadata
- visual fidelity
- selected candidate and lineage
- JS heap before/peak/after
- cancellation latency
- worker/WASM cleanup behavior

After that, the next stage is **Real-World PDF Corpus Stress Validation**, followed by final qpdf production certification, failure/fallback hardening, security/privacy certification, full regression, and release certification.

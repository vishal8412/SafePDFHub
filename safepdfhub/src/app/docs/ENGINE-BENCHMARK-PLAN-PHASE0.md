# SafePDFHub Engine Benchmark Plan — Phase 0

This document defines the benchmark gate before increasing browser PDF capacity above the current conservative engine ceiling.

## Hard privacy rule

Benchmarking is local. Test PDFs are processed on the developer machine/browser. PDF bytes are not uploaded to SafePDFHub infrastructure.

## Baseline engine

- Merge engine: `pdf-lib` 1.17.1
- Current operation: load source PDFs, copy pages in small batches, serialize one merged document
- Current implementation is memory-resident; the batch size improves scheduling but is not streaming.

## Test corpus

1. 10 MB / 100 pages / text-heavy
2. 100 MB / 1,000 pages / mixed
3. 250 MB / 2,500 pages / image-heavy
4. 400 MB / 5,000 pages / mixed
5. 500 MB / 10,000 pages / high page-count
6. 1 GB / 10,000 pages / large-file
7. 1 GB / 30,000+ pages / high-page-count
8. Real-world large-page-count PDFs
9. Encrypted/password-protected PDFs
10. PDFs containing fonts, annotations, links, forms and large images

## Metrics

- wall-clock merge time
- pages/second
- input MB/second
- peak memory where the browser exposes a trustworthy measurement
- UI responsiveness/main-thread blocking
- successful completion rate
- output file size
- output page count
- PDF open/parse validation after export
- preservation of links, annotations, forms, outlines/bookmarks and page geometry where applicable

## Benchmark gates

A new capacity tier is enabled only after the candidate engine passes the test corpus on the target device class with acceptable reliability and no unacceptable UI freeze.

## Planned engine comparisons

### A. Current pdf-lib

Establish the baseline.

### B. pdf-lib in a Web Worker

Measure UI responsiveness and memory behavior without changing PDF semantics.

### C. qpdf compiled to WebAssembly

Prototype only; no paid dependency. Compare structural merge performance, output validity, memory and browser compatibility.

### D. Future engines

Commercial or differently licensed engines are not part of the current implementation. They may be evaluated later if SafePDFHub revenue justifies licensing.

## Capacity policy

Until the benchmark gate passes, higher theoretical device budgets remain disabled by the engine ceiling. The application therefore does not claim 1 GB or 2 GB browser merge support yet.

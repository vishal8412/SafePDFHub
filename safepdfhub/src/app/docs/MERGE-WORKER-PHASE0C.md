# SafePDFHub — Phase 0C: Merge Worker Benchmark & Capacity Validation

## Purpose

Phase 0C measures the Phase 0B merge implementation on real browser/device workloads before any public capacity increase. It compares the existing `pdf-lib` main-thread path with the Worker-backed path and records only local benchmark results.

## Measurements

Each benchmark run records:

- input bytes
- input page count when supplied by the benchmark case
- elapsed time
- input throughput in MiB/s
- pages/s when page count is known
- maximum observed main-thread heartbeat gap
- output bytes
- output page count
- success/failure and actionable error text
- PDF complexity class supplied by the benchmark case

The heartbeat is a responsiveness indicator, not a browser-native memory measurement.

## Required workload matrix

Run representative files or batches covering, where available:

| Workload | Target |
|---|---:|
| Small | ~10 MB / ~100 pages |
| Medium | ~100 MB / ~1,000 pages |
| Large | ~500 MB / ~5,000 pages |
| Very large | ~1 GB / ~10,000 pages |
| Page-heavy | ~1 GB / ~50,000 pages |
| Real-world extreme | ~558 MB / ~63,656 pages |
| Image-heavy | scanned/image-heavy PDF |
| Font-heavy | embedded-font-heavy PDF |
| Encrypted | protected/encrypted PDF |
| Malformed | intentionally malformed PDF |

The targets are test cases, not promises or public limits. Phase 0A capacity checks may intentionally block some targets on a given device; record that outcome rather than bypassing the capacity service.

## Comparison

For every case that can run:

1. Run main-thread `pdf-lib` merge.
2. Run Worker `pdf-lib` merge.
3. Compare output size and page count.
4. Validate that the output can be loaded again by `pdf-lib`.
5. Record elapsed time and responsiveness.
6. Repeat on representative device classes.

A Worker being faster is not required for correctness. The primary Phase 0B benefit is main-thread isolation and responsiveness.

## Capacity decision rule

Phase 0C does **not** automatically raise public capacity.

A successful local run is evidence, not authorization to increase limits. Before changing the Phase 0A ceiling, review repeated results across:

- conservative/unknown devices
- standard desktop devices
- high-memory desktop devices
- mobile/tablet where supported
- text-heavy, image-heavy, font-heavy, encrypted and malformed PDFs
- byte-heavy and page-heavy workloads

The review must consider success/failure, output fidelity, elapsed time, responsiveness, browser stability and observed memory pressure/OOM behavior where measurable.

No 1 GB or 2 GB capability is enabled merely because the Worker succeeds on one machine.

## Privacy

Benchmarking remains local. PDF contents, metadata, hashes and benchmark results are not uploaded by the benchmark service. The report may contain browser/device capability information needed to interpret a local test, but it does not contain document content.

## Production safety

The benchmark execution override (`main`/`worker`) exists so the harness can compare both implementations. Normal application callers continue to use the default `auto` mode, which selects the Worker when available and keeps the existing main-thread fallback.

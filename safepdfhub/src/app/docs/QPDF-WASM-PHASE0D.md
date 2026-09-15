# SafePDFHub Phase 0D — qpdf WASM Prototype

## Current status

The Phase 0D prototype now has a concrete browser runtime adapter using `qpdf-run` 0.2.1.

`qpdf-run` runs qpdf WASM through its own browser Web Worker, accepts `Uint8Array` inputs, executes qpdf CLI-style arguments, and returns output bytes without sending PDF content to a server.

## Why the SafePDFHub wrapper does not create another Worker

The selected runtime already provides the Worker isolation boundary. Wrapping it in a second SafePDFHub Worker would add complexity without providing a useful additional isolation layer.

The SafePDFHub service therefore owns:

- input collection
- operation cancellation lifecycle
- qpdf command construction
- output conversion to `File`
- error normalization

The qpdf runtime owns:

- WASM initialization
- qpdf execution
- its internal Worker
- WASM memory/filesystem lifecycle

## Merge command

The prototype uses the qpdf page-selection form:

`--empty --pages input-0.pdf input-1.pdf ... -- merged-qpdf-prototype.pdf`

This is intentionally a page-preserving merge prototype. It is not yet the production MergeEngine.

## Dependency installation

The project pins `qpdf-run` to version `0.2.1`. Run `npm install` after replacing the Phase 0D files so npm can materialize the browser runtime package.

The development environment used to prepare this source package has no registry/DNS access, so the package archive itself is not vendored into SafePDFHub. The application source intentionally does not embed a remote CDN fallback.

## Asset/runtime requirements

The application declares `qpdf-run` as an exact dependency and copies its vendored qpdf runtime assets into `/assets/qpdf/` during the Angular build.

The package's browser Worker and runtime modules are resolved through its package exports.

## Privacy boundary

PDF bytes remain in the browser. No SafePDFHub application server endpoint is used by this prototype.

## Production gate

This prototype must pass the Phase 0C/0D benchmark and fidelity gates before it can become a production engine or affect capacity limits.

Required evidence includes:

- merge correctness
- page ordering
- page count
- page dimensions
- links and annotations where supported
- forms/outlines where supported
- encrypted input behavior
- malformed input behavior
- image-heavy and font-heavy PDFs
- main-thread responsiveness
- memory/stability behavior
- representative-device testing
- comparison against the existing pdf-lib Worker

No capacity increase is authorized by this prototype alone.

## 0D.5 — Browser smoke test

A development-only route is available at `/__dev/qpdf-smoke` while running the Angular development configuration.

The smoke test:

1. accepts two or more local PDF files;
2. runs the qpdf WASM merge;
3. validates that the qpdf output is parseable;
4. checks output page count against the sum of input page counts;
5. runs the existing pdf-lib Worker merge on the same inputs;
6. validates the pdf-lib output; and
7. compares page count and ordered page geometry between the two outputs.

The route is protected with Angular's `isDevMode()` route matching and is not intended as a production feature.

## 0D.6 — Fidelity gate

The current automated comparison is deliberately conservative. It treats the following as required smoke-test evidence:

- qpdf output parseability;
- pdf-lib output parseability;
- total page count preservation;
- ordered page width/height preservation.

A passing smoke test is not equivalent to full PDF fidelity. Before qpdf can replace or automatically supplement the production MergeEngine, additional representative PDFs must be tested for links, annotations, forms, outlines/bookmarks, encrypted inputs, malformed inputs, image-heavy documents, font-heavy documents, and visual rendering.

The smoke-test page does not change engine selection, public capacity limits, or privacy policy.

## 0D.9 — Controlled production-readiness gate

The development benchmark page now evaluates the locally stored evidence ledger against a conservative quantitative gate.

The gate is intentionally a review gate, not an automatic engine-selection mechanism. It can report:

- more evidence required;
- promotion review blocked by failures or fidelity gaps;
- fallback review ready; or
- primary-engine review ready.

Fallback-review thresholds currently require at least 10 completed records, 2 device classes, and 4 complexity classes, with no recorded qpdf failures, no hard fidelity mismatches, and complete advanced fidelity fields in successful records.

Primary-review thresholds additionally require at least 20 completed records, 3 device classes, 6 complexity classes including font-heavy, image-heavy, scanned, and mixed workloads, a median qpdf speedup of at least 1.10x, and a median qpdf main-thread gap no greater than 250 ms.

These thresholds are evidence gates only. A passing gate does not authorize changing the production MergeEngine, raising public capacity, or changing privacy behavior. A human review must still cover representative PDFs, memory/stability, cancellation, failure handling, and production fallback semantics.

## 0D.10 — Controlled benchmark test matrix

The development benchmark page now includes a controlled evidence-collection matrix. It tracks coverage for text-light, font-heavy, image-heavy, scanned, mixed, encrypted, malformed, and exploratory workloads, plus representative device classes.

The matrix targets at least 20 completed benchmark records and requires repeated coverage of the core and negative-test classes. It is a planning aid only: it does not alter qpdf engine selection, production behavior, privacy boundaries, or public capacity.

Encrypted and malformed PDFs are treated as negative tests. Their failures must be recorded and investigated rather than being relabeled as successful merges. Test classification should reflect the actual source PDFs used.

The benchmark route is development-only at `/__dev/qpdf-benchmark`. The existing qpdf smoke route remains available at `/__dev/qpdf-smoke`.


## 0D.11 — Memory and stability telemetry

The benchmark now records best-effort runtime stability telemetry for each engine run. Where the browser exposes the non-standard JavaScript heap metric, the benchmark records heap usage before the run, sampled peak heap usage, after-run heap usage, and the observed delta. This is JavaScript heap telemetry and does not directly measure qpdf Worker WASM memory.

Where the browser supports the Long Tasks API, the benchmark records the number of observed long tasks and the maximum long-task duration during the benchmark operation. The existing 25 ms heartbeat remains the cross-browser main-thread responsiveness metric.

Older evidence records remain readable because these telemetry fields are optional. Unsupported metrics are reported as unavailable rather than inferred. This phase does not add an automatic memory threshold, promote qpdf, change the production MergeEngine, or raise public capacity.

## Phase 0D.12 — Controlled repeated-run / soak testing

Phase 0D.12 adds a development-only repeated-run controller to the qpdf benchmark page. It runs the same selected PDF workload repeatedly against qpdf WASM and the existing pdf-lib Worker, with a configurable iteration count (2/5/10/20) and cooldown (0/500/1000/2500/5000 ms).

Each completed iteration is saved through the existing local benchmark evidence ledger. No PDF bytes are stored by the soak controller.

The soak summary reports:
- completed iterations and paired engine successes
- qpdf and pdf-lib failure counts
- fidelity mismatch count across the existing structural/render checks
- median qpdf elapsed time and speedup
- first-to-last qpdf elapsed-time drift
- median/maximum qpdf main-thread gap
- maximum observed Long Task duration
- first-to-last JS heap delta trend when browser telemetry is available

Interpretation rules are deliberately conservative:
- A completed soak only means the requested iterations ran; it is not a production approval.
- Timing drift is a diagnostic signal and is not treated as proof of a memory leak.
- Browser JS heap telemetry does not directly measure qpdf's internal WASM Worker memory.
- Failures and fidelity mismatches remain evidence for review and do not automatically change production engine selection or capacity.
- The production MergeEngine and public capacity limits remain unchanged.

## 0D.14 — Final evidence / corpus hardening

Phase 0D.14 is the final evidence-and-corpus hardening layer for the qpdf prototype. It evaluates the evidence ledger against a stricter representative corpus before any human production-engine review.

The final hardening requirements cover:

- three passing positive runs for each of text-light, font-heavy, image-heavy, scanned, and mixed workloads;
- at least two observed encrypted cases and two malformed cases, with explicit terminal behavior recorded;
- evidence from at least three distinct positive-case device classes;
- positive workloads across four total-input-size bands: below 25 MiB, 25–100 MiB, 100–250 MiB, and at least 250 MiB;
- positive workloads across four page-count bands: 1–99, 100–999, 1,000–4,999, and at least 5,000 pages;
- at least one identical workload signature repeated three or more times;
- complete positive fidelity evidence for page count, geometry, annotations, links, widgets, outlines, fields, and first-page rendering;
- zero qpdf failures on positive workloads.

A workload signature uses only the complexity classification, input file count, total input bytes, and total input pages. It is not a content hash and does not retain PDF bytes.

Encrypted and malformed inputs are negative tests. A qpdf failure on such a case is not automatically a production defect; the actual terminal behavior and error message must be reviewed. Conversely, a successful encrypted or malformed test must also be understood before defining production fallback semantics.

The hardening report can be exported as JSON for archival/review. It contains benchmark metadata, workload dimensions, record IDs, and hardening results only. It does not contain PDF bytes.

A `review-ready` hardening result is a final evidence milestone, not an automatic approval. It does not replace the production MergeEngine, raise capacity, or change the browser-only privacy boundary.


## Phase 0D.15 — Final engineering decision

Phase 0D.15 is the final decision layer for the qpdf investigation. It consumes the Phase 0D.9 quantitative production gate and the Phase 0D.14 final corpus-hardening result and produces an explicit engineering recommendation:

- **Prototype only** — evidence is incomplete or a blocking issue remains;
- **Blocked** — a positive-workload reliability or hard-fidelity issue prevents promotion;
- **Controlled fallback pilot candidate** — the representative corpus and fallback quantitative gate are satisfied, but evidence does not justify making qpdf the primary engine; or
- **Controlled primary-engine experiment candidate** — the representative corpus and primary quantitative gate are satisfied strongly enough to justify a tightly controlled experiment.

The final decision is intentionally not an automatic deployment mechanism. Even a candidate result requires human engineering approval and explicit operational controls. In particular, this phase does not authorize replacing the production MergeEngine, increasing public file/total/page limits, or moving PDF processing to SafePDFHub servers.

For a fallback pilot, pdf-lib Worker remains the safe comparator/fallback and qpdf failure/cancellation behavior must be observable and bounded. For a primary-engine experiment, the experiment must be feature-flagged, reversible, monitored, and limited to an explicitly selected test population before any broader rollout.

The decision report is metadata-only and can be exported for review. It does not contain PDF bytes.

## Phase 0D.16 — Controlled fallback pilot

Phase 0D.16 adds an internal-only pilot service for exercising a reversible qpdf-first path without changing production behavior.

The pilot is explicitly opt-in and is not wired into the production merge workflow. For a selected workload it:

1. validates the input against the existing local processing budget;
2. attempts qpdf WASM;
3. validates qpdf output for parseability, total page count, and ordered page geometry;
4. returns the qpdf output only when that hard gate passes;
5. otherwise falls back to the existing pdf-lib Worker MergeEngine;
6. exposes structured outcome/reason data for manual review.

The pilot does not authorize a production rollout, does not raise capacity, and does not replace the existing MergeEngine. It also does not claim that page-count/geometry validation proves complete PDF fidelity; advanced fidelity evidence from the Phase 0D benchmark/corpus remains required.

Cancellation is propagated to both qpdf-run and the existing MergeEngine. No PDF bytes are persisted by the pilot.

## Phase 0D.17 — Production-pilot hardening

Phase 0D.17 adds fail-closed operational controls around a future qpdf production pilot without connecting qpdf to the production MergeEngine.

### Operational controls

The pilot control service requires all of the following before a future production pilot attempt can be eligible:

- explicit `enabled` configuration
- inactive global kill switch
- explicit human approval recorded
- session rollout bucket inside the configured rollout percentage
- workload inside the pilot file-count and total-byte safety envelope

The current SafePDFHub defaults are intentionally:

- enabled: `false`
- kill switch: `true`
- rollout: `0%`
- human approval: `false`

Therefore the production pilot is **not eligible by default**.

### Telemetry

Pilot telemetry is metadata-only and contains:

- outcome
- input file count
- input byte count
- input page count
- qpdf attempt/success
- fallback usage
- hard-fidelity result
- elapsed time
- coarse failure code

It does not contain filenames, PDF bytes, document text, or document content. Telemetry is held in memory and can be manually exported as JSON for engineering review.

### Global loader cancellation

The shared application loader now exposes a Cancel button only when the active operation registers a cancellation handler. The Merge tool registers `MergeEngine.cancel()` while a merge is running. This keeps the existing cooperative Worker cancellation and 100 ms termination fallback available from the visible loader UI without pretending that every operation is cancellable.

### Production boundary

Phase 0D.17 does not:

- replace the production `MergeEngine`
- change public capacity limits
- upload PDFs
- send PDF content with telemetry
- automatically enable qpdf
- provide a remotely controlled kill switch

A future real production rollout should move operational configuration to a trusted deployment/remote-control mechanism before enabling non-zero rollout. The current static browser configuration is deliberately not considered a secure remote operations system.

## Phase 0D.18 — Feature-flagged production fallback integration

Phase 0D.18 adds a production-facing merge router, but it remains fail-closed by default.
The normal Merge tool now calls `QpdfProductionMergeRouterService`; when the production pilot
configuration is disabled, kill-switched, not approved, outside rollout, or outside its workload
envelope, the router immediately delegates to the existing pdf-lib Worker MergeEngine.

When all pilot controls explicitly authorize a session/workload, the router may attempt qpdf first.
The qpdf result is hard-validated for parseability and page count when known page counts are available.
If qpdf fails or does not pass that gate, the router falls back to the existing pdf-lib Worker engine.
Pilot telemetry remains metadata-only and contains no PDF bytes, filenames, or document content.

Cancellation is propagated through the same visible loader cancellation path to qpdf and the existing
MergeEngine. The integration does not raise public capacity limits, change the browser-only privacy
boundary, or automatically enable the pilot. Human approval and operational configuration remain
required before qpdf can be selected for any real rollout.


## Phase 0D.19 — Production-pilot observability and kill-switch validation

Phase 0D.19 adds metadata-only operational observability and a deterministic safety validation harness for the qpdf production pilot.

The observability snapshot reports qpdf attempts, qpdf success count/rate, pdf-lib fallback count/rate, failures, cancellations, hard-fidelity failures, failure-code counts, and the most recent event timestamp. It never records PDF bytes, filenames, text, or document content.

The kill-switch validation exercises configuration logic only. It verifies that the default configuration is fail-closed, that an active kill switch takes precedence over otherwise-eligible pilot settings, that missing human approval blocks the pilot, that the capacity envelope blocks oversized workloads, and that zero-percent rollout blocks the pilot. It does not execute qpdf, modify configuration, or process PDF bytes.

The production merge router remains fail-closed by default. A blocked eligibility result falls through to the existing pdf-lib Worker path; qpdf is not attempted. The kill switch is therefore a routing guard, not merely a UI indicator.

## Phase 0D.20 — Controlled validation of real production routing paths

Phase 0D.20 adds a development-only validation harness that exercises the same
`QpdfProductionMergeRouterService` used by the real Merge tool without mutating
the production pilot configuration.

The validation scenarios are:

1. **Default production path** — the current fail-closed configuration must use the existing pdf-lib Worker and must not attempt qpdf.
2. **Kill-switch blocked path** — an otherwise eligible configuration with the kill switch active must use the existing Worker and must not attempt qpdf.
3. **Capacity blocked path** — a workload outside the pilot envelope must use the existing Worker and must not attempt qpdf.
4. **Eligible qpdf path** — an explicitly authorized validation configuration may execute the real qpdf WASM path and must pass the router's hard validation before qpdf output is accepted.
5. **qpdf failure → pdf-lib fallback path** — the validation harness forces a qpdf failure *inside the development validation method* and verifies that the same production router recovers through the existing pdf-lib Worker.

The forced qpdf failure is a test-only control and is not available through the normal `merge()` production entry point. It does not modify the real pilot configuration and does not alter public capacity limits.

The validation page also provides a Cancel button. Cancellation calls the same production router `cancel()` method, which propagates cancellation to qpdf and the existing MergeEngine Worker. A cancellation during a validation run is reported as a failed/incomplete validation rather than being treated as a passing routing result.

This phase is a routing safety test, not a qpdf fidelity certification. Advanced fidelity remains governed by the Phase 0D.14 corpus evidence and the Phase 0D.15 final engineering decision. No automatic production rollout is performed.

## Phase 0D — consolidated final release

The incremental 0D work is now consolidated as one engineering milestone. The implementation contains the
capacity/workload guardrails, Worker-based pdf-lib merge path, real progress and cancellation, qpdf WASM
prototype, fidelity checks, benchmark/soak evidence, local evidence ledger, regression thresholds, corpus
hardening, final decision, controlled fallback, production-pilot controls, metadata-only observability,
kill-switch validation, and real production-routing validation.

The production-facing merge boundary remains fail-closed. The current defaults are `enabled=false`,
`killSwitch=true`, `rolloutPercent=0`, and `humanApprovalRecorded=false`. Normal production Merge therefore
continues to use the existing pdf-lib Worker path unless an explicitly approved pilot configuration makes
qpdf eligible. If qpdf is selected and fails its hard validation or execution, the existing pdf-lib Worker is
used as the fallback.

The consolidated Phase 0D release does not authorize an automatic qpdf rollout, public capacity increase,
or privacy-boundary change. Any future qpdf rollout requires human approval and a controlled, reversible
operational mechanism. Benchmark and pilot telemetry remain metadata-only; PDF bytes, filenames, text, and
document content are not stored or transmitted by this evidence infrastructure.

### Phase 0D exit criteria

Phase 0D is considered engineering-complete when the code path and validation harness are in place. It is
not considered evidence-complete until representative benchmark/corpus data satisfies the configured gates.
A failing or incomplete evidence gate means qpdf remains prototype-only or fallback-pilot candidate according
to the final decision service; it never silently promotes qpdf.

No further numbered 0D implementation phases are required. Future work should be treated as a separate
production rollout decision or product-engineering phase, not as another incremental 0D subsystem.

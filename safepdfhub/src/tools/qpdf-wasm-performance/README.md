# SafePDFHub F2-R strategy (current)

## F2-R.1 — Raw AES provider proof

The previous F2 pipeline-buffer patch is frozen and is **not** the active build path. F2-R.1 intentionally leaves qpdf's `Pl_AES_PDF.hh` and `Pl_AES_PDF.cc` unchanged. The only qpdf changes are:

- an optional `QPDFCryptoImpl::rijndael_process_buffer(...)` provider API;
- a default implementation that preserves the original 16-byte operation semantics;
- an OpenSSL implementation that uses one `EVP_EncryptUpdate` / `EVP_DecryptUpdate` call for a block-aligned buffer.

The existing raw-AES WASM export names are retained for Angular compatibility. They are now a provider-level experiment, not evidence that the full PDF pipeline has been bulk-optimized.

### Production gate

F2-R.1 is **not** a production optimization by itself. Before any change to PDF encryption, the following must pass:

1. AES-128 and AES-256 byte-for-byte equivalence between 16-byte and bulk provider paths.
2. Multiple chunk sizes: 16 KiB, 64 KiB, 256 KiB, 1 MiB, 4 MiB.
3. Encryption and decryption/CBC chaining equivalence.
4. qpdf small-PDF correctness using the original `Pl_AES_PDF` path.
5. Only after those gates: a separate F2-R.2 bulk pipeline implementation, isolated from the original class and protected by golden-output tests.

The 40-second large-file target remains unclaimed until measured against the established 222.03 MiB baseline.

---

## Runtime artifact contract

The generated `qpdf-performance.js` and `qpdf-performance.wasm` are runtime-coupled artifacts. The build validates the **public Emscripten JavaScript API** plus the WebAssembly container header/version. It intentionally does **not** require the raw AES function names to appear verbatim in the WebAssembly export section. Optimized Emscripten builds may minify internal WASM export names (for example `ia`, `ja`, ...); the stable contract is the JavaScript `Module._<function>` API used by the Worker.

Required public raw-AES functions:

- `safepdfhubF3RawAesBenchmark` — retained name for Angular compatibility
- `safepdfhubF3RawAesChecksum` — retained name for Angular compatibility
- `safepdfhubF2RRawAesCompare` — F2-R.1 byte-for-byte provider equivalence gate

The repository must not ship or rely on stale generated qpdf assets. Run `build.ps1` after changing the qpdf/WASM build, then run the F2-R.1 raw-provider comparison before considering F2-R.2.

> **Historical sections below:** descriptions of the earlier F2/F3 `Pl_AES_PDF` pipeline mutation are retained for audit history only. They are frozen and are not used by the active Docker build.

# SafePDFHub Phase 1.5E — performance qpdf WASM runtime

The benchmark showed that almost all runtime is spent inside qpdf's `encrypting`
phase. The previous Phase 1.5D recipe enabled `-O3`/LTO/SIMD but still built the
embedded qpdf native crypto provider. This Phase 1.5E recipe changes the actual
CPU hot path as well: qpdf is built with its OpenSSL crypto provider as the only
provider and OpenSSL 3.5.1 is statically compiled for WebAssembly.

The application loads this runtime only for the large-file performance benchmark.
The benchmark path is strict: if the performance assets are absent or invalid,
the Worker fails closed instead of silently falling back to the published qpdf-wasm
runtime.

## Build

Requirements:

- Docker Desktop with a working Linux container runtime
- network access from Docker during image build

Windows PowerShell can use the included `build.ps1` script:

```powershell
./build.ps1
```

Or run the Docker commands manually:

```bash
docker build -t safepdfhub-qpdf-wasm-performance .
docker create --name safepdfhub-qpdf-build safepdfhub-qpdf-wasm-performance
docker cp safepdfhub-qpdf-build:/out/. ./dist/
docker rm safepdfhub-qpdf-build
```

The output must contain:

- `qpdf-performance.js`
- `qpdf-performance.wasm`

Copy those two files to:

```text
src/assets/qpdf/qpdf-performance.js
src/assets/qpdf/qpdf-performance.wasm
```

Do not overwrite the published `qpdf.wasm`/qpdf.js runtime until the A/B gate
passes.

## Why this build exists

qpdf supports multiple crypto providers. Its documentation states that external
providers such as OpenSSL are preferred when available, while the embedded
native provider is intended for dependency-free builds. This recipe explicitly
selects OpenSSL so the benchmark measures a different crypto implementation.

The build also uses:

- qpdf 12.4.1
- OpenSSL 3.5.1 LTS branch
- `-O3`
- LTO
- WebAssembly SIMD (`-msimd128`)
- static linking
- no OpenSSL platform assembly (portable WebAssembly target)

WebAssembly SIMD is a standardized 128-bit SIMD feature supported by modern
browsers; Emscripten enables targeting it with `-msimd128`.

## Validation gate

Benchmark the exact same 222.03 MiB PDF with:

1. Published runtime + AES-128 fast mode — baseline: about 204.8 s from the
   current browser result.
2. Performance runtime + AES-128 fast mode.
3. Performance runtime + AES-256 balanced mode.

Record:

- loading qpdf WASM
- encrypting Worker time
- writing output time
- wall-clock
- output bytes
- `%PDF-` header validity
- password opening
- permission behavior
- PDF fidelity
- max event-loop gap
- peak JS heap

Only promote the performance runtime if it is both faster and functionally
correct across the 15 MiB, 78.93 MiB, 96.78 MiB, 178.60 MiB, 222.03 MiB,
303.20 MiB, 500 MiB, 700 MiB, and 1 GiB corpus.


## Phase 1.5F-F1.2 strict runtime validation

The browser performance path is now strict. For a request selecting the `performance` runtime, SafePDFHub:

1. fetches and validates the WebAssembly magic/version header;
2. loads the dedicated performance JS factory;
3. initializes the matching performance WASM binary;
4. probes `qpdf --version` and requires qpdf 12.4.1;
5. probes `qpdf --show-crypto` and requires OpenSSL as the default provider;
6. refuses to fall back to the published qpdf-wasm runtime.

This prevents a benchmark from accidentally reporting the published runtime as a performance-runtime result. qpdf documents `--show-crypto` as the supported way to list available crypto providers, with the default provider listed first.


## Phase F2 — Bulk AES-CBC engine

F2.1 through F2.6 are implemented as one build-time optimization batch.
The browser Worker/WORKERFS/OPFS architecture is intentionally unchanged.

### F2.1 — Bulk crypto API

`QPDFCryptoImpl` now exposes a bulk AES-CBC operation that accepts a block-aligned
buffer. The original 16-byte primitive remains the compatibility boundary.

### F2.2 — OpenSSL bulk EVP path

The OpenSSL provider overrides the bulk operation with one `EVP_EncryptUpdate`
or `EVP_DecryptUpdate` call per configured buffer while retaining the same CBC
context. This removes the previous provider-call overhead for every 16-byte AES
block.

### F2.3 — qpdf AES pipeline integration

`Pl_AES_PDF` now uses heap-backed streaming buffers and calls the bulk crypto
primitive once per configured buffer. The IV/CBC state remains exactly one AES
block, so the PDF encryption semantics are unchanged.

### F2.4 — OpenSSL/native A/B provider build

The performance artifact now contains both the OpenSSL and native qpdf crypto
providers, with OpenSSL remaining the default. The native provider implements the
same bulk API through the existing 16-byte implementation so it can be benchmarked
as a correctness/reference path.

### F2.5 — Buffer-size matrix

The build accepts these F2 buffer sizes:

- 16 KiB
- 64 KiB
- 256 KiB (current default)
- 1 MiB
- 4 MiB

Run `build-f2-matrix.ps1` to build all five artifacts. Benchmark the exact same
PDF corpus with the same browser/device before promoting a size.

### F2.6 — Production integration and regression gate

The standard `build.ps1` produces the selected F2 runtime and copies it to
`src/assets/qpdf`. The qpdf runtime remains strict: invalid/missing performance
assets fail closed, and the Worker still validates qpdf 12.4.1 and the expected
OpenSSL default provider.

### Important expectation

F2 is intended to remove a major crypto-call overhead. It is **not** assumed in
advance that it will achieve the 40-second target. The 222.03 MiB benchmark must
be rerun after the F2 artifact is installed. The measured throughput, output
fidelity, password behavior, permissions, JS heap, and event-loop gap remain the
gate for the next optimization.


## Phase 0C F2.7 — Final-block correctness

The enlarged streaming buffer is not the AES block size. `Pl_AES_PDF` therefore
uses `buf_size` only for full streaming chunks and `block_size` (16 bytes) for
PKCS#7 padding, IV/CBC state, and final partial-flush alignment. The bulk crypto
provider receives the actual block-aligned `offset` length for every flush.

This distinction is required for PDFs whose final encrypted stream chunk is
smaller than the configured 256 KiB buffer.

## Phase F3 — Crypto Pipeline Profiling & Acceleration

F3.1 through F3.6 are implemented as an additive diagnostic/optimization layer on
 top of F2. The normal Worker + WORKERFS + OPFS architecture is unchanged.

### F3.1 / F3.3 — qpdf AES pipeline profiling

The build adds an opt-in `QPDF_F3_PROFILE=1` path around the bulk AES operation in
`Pl_AES_PDF`. The browser Worker aggregates:

- AES bulk call count
- AES bytes processed
- measured AES elapsed time
- AES throughput
- estimated non-crypto time inside qpdf's `encrypting` phase

Normal Protect requests keep profiling disabled. A normal performance benchmark remains comparable
to the F2 baseline. Full-PDF F3 profiling is an explicit development-only option.

### F3.2 / F3.4 — raw AES provider A/B benchmark

The WASM runtime exports a standalone raw AES benchmark function. The development
page can compare:

- OpenSSL vs native
- AES-128 vs AES-256
- original 16-byte API vs F2 bulk API
- 256 KiB buffer for the provider/mode matrix plus a 16 KiB / 64 KiB / 1 MiB / 4 MiB OpenSSL AES-128 bulk buffer sweep

The benchmark reports elapsed time, MiB/s, and a checksum to guard against a
fully optimized-away test.

### F3.5 — concurrency / stream-parallelism investigation

The development page includes an independent-WASM-worker concurrency probe using
raw AES. This is deliberately **not** treated as PDF stream-level parallelism.
CBC blocks remain sequential, and qpdf's ordered PDF writer is not parallelized by
this phase. Production stream parallelism therefore remains disabled until a
separate correctness-safe qpdf writer design is proven.

### F3.6 — production gate

The F3 runtime keeps the F2 path as the safe baseline. F3 diagnostics are opt-in,
provider selection for normal Protect remains OpenSSL, and missing/invalid
performance assets continue to fail closed.


### F3 regression-safety fix

The F3 profile is now cached once per `Pl_AES_PDF` instance. When disabled, the hot AES
flush path performs only the F2 bulk crypto call; it does not call `getenv()`, read a clock,
or print telemetry for each buffer. The browser benchmark explicitly sends
`enableF3Diagnostics: false`. Raw A/B diagnostics validate the provider being tested rather
than forcing OpenSSL during native-provider tests.


## F3 source-layout correction

qpdf 12.4.1 separates crypto implementation sources from their private headers:

- `include/qpdf/QPDFCryptoImpl.hh`
- `libqpdf/QPDFCrypto_native.cc`
- `libqpdf/QPDFCrypto_openssl.cc`
- `libqpdf/qpdf/QPDFCrypto_native.hh`
- `libqpdf/qpdf/QPDFCrypto_openssl.hh`
- `libqpdf/Pl_AES_PDF.cc`
- `libqpdf/qpdf/Pl_AES_PDF.hh`

The F2/F3 patch scripts and Docker preflight now target those paths explicitly and
emit the discovered matching source files when the layout changes.


## Fix 6

Fix 6 aligns the F2 patch with qpdf 12.4.1's actual `Pl_AES_PDF` implementation: the provider call may be unqualified (`crypto->rijndael_process(inbuf, outbuf)`), and CBC/IV state must remain 16-byte even after the pipeline buffer is enlarged. The patch also converts qpdf's unqualified `inbuf`/`outbuf` accesses to the new heap-backed buffers and validates the IV path.


## Fix 7 — qpdf 12.4.1 Pl_AES_PDF declaration/padding regression

Fix 7 addresses a qpdf 12.4.1 header-shape issue exposed by the first real Emscripten compile:
- qpdf 12.4.1 declares the legacy AES primitive buffer as `static unsigned int const buf_size = QPDFCryptoImpl::rijndael_buf_size;`.
- The previous F2 patch only recognized `size_t` declarations and therefore added a second `buf_size`, causing a duplicate-member compiler error.
- Fix 7 replaces the existing declaration in-place and creates a distinct `block_size` member for the 16-byte AES block.
- PDF AES padding validation now compares the padding byte against `block_size`, not the enlarged 262144-byte pipeline buffer.
- The patch now hard-fails before CMake if duplicate `buf_size` members or the incorrect padding comparison are generated.

This fix is based directly on the qpdf 12.4.1 compiler output from the SafePDFHub build log. It has not been claimed as a Docker/Emscripten build success until the user's actual environment completes the build.


### F3 export hardening

The F3 diagnostic functions are now forced through the WebAssembly linker with explicit `-Wl,--export=` flags in addition to Emscripten `EXPORTED_FUNCTIONS`. This is intentional because the final link uses LTO and the diagnostic functions must remain part of the WASM runtime contract. The validator accepts the canonical wasm symbol names with or without Emscripten's legacy underscore spelling and prints the discovered exports on failure.

## F2-R.2 isolated PDF-pipeline candidate

F2-R.2 is deliberately built as a separate validation artifact. Run
`build-f2r2.ps1` only after the F2-R.1 `build.ps1` has completed successfully.

The build produces two WASM runtimes under `src/assets/qpdf/f2r2/`:

- `qpdf-reference.js/.wasm` — F2-R.1 provider-only runtime with qpdf's original `Pl_AES_PDF`.
- `qpdf-f2r2-candidate.js/.wasm` — isolated bulk AES-CBC candidate.

The candidate never replaces `qpdf-performance.js/.wasm`. The development
benchmark page uses both artifacts for deterministic A/B validation. F2-R.2 is
limited to 100 MiB until the candidate passes the correctness gates.

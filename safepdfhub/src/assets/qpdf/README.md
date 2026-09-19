# SafePDFHub qpdf performance runtime

This directory is populated by `src/tools/qpdf-wasm-performance/build.ps1`.

The performance benchmark requires these generated artifacts:

- `qpdf-performance.js`
- `qpdf-performance.wasm`

Do not replace the WASM file with a text/HTML placeholder. The benchmark validates the WebAssembly magic header before loading it and will fail closed if the artifact is missing or invalid.

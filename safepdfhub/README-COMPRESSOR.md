# SafePDFHub compressor integration

This archive contains the updated source and configuration assembled from the supplied project files. Extract it into a new folder. It does not deploy or overwrite a live website.

## Hosting

For Netlify with Angular SSR, follow `NETLIFY.md`. For a regular Node.js server, follow `PRODUCTION.md` and use `deployment/safepdfhub/`.

## Production package

See `PRODUCTION.md`. The ready-built `deployment/safepdfhub/` folder is the deployable runtime; the rest of this archive is the source and maintenance material. Rebuild it with `npm run package:production`.

## Run locally

Use a Node.js version supported by the locked Angular dependencies (validated here with Node 24.19.0).

```sh
npm ci
npm test -- --watch=false
npm run build
npm start
```

Open `http://localhost:4200/tools/compress-pdf`.

On a memory-constrained build machine, reduce Angular build concurrency:

```sh
# Bash
NG_BUILD_MAX_WORKERS=2 npm run build
```

```powershell
# PowerShell
$env:NG_BUILD_MAX_WORKERS = '2'
npm run build
```

Keep the complete build output and its worker chunks/assets when deploying using your existing hosting process. No new production dependency was added.

## Current release: quality modes through 200 MB

Read `release-notes/modes-200mb-device-report.md` for the current policy, measured results and limitations. Earlier release reports describe historical behavior.

- High Quality, Smart Compression and Maximum Reduction remain selectable through **200 MB**, including exactly 200,000,000 bytes. Above 200 MB, compression is lossless only.
- 32 MB is now only the threshold for switching to disk-backed processing. It no longer disables quality modes.
- Capable desktops accept up to **500 MB**, tablets **300 MB**, and phones **200 MB**. Limits depend on the reported memory and required browser features; see the report for every tier.
- Large jobs use bounded worker memory, chunked input reads, disk-backed output, image resource checks, storage checks and cancellation cleanup. No full-document rendered previews are created above 32 MB.
- Target search keeps the smallest validated candidate and compares actual output bytes with the requested size. A target cannot be guaranteed for every PDF.
- No new production dependency was added. Other tools' size limits are unchanged.

PDFs up to 32 MB retain the prior compression pipeline. The supplied 15.5 MB / 842-page benchmark is documented in `release-notes/speed-targets-report.md`.

## Browser validation

Install the harness dependencies separately:

```sh
python -m pip install -r scripts/requirements-compression-v2-browser.txt
python -m playwright install chromium
```

Place the source PDF at the project root, then run:

```sh
python scripts/compression-v2-qpdf-r7-capability-matrix.py --input 15-MB.pdf --levels recommended --start-server --output-dir benchmark-results/local-15mb
python scripts/compression-v2-memory-cancellation-stress.py 15-MB.pdf --start-server --runs 3 --cancel-after-ms 1000
```

Do not run builds, edit source files, or run another benchmark against the same development server during measurement: live reload can invalidate a case. The `--browser` option accepts an existing Chromium executable if needed.

## Outstanding release gate

The supplied `benchmark-corpus.zip` was unavailable. The required R7.5.3 check on `gao-22-4sp.pdf` and the 17-document corpus are not certified by this delivery. After restoring the corpus, run the focused GAO case first:

```sh
python scripts/compression-v2-qpdf-r7-capability-matrix.py --input benchmark-corpus/qpdf-r7/focused/gao-22-4sp.pdf --levels light recommended strong --start-server --output-dir benchmark-results/r7.5.3-focused
```

Only proceed to the full corpus if the focused case passes. See the accompanying implementation/validation report for actual measurements and limitations.

## SEO and AI search readiness

See [SEO.md](SEO.md) for rendered-response verification, canonical domains, crawler controls, preview indexing, and the production search-engine setup checklist. Node staging/local hosts require `SSR_ALLOWED_HOSTS`; use `INDEXING_DISABLED=true` at build and runtime for staging.

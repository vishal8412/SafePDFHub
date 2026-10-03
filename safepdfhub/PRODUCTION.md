# Production deployment

The ZIP contains both the maintainable source project and a ready-built runtime in `deployment/safepdfhub/`. Deploy **only that runtime folder**, keeping `browser/` and `server/` together. Do not point a web server at the source project root.

## Start the included runtime

Use Node.js 24 (the version used for validation). From `deployment/safepdfhub/`:

```sh
npm start
```

The default port is 4000. Set `PORT` in your hosting environment if required. Put an HTTPS reverse proxy or your host's HTTPS endpoint in front of this Node server. The browser compressor requires a secure context outside localhost.

This project uses Angular server rendering and an Express contact endpoint. Uploading only the `browser/` folder to a static host is not an equivalent deployment: the server routes, contact endpoint and redirects need the Node server. The included bundle is self-contained for its tested runtime paths; it was started outside the source project without a node_modules directory.

Set `NODE_ENV=production`. Inject `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` and `CONTACT_TO_EMAIL` through your host's environment if you want the contact form to send email. Without them, the existing contact endpoint returns a friendly unavailable response. Enable `TRUST_PROXY=true` only when your trusted reverse proxy overwrites forwarded client-IP headers. Review the configured public URL and email addresses in `src/app/config/site.config.ts` if your domain differs from safepdfhub.com, then rebuild.

## Build a fresh runtime after edits

From the source project root:

```sh
npm ci
npm test -- --watch=false
npm run package:production
```

This explicitly runs Angular's default production build, validates that no Markdown, source maps or experimental f2r2 assets entered the public output, and recreates `deployment/safepdfhub/`. It retains runtime workers, WASM, server chunks and third-party license notices. A SHA-256 inventory is written to `manifest.json`.

The runtime folder contains no source TypeScript, tests, fixtures, benchmark reports, build scripts, package lockfile, development dependencies or local credentials. Keep the source project's package-lock.json for reproducible builds. Do not install build dependencies on the runtime server unless your hosting workflow builds there.

## What was cleaned up

- Five benchmark/smoke/investigation routes now live in a separate development-route module. Production replaces that module with an empty route list, eliminating the lazy benchmark imports rather than merely hiding them with a route guard. Development mode retains these tools.
- Production asset copying excludes the approximately 8.8 MB `assets/qpdf/f2r2/` experimental runtime pair, asset README files and two unreferenced legacy PNG logos. These source assets remain available for historical development work.
- Removed `src/assets/pdf.worker.mjs`, an unreferenced 44-byte placeholder containing a filesystem path rather than worker JavaScript. The real PDF.js worker copied from the locked dependency remains included.
- Production returns HTTP 404 for `/__dev` requests.
- Static assets now revalidate instead of receiving a blanket one-year freshness lifetime. This is necessary for stable qpdf/WASM filenames; ETags still allow conditional responses. An existing CDN cache may need invalidation when rolling out this change.
- Added a repeatable runtime packaging command and ignored generated deployment/benchmark/Python cache files in version control.

## Files deliberately retained

Tests, regression fixtures, release evidence, audit scripts and qpdf build/patch tools are useful maintenance files, not runtime dependencies. They remain in the source archive but are absent from the deployment folder. Required qpdf-performance.js, qpdf-performance.wasm, qpdf-compression-bounded.js, the published qpdf.wasm, PDF.js worker, application chunks and branding assets remain in production. A filename containing “performance” or “worker” is not evidence that it is unused.

No general-purpose PDF feature was removed, and dependencies were not deleted based on filename searches. This review addresses production inclusion and known unused assets, not a claim that every remaining source declaration is used.

## Validation and remaining checks

All 215 tests passed. Production build and runtime packaging passed. See `release-notes/production-cleanup-report.md` and accompanying evidence for the isolated server/browser smoke test.

The previous physical-mobile testing and unavailable PDF corpus limitations still apply. Hosting-specific TLS, domain, environment, proxy settings and email delivery must be configured on your actual host. No live deployment was performed.

## SEO and AI search readiness

See [SEO.md](SEO.md) for rendered-response verification, canonical domains, crawler controls, preview indexing, and the production search-engine setup checklist. Node staging/local hosts require `SSR_ALLOWED_HOSTS`; use `INDEXING_DISABLED=true` at build and runtime for staging.

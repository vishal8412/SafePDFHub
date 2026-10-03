# Deploy SafePDFHub to Netlify

The project has a Netlify Angular Runtime configuration. It uses Angular server-side rendering through Netlify's Angular adapter while retaining `/api/contact`, legacy URL redirects, `robots.txt` and `sitemap.xml` in the same request handler. PDF compression still runs locally in each visitor's browser.

## Connect the project

Push the complete source project to a Git repository, then import that repository in Netlify. Set the Netlify **Base directory** to the `project` folder if the repository root contains this folder. The repository root can be used directly if the contents of `project` were pushed as the repository root.

The included `netlify.toml` sets the build command, browser publish directory, Node 24.19 build runtime, and Angular SSR plugin. Keep the `src/server.ts`, Angular SSR settings in `angular.json`, lockfile and runtime dependency `@netlify/angular-runtime` together. Do not select `deployment/safepdfhub/` as the Netlify publish directory; that is the separate, standalone Node server package.

In the Netlify site settings, configure these runtime environment variables for the contact form:

- `RESEND_API_KEY`
- `CONTACT_FROM_EMAIL`
- `CONTACT_TO_EMAIL`

The app returns a clear unavailable response if they are not configured. Set `CONTACT_FROM_EMAIL` to an address verified with Resend. Never put the API key in Angular/browser environment files.

## Local build and preview

```sh
npm ci
npm test -- --watch=false
npm run build
```

To exercise Netlify's adapter locally, install/use Netlify CLI and run:

```sh
netlify build
netlify serve
```

The regular Angular production build and local Node server can also run without Netlify. `src/server.ts` exports both the existing Express/Angular Node handler and the named Angular App Engine request handler that the Netlify adapter detects.

## Validation status

The source build passes, and direct Node invocation of the Netlify handler rendered `/tools/compress-pdf` as HTML. Local checks returned correct responses for the contact endpoint, old URL redirects, crawler files and blocked developer routes. All 218 unit tests pass.

The Netlify CLI completed the Angular production build and generated the SSR Edge Function entry, but the CLI's later Edge Function bundling step stopped at `fetch failed` in this restricted build environment. Therefore, the final Netlify-specific Edge bundle and a deployed preview still need to be verified by a Netlify build. Do not treat the local Express smoke test as a Netlify deployment test.

## References

- Netlify's Angular integration: https://docs.netlify.com/build/frameworks/framework-setup-guides/angular/
- Netlify Angular Runtime handler customization: https://developers.netlify.com/guides/whats-new-with-angular-19-on-netlify/

## SEO and AI search readiness

See [SEO.md](SEO.md) for rendered-response verification, canonical domains, crawler controls, preview indexing, and the production search-engine setup checklist. Node staging/local hosts require `SSR_ALLOWED_HOSTS`; use `INDEXING_DISABLED=true` at build and runtime for staging.

# SafePDFHub SEO and AI search readiness

## What this release improves

- Public pages deliver content and metadata through Angular SSR. The seven tool pages now explain their implemented steps and limitations in visible HTML.
- Missing pages and unsupported tools return HTTP 404 with a helpful noindex page. They no longer redirect to the home page. `/pdf-to-word` is unimplemented and is intentionally absent from navigation and the sitemap.
- All seven legacy tool URLs, `/tool/<implemented-slug>`, and trailing slashes redirect with HTTP 301. Query parameters are preserved; canonical metadata excludes query parameters.
- Node SSR explicitly allows the configured production domain. Set `SSR_ALLOWED_HOSTS` to comma-separated additional hostnames for other domains or local testing, e.g. `localhost`. Do not put protocols, paths, or ports in this setting. Update `SITE_CONFIG` and `angular.json` if the production domain changes.
- Robots and sitemap responses share one implementation across Node and the Netlify fetch handler. The generated assets carry the same public inventory: six static pages plus seven tools. Private editor, API, development, and nonexistent tool URLs are excluded.
- Production robots permits normal search and AI crawlers to access public pages. This does not override hosting firewalls, bot challenges, crawler policies, or guarantee indexing. The existing GPTBot training policy has not changed.
- Preview/branch builds generate a blocking robots file. SSR adds noindex headers when the Netlify preview context or preview URL indicates a preview deployment. For other staging hosts set `INDEXING_DISABLED=true` at build and runtime. Studio and API responses also carry noindex headers.
- Compressor descriptions explain lossless versus image compression, variable device capacity, and the possibility of an unmet target size. No universal lossless-quality or instant-processing claim is made.
- Tool application JSON-LD identifies the application URL, publisher, language, browser requirement, and free access. Existing home Organization/WebSite and tool BreadcrumbList markup is retained. Ratings and reviews are not fabricated. Visible questions are helpful content, not a promise of FAQ rich results.

## Verification commands

```bash
npm ci
npm test -- --watch=false
npm run build
npm run seo:audit
npm run seo:audit:rendered
```

The rendered audit imports the production Netlify fetch handler and inspects response HTML with no crawler JavaScript. For the Node server, start it separately and run:

```bash
SSR_ALLOWED_HOSTS=localhost PORT=4179 npm run serve:ssr:safepdfhub
SEO_AUDIT_BASE_URL=http://localhost:4179 npm run seo:audit:rendered
```

Audit failures return a nonzero exit code. The fetch test runs in Node; it is not a substitute for deployed Netlify Edge testing.

## Production launch checks

1. Configure HTTPS and choose one production domain. Canonicals currently use `https://safepdfhub.com`; confirm this is your intended domain. Redirect alternate domain names to it in the hosting/domain settings.
2. Deploy the updated project. Check source HTML for the title, description, canonical, one H1, and tool guidance. Ensure the deployed public pages return 200, missing pages return 404, and legacy URLs return 301.
3. Verify a domain property in Google Search Console and verify the site in Bing Webmaster Tools. Submit `https://safepdfhub.com/sitemap.xml` in each account. No account verification or URL submissions were performed by this release.
4. Inspect `/robots.txt` on production and preview URLs. Production must permit public crawling; previews must block it. Ensure production has no noindex header. Keep JavaScript, CSS, and public assets accessible.
5. Check Google Search Console URL Inspection and indexing reports. Review the current generative AI inclusion setting in Search Console where available. Use Bing URL Inspection as well.
6. Check real field performance on phones and tablets and Core Web Vitals after sufficient live traffic. No Lighthouse score or live Core Web Vitals result is claimed in this audit. Consider self-hosted fonts and a branded raster social image as future improvements.
7. Ensure CDN/security settings permit verified search crawlers, including OAI-SearchBot if ChatGPT Search visibility is wanted. Search crawling and model-training crawling are separate choices; review bot policies deliberately.

## Limits and references

SEO improves discoverability and eligibility; no provider guarantees crawling, indexing, ranking, or AI citation. Google says the normal SEO foundations also apply to its AI search features and that special files such as llms.txt do not improve Google Search rankings. Useful product-specific guidance is therefore served directly on the real tool pages.

- Google AI search guidance: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google JavaScript SEO and HTTP status codes: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- OpenAI search and training crawler controls: https://developers.openai.com/api/docs/bots

The prior Netlify Edge bundler validation remains incomplete: an external fetch failed, and automatic approval review rejected the diagnostic retry because it could transmit project/build artifacts to an unverified external service. That action has not been retried. This SEO release verifies local Node HTTP and the compiled fetch handler; a successful live Netlify deployment still needs verification.

# SafePDFHub: search and AI discovery update

This document describes the initial AEO/GEO update. The current keyword and guide release is documented in README-SEO-GROWTH.md and SEO-GROWTH-VALIDATION.json.

This release improves the public HTML and discovery metadata across all nine implemented tools. It builds on the existing Angular SSR architecture and shared guide design. It does not change the PDF compression, conversion, editing, signing, or download engines.

## What changed

- Each tool landing page now has a concise, tool-specific answer, input/output facts, processing details, and practical limitations.
- The shared guide contains 40 visible questions and answers across the nine tools. Answers have stable section anchors and remain readable in the server response without JavaScript or a file upload.
- FAQPage structured data uses the same answer configuration as the visible FAQ. WebPage metadata connects the application, breadcrumb, website, and question section. WebApplication uses the product label and visible feature facts. Tool schemas are cleared correctly when navigating to other pages.
- The homepage identifies the implemented tool directory through ItemList structured data. Related-tool links appear on each landing page before a user selects a file.
- The sitemap, robots.txt, and optional llms.txt navigation index are generated from shared configuration. The HTTP endpoints and generated files use the same builders to prevent policy drift. Word to PDF is included in the discovery index.
- OAI-SearchBot, PerplexityBot, and Claude-SearchBot explicitly receive the public crawling policy, with the same API and development-path restrictions as other crawlers. Existing general training-crawler permissions are preserved. Studio remains crawlable so crawlers can read its noindex directive; it is excluded from the sitemap and discovery index. Preview deployments remain blocked from indexing.

These improvements support discoverability and clear interpretation. FAQ markup is not a promise of a Google rich result or AI citation. llms.txt is an optional navigation index, not a search-engine requirement. There are no fabricated reviews, authors, benchmark statistics, or modified timestamps.

## Run the checks

From the SafePDFHub directory:

```sh
npm ci
npm run build
npm run test:discovery
npm run aeo:geo:audit
```

The rendered audit uses the compiled Netlify request handler locally unless SEO_AUDIT_BASE_URL is supplied. It validates all public pages, HTML answers, FAQ/schema agreement, canonical links, redirects, robots.txt, sitemap.xml, llms.txt, noindex behavior, and the responses sent to AI search user agents. This is a local production-build check, not a test of your live hosting firewall or CDN.

The optional `npm run aeo:geo:browser` check requires Playwright and Chromium. It supports `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE`, `DISCOVERY_QA_DIR`, and `SEO_AUDIT_BASE_URL`. It checks the nine pages at 1440, 768, 390, and 320 pixels, keyboard FAQ operation, upload input presence, related navigation, and client-side metadata cleanup. Screenshots are for local inspection.

Validation for this release: 8 discovery unit tests passed; the production build passed; 15 rendered pages passed; all 40 visible FAQ answers matched their structured data; 27 AI-search user-agent requests and 27 legacy/canonical redirects passed; the nine-tool browser checks passed at four widths. Existing Studio stylesheet-budget and dependency optimization warnings remain.

## After deployment

1. Confirm SITE_CONFIG.url is your production domain before building. Set INDEXING_DISABLED=true for any additional test deployment that is not recognized as a Netlify preview.
2. Verify the production domain in Google Search Console and Bing Webmaster Tools, then submit https://safepdfhub.com/sitemap.xml. Use the URL inspection tools on the home page and each tool page.
3. Run the audit against your deployed domain. In Windows PowerShell:

```powershell
$env:SEO_AUDIT_BASE_URL = 'https://safepdfhub.com'
npm run seo:audit:rendered
Remove-Item Env:SEO_AUDIT_BASE_URL
```

4. Check production firewall/CDN logs for legitimate search crawler access. A robots permission does not override a hosting-level block. Use each provider's current verification guidance instead of trusting a user-agent string alone.
5. Establish a baseline in Search Console and Bing Webmaster Tools, including Bing AI Performance where available. Track indexed tool URLs, relevant queries, source citations, search referrals, and completed tool use. No additional user-document telemetry was introduced in this release.
6. Keep TOOL_DISCOVERY and TOOL_GUIDES aligned with the actual product as formats, device limits, and workflows change. Add original benchmark or compatibility evidence only after measuring it. Avoid publishing near-identical tool/keyword pages.

Search-console ownership, sitemap submission, firewall configuration, and live ranking/citation measurements require your production accounts; this code update does not perform those account actions.

## Reference guidance

- Google AI search guidance: https://developers.google.com/search/docs/appearance/ai-features
- Google JavaScript SEO: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- OpenAI search crawler controls: https://developers.openai.com/api/docs/bots
- Perplexity crawler controls: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
- Anthropic crawler controls: https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
- Bing AI Performance: https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/

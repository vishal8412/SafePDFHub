# SafePDFHub keyword and SEO growth release

The full research and operating plan is in `seo-research/SEO-GROWTH-STRATEGY.md`. Read that file for competitive findings, the limits of the research, and the 90-day plan.

## Included

- 177 unique keyword candidates in 24 intent clusters, mapped to 18 canonical destinations. CSV and JSON versions are provided in `seo-research/`.
- An exclusions/future list for searches the current product cannot accurately serve.
- Updated titles and descriptions for the nine tools and home page, plus corrected Word-to-PDF workflow copy.
- A public PDF guide hub at `/guides` and eight detailed help articles covering target sizes, scans, compression problems, merging, extraction, OCR, DOCX formatting, and private workflows.
- Links between home, footer, tools, and guides; article/collection structured data; canonical URLs and updated sitemap/discovery assets.
- Automated checks for keyword targets, server-rendered guide content, missing pages, redirects, and client-side metadata cleanup.

The article bodies are loaded with the guide route rather than the application startup bundle. The current production build reports an initial bundle total of approximately 414 kB raw. This is a bundle-size observation, not a Core Web Vitals field score.

## Install, build, and verify

```sh
npm ci
npm run build
npm run test:discovery
npm run seo:growth:audit
```

For browser checks, configure Playwright and Chromium as described in `README-AEO-GEO.md`, then run `npm run aeo:geo:browser`. The browser test covers tool and guide layouts, keyboard FAQs, navigation, homepage links, and route metadata.

## Deploy and establish a real baseline

1. Confirm the production URL in SITE_CONFIG and deploy the code using the existing Angular SSR setup.
2. Check the production home page, `/guides`, a tool page, an article, `/robots.txt`, `/sitemap.xml`, and `/llms.txt`. Confirm that Studio is noindex and preview deployments are not indexed.
3. Verify the domain in Google Search Console and Bing Webmaster Tools and submit the sitemap. Use their URL inspection tools to check rendered content and indexation.
4. Run `npm run seo:audit:rendered` with `SEO_AUDIT_BASE_URL` set to the production origin. The default audit checks the compiled handler locally; it does not verify the hosting firewall or live domain.
5. Fill `seo-research/measurement-baseline.csv` using actual Search Console and chosen keyword-platform data. Keep country, language, device, and date settings consistent.

For Windows PowerShell, a live audit looks like:

```powershell
$env:SEO_AUDIT_BASE_URL = 'https://safepdfhub.com'
npm run seo:audit:rendered
Remove-Item Env:SEO_AUDIT_BASE_URL
```

Search volume, numeric keyword difficulty, current rankings, traffic, and market share have not been fabricated. The keyword list distinguishes observed vocabulary from research candidates. Priorities are qualitative product-fit decisions pending live measurement. The strategy report also identifies remaining production identity/policy work, benchmark evidence, outreach, and internationalization decisions.

This release implements source changes and locally validates them. It does not publish the website, verify search-console ownership, submit live sitemap URLs, send outreach messages, or guarantee a search position. Existing Studio style-budget and CommonJS dependency warnings remain.

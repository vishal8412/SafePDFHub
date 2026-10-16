# SafePDFHub: keyword research and competitive growth plan

Research date: 16 October 2026. Initial scope: English-language discovery worldwide, measured separately by country and device.

## The decision

Build a strong, verifiable product for a defined set of document jobs and make those jobs easy to find. Keep the main tool pages competitive for broad terms such as “compress PDF” and “PDF to Word,” while supporting specific problems with useful guides and clear links back to the relevant tool.

Top three is a goal for a particular query, location, device, and observation period. It is not one worldwide position that a website can obtain for every search. Neither this release nor any SEO supplier can honestly guarantee universal first place. The operating goal should combine qualified search discovery with successful document processing and repeat use.

## What was researched, and what is still unknown

- Reviewed current search-result samples and first-party pages from Adobe Acrobat, iLovePDF, Smallpdf, PDF24, PDFgear, and other tools appearing for size, scanning, local-processing, and OCR searches.
- Reviewed Google's current technical, snippet, page-experience, spam-policy, and internationalization guidance.
- Compared those intents with the implemented SafePDFHub tools and their current limitations.
- Produced 177 unique keyword candidates in 24 intent clusters, mapped to 18 canonical targets. The map marks observed query/result vocabulary separately from phrase candidates derived from those intents. It does not claim that all candidates have measurable demand.
- Monthly search volume, paid CPC, numeric keyword difficulty, backlink strength, current organic positions, and competitor traffic were **not measured**. Those fields remain empty in the dataset. No estimates have been invented.
- Search-result samples are useful for identifying intent and competitors. They are not a controlled Google rank-tracking report and do not establish current top-three positions.
- The configured domain is https://safepdfhub.com. The research environment could not verify its live home page, robots.txt, or sitemap responses. That is an unresolved live-audit gap, not proof that the site is down or unindexed. Local production-build checks are reported separately.

The next data inputs are a verified live production URL, Search Console exports, and country-specific Keyword Planner or a chosen SEO-platform dataset. These should refine the priorities below, not be replaced by guesses.

## Competitive findings

These are statements visible on the providers' pages when researched; their performance was not independently benchmarked.

| Provider | Observed positioning | Implication for SafePDFHub |
|---|---|---|
| [Adobe Acrobat](https://www.adobe.com/acrobat/online/compress-pdf.html) | Broad document suite; its web compression page describes server handling and advertises inputs up to 2 GB. | A 500 MB limit is not evidence of the world's largest capacity. Demonstrate reliable local workflows and device-aware limits instead. |
| [iLovePDF](https://www.ilovepdf.com/compress_pdf) | Compression presets and a broad connected toolbox. Its [PDF-to-Word page](https://www.ilovepdf.com/pdf_to_word) distinguishes ordinary conversion from OCR. | A connected journey and clear mode choices are expected. Explain the actual output and limitations, then make the next task easy. |
| [Smallpdf](https://smallpdf.com/compress-pdf) | Compression modes, trust messaging, and related tutorials including a [1 MB guide](https://smallpdf.com/blog/compress-pdf-to-1mb). | Specific file-size intent is already competitive. A size guide must solve the problem rather than repeat a keyword. |
| [PDF24 web tools](https://tools.pdf24.org/en/compress-pdf) | Free tools with detailed controls; the web page describes cloud compression. | Clear controls, help, and truthful quality tradeoffs matter. Do not confuse its web service with its separate desktop software. |
| [PDFgear](https://www.pdfgear.com/secure-pdf-tools/) | Advertises local browser tools; its [merge page](https://www.pdfgear.com/merge-pdf/) explicitly describes processing without document upload. | “No upload” is useful but not unique. Back the complete workflow with evidence, dependable output, and understandable limits. |

The market contains both major suites and smaller local tools. Longer queries can express a clearer task, but they are not automatically easy or low competition. P1 below means a strong product-and-intent fit, not a measured low difficulty score.

## Keyword priorities and page ownership

`keyword-map.csv` is the detailed working dataset; `keyword-map.json` is the equivalent machine-readable source. Each candidate has one target page to reduce conflicting page ownership. Informational and transactional intent are separated where appropriate.

| Acquisition focus | Representative queries | Primary destination | Why this fits |
|---|---|---|---|
| P1: target-size attempts | compress PDF to 1MB, 2MB, 5MB; PDF target size compressor | `/tools/compress-pdf` | The existing target control supports the task; success must be checked against actual bytes. |
| P1: target-size explanations | how to compress PDF to a specific size; PDF still above size limit | `/guides/compress-pdf-to-target-size` | Explains settings, MB/KB values, unreadable results, and unmet targets. |
| P1: scanned documents | compress scanned PDF; scanned PDF too large | Tool plus `/guides/compress-scanned-pdf`, according to intent | Image-heavy documents create a concrete size/readability problem. |
| P1: compression problems | why PDF size is not reducing; PDF not compressing | `/guides/why-pdf-size-is-not-reducing` | Gives an honest diagnosis rather than promising every file will shrink. |
| P1: local organizing | merge PDF without uploading; extract PDF pages locally | Merge and Split tools | Existing workflows support these specific tasks; competitors also target them. |
| P1: OCR conversion | scanned PDF to Word; PDF to Word Hindi OCR; Marathi OCR | PDF-to-Word tool and OCR guide | Language selection, editable text, image-only fallbacks, and proofreading need clear explanations. |
| P1: conversion problems | Word to PDF formatting changes; extra pages; table alignment | `/guides/word-to-pdf-formatting` | Helps users understand a real compatibility problem and verify the result. |
| P1: smaller workflow clusters | known-password unlocking; watermark selected pages; custom PDF password | Relevant tool pages | Strong feature fit. Actual demand still needs validation. |
| P2: broad acquisition | compress PDF, merge PDF, PDF to Word, Word to PDF, sign PDF | Main tool pages | Necessary long-term targets, with substantial established competition. |
| P2: category and brand | free PDF tools; PDF tools online; SafePDFHub | Home page and consistent brand references | Establishes a clear category and a recognizable product identity. |

The active map intentionally does not advertise unsupported functionality. `excluded-or-future-keywords.csv` records searches such as legacy DOC conversion, PDF-to-Excel, password recovery without the password, certificate signing, and a standalone searchable-PDF OCR output. A feature should be implemented and tested before it gets a transactional landing page.

## What this code release implements

1. More descriptive titles and meta descriptions for all nine tool pages, and a clearer home-page category heading.
2. A public `/guides` hub and eight full guides with specific workflows, examples, checklists, limitations, and references where appropriate.
3. Links from the home page, footer, and tool guides to the new content, with links back from articles to their relevant tools.
4. Article and collection structured data, clean canonical URLs, and metadata cleanup during browser navigation. Research keywords guide visible content; the obsolete meta-keywords tag is no longer emitted.
5. A sitemap and optional discovery index covering the public inventory, while preserving Studio noindex and preview-deployment controls.
6. A keyword-map integrity check that catches duplicate terms and unavailable target pages, plus expanded server-rendered and browser checks for the new routes.
7. Factual copy fixes for the current Word-to-PDF download workflow on the home and privacy pages.

There are no duplicate “1 MB / 2 MB / 3 MB” doorway pages, fabricated reviews, invented expert biographies, fake performance statistics, or automatically refreshed article dates. The article update date is a source value and should change when the article is actually revised.

## The work that makes a market leader

### Product evidence before superlatives

Keywords cannot compensate for a broken or misleading result. Use a versioned, permission-safe test corpus covering text PDFs, photographs, monochrome scans, JPEG/JPX content, mixed pages, fonts, forms, protected documents, and large files. Include supported mobile and tablet environments as well as desktops.

Record file hashes, input bytes, page count, device/browser version, elapsed time, output bytes, whether the target was reached, and whether the output opens correctly. Inspect readability and relevant text/search behavior. Count failures rather than removing them from the report. Report median and slower-tail timings with the hardware and test procedure.

Publish a compact benchmark only after running it reproducibly. A useful evidence page can attract citations and earned references; an unverified “fastest in the world” claim cannot establish that position. Do not compare a local workflow with a server workflow without explaining whether upload and download time are included.

### Trust and production readiness

Verify production availability, canonical hostname behavior, actual operator/contact details, and the enabled hosting and measurement services. The existing policy pages still contain launch-review language that needs the real production details; this release only corrects the inaccurate conversion paragraph. Complete that work before presenting policy text as a finalized description of the business.

Keep compression estimates distinct from actual results, describe unsupported formats accurately, and retain clear error and completion states. Make the visible Download action unambiguous. A successful file and understandable limits are part of the growth strategy, not merely engineering details.

### Authority and distribution

Prepare a useful demonstration and a reproducible benchmark before asking for editorial coverage. Seek relevant software, developer, education, and document-workflow references. Answer real questions where the tool genuinely helps and disclose your affiliation. Submit accurate product information to suitable directories rather than generating mass listings.

Build relationships around useful evidence: a local-processing explanation, a scan-readability checklist, or a documented conversion compatibility matrix. Do not buy ranking links, manufacture reviews, or use irrelevant link networks. No outreach messages or directory submissions have been sent as part of this code update.

### International expansion

Start with a coherent English product and measure countries separately. Add a language when its demand, product language support, and review capacity justify it. Spanish, Portuguese, and Hindi are candidates for evaluation, not measured recommendations from this research.

Use separate URLs for completed translations, consistent navigation, and reciprocal hreflang only for pages that actually exist. Translate the workflow and support content, not just the title. Hindi or Marathi OCR support does not imply that the entire website is localized or that the converter translates documents.

## A 90-day execution plan

This is an operational plan, not a forecast of ranking dates.

| Period | Priority work | Evidence of completion |
|---|---|---|
| Days 1–14 | Deploy this release; verify the production domain in Search Console and Bing Webmaster Tools; submit the sitemap; inspect representative tool and guide URLs; verify production contact/policy details. | Successful live crawler responses, indexed-page observations, a dated baseline, and an accurate production inventory. |
| Days 15–30 | Validate the P1 candidates with country-specific demand data and actual query impressions. Select a fixed pilot panel of 20 queries. Measure task success and run the first product corpus. | Filled measurement fields with named sources, a repeatable query/device panel, and a benchmark methodology with real results. |
| Days 31–60 | Improve pages receiving relevant impressions; resolve intent overlap; fix product failure patterns; publish one useful evidence asset and begin selective, disclosed outreach. | Better task completion, relevant non-brand clicks, documented content changes, and genuine editorial relationships. |
| Days 61–90 | Expand only the clusters that show demand and successful use. Evaluate a reviewed localization pilot and a public editor landing page once its capability brief is verified. | Evidence-backed expansion decisions, repeat-user and quality measures, and a maintained technical audit. |

If indexation is weak, diagnose access and content issues before producing more pages. If clicks arrive but conversions fail, prioritize the product. If the product works and impressions grow without clicks, inspect the query intent, result presentation, and competing offers before changing every title at once.

## Measurement without confusing the metrics

- Search Console: non-brand clicks, impressions, query/page relationships, countries, devices, and indexing observations. Average position is an aggregate; it is not a promise of a stable daily rank.
- Rank tracking: top-three share for a fixed list of queries, locations, languages, and device classes. Use the same conditions when comparing periods.
- Product: completed tasks divided by started tasks, error categories, output validity, target achievement, and processing time. A download click alone does not prove that a document is correct.
- AI discovery: citations and referenced pages where tools expose them, plus relevant referral traffic. A few manual chatbot answers are anecdotal observations, not a complete share-of-market measure.
- Commercial value: qualified repeat use and the business outcomes you actually choose to measure. No revenue or traffic projection is supplied without a baseline.

If analytics is introduced, use a reviewed setup and only the minimal event fields needed. Do not include document text, names, passwords, file contents, or download blobs in analytics events. Suggested event names are tool_start, tool_complete, tool_error, and download_click; this release does not add a third-party analytics service.

The supplied `rank-tracking-pilot.csv` contains 20 candidate queries across India, the US, and the UK, on mobile and desktop: 120 planned observation conditions with no recorded rankings. These countries are an initial English-language planning assumption, not a measured demand conclusion. Adjust the panel after validating markets.

Use `measurement-baseline.csv` to record real observations. Leave unknown values blank. Obtain the last available three months of Search Console Queries and Pages exports, then segment priority countries and devices. Add a Keyword Planner or SEO-platform export using the same country/language settings; do not mix global and country figures as if they were interchangeable.

## Run the release checks

```sh
npm ci
npm run build
npm run test:discovery
npm run seo:growth:audit
```

The optional browser check remains `npm run aeo:geo:browser` with Playwright and Chromium configured as described in README-AEO-GEO.md. The code package includes the actual validation results for this release. Local checks do not establish live deployment, current index coverage, or search rankings.

## Official guidance used

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): useful page content, clear presentation, and discovery foundations.
- [Google title links](https://developers.google.com/search/docs/appearance/title-link) and [snippets](https://developers.google.com/search/docs/appearance/snippet): descriptive titles and useful, page-specific summaries.
- [Google supported meta tags](https://developers.google.com/search/docs/crawling-indexing/special-tags): meta-keywords is not used for Google indexing or ranking.
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies): doorway pages, link abuse, and scaled content made primarily to manipulate rankings.
- [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals): field loading, responsiveness, and stability metrics. Aim for good LCP, INP, and CLS; a bundle-size check is not a field performance score.
- [Search Console performance reporting](https://support.google.com/webmasters/answer/7576553) and [metric definitions](https://support.google.com/webmasters/answer/7042828): interpreting clicks, impressions, and position.
- [Google localized pages](https://developers.google.com/search/docs/specialty/international/localized-versions): correct language-version discovery.

Additional product and technical references appear in the keyword dataset and the relevant guides. Provider claims were observed on the research date and can change.

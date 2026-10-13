# SafePDFHub — browser-only Word to PDF

This project is based on the latest uploaded src(7), scripts(7), Angular and npm configuration files. Word to PDF now runs on the user's device. No Docker, LibreOffice installation, converter endpoint or upload consent is required.

## Start on Windows

Extract this ZIP into a fresh folder. Open PowerShell in the folder containing package.json:

```powershell
npm ci
npm start
```

Open http://localhost:4200/tools/word-to-pdf. Node.js 24 is recommended. Use the included package-lock.json; npm ci installs the pinned renderer and XML parser along with existing dependencies.

## User flow

Choose DOCX → Prepare preview → Review document → Save as PDF.

The shared upload and cancellable loader are reused. The common result component is displayed as a prepared preview, with the source DOCX clearly labelled. The Save as PDF action opens the browser print dialog. Select Save as PDF, check the final page layout, use 100% scale, disable browser headers/footers and verify margins, paper size and background graphics. Mobile browsers may present a different print/share interface.

The website does not generate a downloadable PDF Blob in this mode, cannot silently save it, and cannot determine whether the user saved or cancelled. The final PDF size and page count are therefore not invented or shown as conversion results.

## Capacity and quality

The input cap remains 200 MB. A 300–500 MB browser capacity is NOT claimed: compressed DOCX size alone does not predict memory use. The worker checks central-directory limits before inflation, bounds actual streamed decompression against declared sizes, and rejects excessive expanded data, XML complexity and image pixels. Devices with unknown/limited reported memory or multiple touch points use a conservative expanded-content budget. These checks reduce risk but cannot guarantee that every accepted file completes on every device. No full 200 MB benchmark was performed.

Current bounds: expanded archive 128 MB conservative / 256 MB on qualifying reported-memory desktops; 10,000 entries; 8 MB per XML part; 24 MB XML total; 80,000 XML elements; 25 million pixels per image and 40/80 million total pixels. No explicit page-count limit. Large documents may reach these resource bounds below 200 MB.

Unencrypted DOCX is supported. Save old DOC as DOCX first. Macros, embedded objects, HTML altChunks, external linked images, unsupported image formats and damaged archives are rejected. PNG/JPEG and GIF dimensions are inspected; animated GIF fidelity is not guaranteed. Application assets, including a bundled Noto Devanagari fallback font, load from this website; document bytes are not uploaded. Missing original fonts can still change typography. The renderer is isolated in a sandboxed iframe with network-blocking content policy, and links are disabled in the preview.

DOCX rendering is not a complete implementation of Microsoft Word. Automatic pagination, fields, floating objects, equations, repeated headers on overflow pages and other advanced features can differ. Named print-page sizes preserve the tested portrait/landscape sections; actual support depends on the browser. The preview requires user review and is never labelled as an exact copy. Detection of unsupported layouts is not exhaustive.

## Deploy

Build with npm run build and deploy using your existing Angular SSR hosting setup. Remove the old WORD_TO_PDF_API_URL environment variable if configured; this version does not use it. No separate conversion service is needed. Retire any previous converter deployment separately if it is no longer used.

Keep package versions pinned and rerun document regression tests before renderer updates. The service owns renderer resource URLs and includes a small adapter for inherited Word header/footer references. These integrations depend on the pinned docx-preview version.

See release-notes/BROWSER-WORD-TO-PDF.md for validation scope.

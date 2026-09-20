import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

import { TOOLS } from './app/config/tools.config';
import { SITE_CONFIG } from './app/config/site.config';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const legacyToolRedirects = new Map<string, string>([
  ['/compress-pdf', '/tools/compress-pdf'],
  ['/merge-pdf', '/tools/merge-pdf'],
  ['/split-pdf', '/tools/split-pdf'],
  ['/protect-pdf', '/tools/protect-pdf'],
  ['/unlock-pdf', '/tools/unlock-pdf'],
  ['/remove-password', '/tools/unlock-pdf'],
  ['/pdf-to-word', '/']
]);

/**
 * Root-level crawler endpoints must be handled before the static-file and
 * Angular SSR middleware so they are returned with the correct content type.
 */
app.get('/robots.txt', (_req, res) => {
  res
    .type('text/plain')
    .set('Cache-Control', 'public, max-age=3600')
    .send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /__dev/',
      '',
      `Sitemap: ${SITE_CONFIG.url}/sitemap.xml`,
      ''
    ].join('\n'));
});

app.get('/sitemap.xml', (_req, res) => {
  const urls = [
    ...SITE_CONFIG.staticIndexablePaths,
    ...TOOLS.map(tool => `/tools/${tool.slug}`)
  ];

  const uniqueUrls = [...new Set(urls)];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...uniqueUrls.map(path => [
      '  <url>',
      `    <loc>${escapeXml(`${SITE_CONFIG.url}${path === '/' ? '' : path}`)}</loc>`,
      '  </url>'
    ].join('\n')),
    '</urlset>',
    ''
  ].join('\n');

  res
    .type('application/xml')
    .set('Cache-Control', 'public, max-age=3600')
    .send(xml);
});

/**
 * Legacy public tool URLs receive HTTP 301 redirects at the server boundary.
 * Angular routes below provide the equivalent client-side redirect after the
 * application is already loaded.
 */
app.get([...legacyToolRedirects.keys()], (req, res) => {
  const target = legacyToolRedirects.get(req.path);

  if (!target) {
    res.sendStatus(404);
    return;
  }

  res.redirect(301, target);
});

/**
 * Older internal navigation used /tool/:slug. Keep it working while the
 * canonical public URL is /tools/:slug.
 */
app.get('/tool/:slug', (req, res, next) => {
  const toolExists = TOOLS.some(tool => tool.slug === req.params['slug']);

  if (!toolExists) {
    next();
    return;
  }

  res.redirect(301, `/tools/${encodeURIComponent(req.params['slug'])}`);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Escape XML text nodes used by the generated sitemap.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import type { Request } from 'express';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

import { TOOLS } from './app/config/tools.config';
import { SITE_CONFIG } from './app/config/site.config';
import { getContactMailConfig, sendContactMessage } from './server/contact-mail';

try {
  loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // Production environments normally inject environment variables directly.
  // A missing local .env file is not an application error.
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const contactRateLimit = new Map<string, number[]>();
const CONTACT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX = 5;

app.use(express.json({ limit: '20kb' }));


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
 * First-party contact endpoint.
 *
 * Contact messages are not persisted by SafePDFHub. The endpoint validates the
 * request, applies a lightweight in-process rate limit and forwards the message
 * through the configured transactional email provider.
 */
app.post('/api/contact', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = isRecord(req.body) ? req.body : {};
  const name = cleanSingleLine(body['name']);
  const email = cleanSingleLine(body['email']);
  const subject = cleanSingleLine(body['subject']);
  const message = cleanMessage(body['message']);
  const website = cleanSingleLine(body['website']);
  const startedAt = Number(body['startedAt']);

  if (website) {
    res.status(200).json({ message: 'Your message has been sent. Thank you for contacting SafePDFHub.' });
    return;
  }

  if (!name || name.length > 100) {
    res.status(400).json({ message: 'Please enter your name.' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ message: 'Please enter a valid email address.' });
    return;
  }

  if (!subject || subject.length > 160) {
    res.status(400).json({ message: 'Please enter a valid subject.' });
    return;
  }

  if (message.length < 10 || message.length > 5000) {
    res.status(400).json({ message: 'Please provide a little more detail in your message.' });
    return;
  }

  if (!Number.isFinite(startedAt) || Date.now() - startedAt < 1200) {
    res.status(400).json({ message: 'Please take a moment to complete the form and try again.' });
    return;
  }

  const rateLimitKey = getRateLimitKey(req);
  if (!allowContactRequest(rateLimitKey)) {
    res.status(429).json({ message: 'Too many messages from this connection. Please try again later.' });
    return;
  }

  const mailConfig = getContactMailConfig(process.env);
  if (!mailConfig) {
    console.error('Contact form is not configured: missing RESEND_API_KEY, CONTACT_FROM_EMAIL or CONTACT_TO_EMAIL.');
    res.status(503).json({ message: 'Contact email is temporarily unavailable. Please email us directly instead.' });
    return;
  }

  try {
    const result = await sendContactMessage(
      { name, email, subject, message },
      mailConfig
    );

    if (!result.ok) {
      console.error('Contact email provider rejected the message.', {
        status: result.status,
        providerMessage: result.providerMessage
      });
      res.status(502).json({ message: 'We could not send your message right now. Please try again or email us directly.' });
      return;
    }

    res.status(200).json({
      message: 'Your message has been sent. Thank you for contacting SafePDFHub.'
    });
  } catch (error) {
    console.error('Contact email delivery failed.', error);
    res.status(502).json({
      message: 'We could not send your message right now. Please try again or email us directly.'
    });
  }
});

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


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanSingleLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '';
}

function cleanMessage(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function getRateLimitKey(req: Request): string {
  const trustProxy = process.env['TRUST_PROXY'] === 'true';
  if (trustProxy) {
    const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function allowContactRequest(key: string): boolean {
  const now = Date.now();
  const recent = (contactRateLimit.get(key) || []).filter(
    timestamp => now - timestamp < CONTACT_RATE_LIMIT_WINDOW_MS
  );

  if (recent.length >= CONTACT_RATE_LIMIT_MAX) {
    contactRateLimit.set(key, recent);
    return false;
  }

  recent.push(now);
  contactRateLimit.set(key, recent);

  if (contactRateLimit.size > 1000) {
    for (const [rateKey, timestamps] of contactRateLimit) {
      if (timestamps.every(timestamp => now - timestamp >= CONTACT_RATE_LIMIT_WINDOW_MS)) {
        contactRateLimit.delete(rateKey);
      }
    }
  }

  return true;
}

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

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { AngularAppEngine, createRequestHandler as createAngularRequestHandler } from '@angular/ssr';
import { getAllowedHosts, getContext, getTrustProxyHeaders } from '@netlify/angular-runtime/app-engine.js';
import { isDevMode } from '@angular/core';
import type { Request as ExpressRequest } from 'express';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

import { SITE_CONFIG } from './app/config/site.config';
import { indexingDisabled, robotsText, seoRedirect, sitemapXml } from './server/seo-http';
import { createContactResponse } from './server/contact-request';

try {
  loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // Production environments normally inject environment variables directly.
  // A missing local .env file is not an application error.
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: [new URL(SITE_CONFIG.url).hostname, `www.${new URL(SITE_CONFIG.url).hostname}`,
    ...(process.env['SSR_ALLOWED_HOSTS'] ?? '').split(',').map(host => host.trim()).filter(Boolean)]
});


app.use((req, res, next) => {
  if (indexingDisabled(process.env) || req.path === '/studio' || req.path.startsWith('/studio/') || req.path.startsWith('/api/')) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use(express.json({ limit: '20kb' }));

// Development URLs are not public application routes.
if (!isDevMode()) {
  app.use('/__dev', (_req, res) => { res.status(404).type('text/plain').send('Not found'); });
}


/**
 * First-party contact endpoint.
 *
 * Contact messages are not persisted by SafePDFHub. The endpoint validates the
 * request, applies a lightweight in-process rate limit and forwards the message
 * through the configured transactional email provider.
 */
app.post('/api/contact', async (req, res) => {
  const response = await createContactResponse(req.body, process.env, getRateLimitKey(req));
  res.status(response.status);
  response.headers.forEach((value, key) => res.set(key, value));
  res.send(await response.text());
});

/**
 * Root-level crawler endpoints must be handled before the static-file and
 * Angular SSR middleware so they are returned with the correct content type.
 */
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsText(indexingDisabled(process.env)));
});
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml());
});
app.use((req, res, next) => {
  const target = seoRedirect(req.path);
  if (target && ['GET', 'HEAD'].includes(req.method)) {
    res.redirect(301, target + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''));
    return;
  }
  next();
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    // Assets such as WASM use stable filenames: revalidate after deployments.
    maxAge: 0,
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


function getRateLimitKey(req: ExpressRequest): string {
  const trustProxy = process.env['TRUST_PROXY'] === 'true';
  if (trustProxy) {
    const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Angular/Netlify fetch handler. The adapter converts this export to an Edge Function. */
const netlifyAngularEngine = new AngularAppEngine({
  allowedHosts: getAllowedHosts(),
  trustProxyHeaders: getTrustProxyHeaders()
});

export async function netlifyAppEngineHandler(request: Request): Promise<Response> {
  const response = await handleNetlifyRequest(request);
  const path = new URL(request.url).pathname;
  if (indexingDisabled(process.env) || path === '/studio' || path.startsWith('/studio/') || path.startsWith('/api/')) {
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
}

async function handleNetlifyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === '/__dev' || pathname.startsWith('/__dev/')) return new Response('Not found', { status: 404 });
  if (pathname === '/api/contact') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 20_000) return Response.json({ message: 'Your message is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    let body: unknown;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 20_000) return Response.json({ message: 'Your message is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
      body = JSON.parse(raw);
    } catch {
      return Response.json({ message: 'Please submit a valid contact request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const context = getContext();
    return createContactResponse(body, process.env, context?.ip ?? 'unknown');
  }
  if (pathname === '/robots.txt') {
    return new Response(robotsText(indexingDisabled(process.env)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  if (pathname === '/sitemap.xml') {
    return new Response(sitemapXml(), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  const target = seoRedirect(pathname);
  if (target && ['GET', 'HEAD'].includes(request.method)) {
    const destination = new URL(target, url);
    destination.search = url.search;
    return Response.redirect(destination, 301);
  }
  const rendered = await netlifyAngularEngine.handle(request, getContext());
  return rendered ?? new Response('Not found', { status: 404 });
}

// Netlify's Angular adapter recognizes this named handler; Angular CLI uses reqHandler below.
export const netlifyRequestHandler = createAngularRequestHandler(netlifyAppEngineHandler);

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

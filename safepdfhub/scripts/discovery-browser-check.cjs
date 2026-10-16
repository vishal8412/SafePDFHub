/** UI regression checks for the public answers. Requires Playwright and a Chromium executable. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync, openSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

const root = resolve(__dirname, '..');
const out = resolve(process.env.DISCOVERY_QA_DIR || resolve(root, 'release-notes/discovery-browser'));
const slugs = [...readFileSync(resolve(root, 'src/app/config/tools.config.ts'), 'utf8').matchAll(/\bslug:\s*'([^']+)'/g)].map(match => match[1]);
const guideSlugs = [...readFileSync(resolve(root, 'src/app/config/knowledge-guides.config.ts'), 'utf8').matchAll(/\bslug:\s*'([^']+)'/g)].map(match => match[1]);
const port = process.env.DISCOVERY_QA_PORT || '4958';
const base = process.env.SEO_AUDIT_BASE_URL || `http://localhost:${port}`;
mkdirSync(out, { recursive: true });

(async () => {
  let server, browser;
  const errors = [];
  try {
    if (!process.env.SEO_AUDIT_BASE_URL) {
      server = spawn(process.execPath, ['dist/safepdfhub/server/server.mjs'], {
        cwd: root, env: { ...process.env, PORT: port, SSR_ALLOWED_HOSTS: 'localhost,127.0.0.1',
          DEPLOY_ID: 'local', DEPLOY_PRIME_URL: base, DEPLOY_URL: base, URL: base,
          SITE_ID: 'local', SITE_NAME: 'local', CONTEXT: 'production' },
        stdio: ['ignore', openSync(resolve(out, 'server.log'), 'w'), 'inherit']
      });
    }
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Production SSR server did not become available');
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(String(error)));
    const checks = [];
    for (const slug of slugs) {
      await page.goto(`${base}/tools/${slug}`, { waitUntil: 'networkidle' });
      await page.locator('.tool-overview').waitFor();
      assert.equal(await page.locator('h1').count(), 1, slug);
      assert.equal(await page.locator('.tool-facts dd').count(), 3, slug);
      assert.ok(await page.locator('input[type="file"]').count() > 0, `Upload input missing: ${slug}`);
      const faq = page.locator('.guide-faq-item').last();
      await faq.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await faq.evaluate(element => element.open), true, `FAQ keyboard open: ${slug}`);
      await page.keyboard.press('Enter');
      assert.equal(await faq.evaluate(element => element.open), false, `FAQ keyboard close: ${slug}`);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px: ${slug}`);
        if (['compress-pdf', 'word-to-pdf'].includes(slug) && [1440, 390].includes(width)) {
          await page.locator('.tool-overview').screenshot({ path: resolve(out, `${slug}-${width}.png`) });
        }
      }
      checks.push({ slug, widths: [1440, 768, 390, 320], keyboardFaq: true, uploadInput: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const link = page.locator('.guide-related a').first();
    const target = await link.getAttribute('href');
    await link.click();
    await page.waitForURL(`**${target}`);
    await page.waitForFunction(path => {
      const node = document.getElementById('safepdfhub-toolpage-jsonld');
      return node && JSON.parse(node.textContent).url === `https://safepdfhub.com${path}`;
    }, target);
    assert.equal(await page.locator('#safepdfhub-faq-jsonld').count(), 1);
    const guideChecks = [];
    await page.goto(`${base}/guides`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.hub-grid .guide-card').count(), guideSlugs.length);
    await page.locator('.hub-grid .guide-card').first().click();
    await page.waitForURL('**/guides/' + guideSlugs[0]);
    await page.locator('.knowledge-article').waitFor();
    for (const slug of guideSlugs) {
      await page.goto(`${base}/guides/${slug}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('h1').count(), 1, slug);
      assert.equal(await page.locator('#safepdfhub-guide-article-jsonld').count(), 1, slug);
      assert.equal(await page.locator('#safepdfhub-faq-jsonld').count(), 0, slug);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Guide overflow at ${width}px: ${slug}`);
      }
      guideChecks.push({ slug, widths: [1440, 768, 390, 320], articleSchema: true });
    }
    await page.goto(`${base}/guides/compress-pdf-to-target-size`, { waitUntil: 'networkidle' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('.article-header').screenshot({ path: resolve(out, `guide-header-${width}.png`) });
      await page.locator('#choose-a-target').screenshot({ path: resolve(out, `guide-table-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.primary-link').click();
    await page.waitForURL('**/tools/compress-pdf');
    await page.waitForFunction(() => !!document.getElementById('safepdfhub-toolpage-jsonld') && !document.getElementById('safepdfhub-guide-article-jsonld'));
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('.home-guide-grid > a').count(), 3);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Homepage overflow at ${width}px`);
      if ([1440, 390].includes(width)) await page.locator('.hero-copy').screenshot({ path: resolve(out, `home-hero-${width}.png`) });
    }
    await page.locator('footer a[href="/guides"]').click();
    await page.waitForURL('**/guides');
    assert.equal(await page.locator('#safepdfhub-guide-hub-jsonld').count(), 1);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Guide hub overflow at ${width}px`);
    }
    assert.deepEqual(errors, []);
    writeFileSync(resolve(out, 'checks.json'), JSON.stringify({ checks, guideChecks, guideHub: true, homepage: true, guideToToolMetadataCleanup: true, relatedNavigation: target, errors }, null, 2) + '\n');
    console.log(`PASS: ${checks.length} tool pages and ${guideChecks.length} guides at desktop, tablet, and mobile widths; keyboard FAQs; upload inputs; guide hub; navigation metadata cleanup; no page errors.`);
  } catch (error) {
    console.error(error); process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill();
  }
})();

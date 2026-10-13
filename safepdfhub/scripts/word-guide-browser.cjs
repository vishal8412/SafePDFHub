/** Visual smoke check for the PDF-to-Word guide. Requires Playwright and Chromium. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'word-guide-validation');
fs.mkdirSync(out, {recursive:true});
(async () => {
 const server = spawn('npm',['start','--','--host','127.0.0.1','--port','4936','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),'inherit']});
 let browser;
 try {
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4936',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
  browser = await chromium.launch({executablePath:process.env.WORD_BROWSER,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4936/tools/pdf-to-word');
  await page.locator('app-word-guide').waitFor();await page.locator('.app-loader').waitFor({state:'hidden'});
  assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('.path-card').count(),2);assert.equal(await page.locator('.faq-list details').count(),5);
  assert.equal(await page.locator('label.upload-btn').filter({hasText:'Choose a PDF'}).count(),1);
  const last=page.locator('.faq-list details').last();await last.locator('summary').focus();await page.keyboard.press('Enter');assert(await last.evaluate(e=>e.open));await page.keyboard.press('Enter');assert(!await last.evaluate(e=>e.open));
  for(const width of [1440,768,390,320]) {
   await page.setViewportSize({width,height:900});assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Overflow at '+width);
   // Capture in a tall viewport: this headless runtime otherwise leaves offscreen tiles blank.
   await page.setViewportSize({width,height:5000});await page.evaluate(()=>scrollTo(0,0));
   await page.locator('app-word-guide').screenshot({path:path.join(out,`width-${width}.png`)});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({oneH1:true,modeBranches:2,faqs:5,keyboardAccordion:true,uploadActionRetained:true,noOverflowWidths:[1440,768,390,320],errors},null,2));
  console.log('PASS desktop/mobile layout, keyboard FAQ, upload action, no page errors');
 } catch(e){console.error(e);process.exitCode=1;} finally {await browser?.close();server.kill();process.exit(process.exitCode||0);}
})();

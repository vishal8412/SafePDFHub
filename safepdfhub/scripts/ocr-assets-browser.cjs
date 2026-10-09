/** Regression: fresh Marathi loads, missing-model recovery, and optional user PDF. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), assert = require('assert');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'ocr-asset-validation');
fs.mkdirSync(out, { recursive: true });
(async () => {
 const server = spawn('npm', ['start','--','--host','127.0.0.1','--port','4934','--live-reload=false','--hmr=false'], {cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),'inherit']});
 let browser;
 try {
  for(let i=0;i<120;i++) { try { if((await fetch('http://127.0.0.1:4934',{signal:AbortSignal.timeout(1000)})).ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); }
  browser = await chromium.launch({executablePath:process.env.WORD_BROWSER,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({acceptDownloads:true,viewport:{width:1400,height:1000}});
  const page = await context.newPage(), errors=[], models=[];
  page.on('pageerror', e=>errors.push(String(e)));
  page.on('console', m=>{if(m.type()==='error')console.log('BROWSER',m.text());});
  page.on('response',r=>{if(r.url().includes('.traineddata.gz')) {models.push({model:r.url().split('/').pop(),status:r.status()});console.log('MODEL',r.status(),r.url());}});
  await page.goto('http://127.0.0.1:4934/tools/pdf-to-word');
  await page.waitForFunction(()=>window.ng&&ng.getComponent(document.querySelector('app-tool')));
  async function upload(file) {await page.locator('.app-loader').waitFor({state:'hidden'});await page.locator('input[type=file]').first().setInputFiles(file);await page.locator('app-word-workspace').waitFor();await page.locator('#word-ocr-language').selectOption('mar+eng');}
  async function ready() {await Promise.race([page.getByRole('heading',{name:'Your Word document is ready'}).waitFor({timeout:600000}),page.locator('app-word-workspace [role=alert]').waitFor({timeout:600000}).then(async()=>{throw Error(await page.locator('app-word-workspace [role=alert]').innerText());})]);await page.locator('.app-loader').waitFor({state:'hidden'});}
  async function result() { return page.evaluate(()=>{const r=ng.getComponent(document.querySelector('app-word-workspace')).result;return {...r,file:undefined,bytes:r.file.size};}); }
  await page.route('**/assets/ocr/lang/mar.traineddata.gz',route=>route.fulfill({status:404,body:'Missing model'}));
  await upload(path.join(root,'regression-fixtures/word/ocr-english.pdf'));
  await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'OCR language files could not be loaded'}).waitFor({timeout:90000});
  await page.locator('.app-loader').waitFor({state:'hidden'});
  console.log('Missing model: actionable error and loader dismissed');
  await page.unroute('**/assets/ocr/lang/mar.traineddata.gz');
  await page.getByRole('button',{name:'Convert to Word',exact:true}).click(); await page.locator('app-word-workspace [role=alert]').waitFor({state:'hidden'}); await ready();
  const retry=await result();assert.equal(retry.pages,1);assert(models.some(x=>x.model==='mar.traineddata.gz'&&x.status===200));
  console.log('Marathi + English retry passed',JSON.stringify(retry));
  let source;
  if(process.env.ACCURACY_PDF) {
   await upload(process.env.ACCURACY_PDF);await page.getByRole('button',{name:'Convert to Word',exact:true}).click();await ready();source=await result();
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.operation-result__primary').click()]);
   const dest=path.join(out,'source-converted.docx');await download.saveAs(dest);
   const zip=await JSZip.loadAsync(fs.readFileSync(dest));const xml=await zip.file('word/document.xml').async('string');
   source.sections=(xml.match(/<w:sectPr>/g)||[]).length;assert.equal(source.sections,source.pages);assert.equal(source.bytes,fs.statSync(dest).size);
   console.log('Actual PDF passed',JSON.stringify({...source,preservedPages:source.preservedPages.length,imagePages:source.imagePages.length,reviewPages:source.reviewPages.length}));
   await page.screenshot({path:path.join(out,'result.png')});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({missingModelHandled:true,retry,source,models,errors},null,2));console.log('ALL PASS');
 } catch(e) {console.error(e);process.exitCode=1;} finally {await browser?.close();server.kill();process.exit(process.exitCode||0);}
})();

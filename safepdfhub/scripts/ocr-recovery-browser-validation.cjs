/** Requires Playwright + Chromium outside production dependencies.
 * PLAYWRIGHT_MODULE and CHROMIUM_MODULE may point to installed packages. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'ocr-validation');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=spawn('npm',['start','--','--host','127.0.0.1','--port','4932','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(output,'server.log'),'w'),'inherit']});
 process.on('exit',()=>server.kill('SIGTERM'));
 for(let i=0;i<90;i++){try {const r=await fetch('http://127.0.0.1:4932');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 const binary = process.env.WORD_BROWSER || await require(process.env.CHROMIUM_MODULE || '@sparticuz/chromium').executablePath();
 const browser = await chromium.launch({executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[], requests=[], reports={};
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>requests.push(r.url()));
 page.on('console',msg=>{if(msg.type()==='error') console.log('BROWSER',msg.text())});
 try {
 await page.goto('http://127.0.0.1:4932/tools/pdf-to-word');
 await page.locator('input[type=file]').first().waitFor({state:'attached'});
 await page.waitForFunction(()=>window.ng && ng.getComponent(document.querySelector('app-tool')));
 async function upload(name){
  await page.locator('.app-loader').waitFor({state:'hidden'});
  await page.locator('input[type=file]').first().setInputFiles(path.join(root,'regression-fixtures/word',name));
  await page.locator('app-word-workspace').waitFor();
 }
 async function convert(name,opts={}){
  await upload(name);
  await page.getByRole('radio',{name: opts.appearance?'Keep page appearance':'Editable text'}).check();
  if(!opts.appearance){await page.locator('#word-ocr-mode').selectOption(opts.mode||'auto');if(opts.mode!=='off')await page.locator('#word-ocr-language').selectOption(opts.language||'eng');}
  const before=requests.length;
  await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
  console.log('CONVERTING',name);
  await Promise.race([page.getByRole('heading',{name:'Your Word document is ready'}).waitFor({timeout:60000}),page.locator('app-word-workspace [role=alert]').waitFor().then(async()=>{throw Error(await page.locator('app-word-workspace [role=alert]').innerText())})]);
  await page.locator('.app-loader').waitFor({state:'hidden'});
  const result=await page.evaluate(()=>{const r=ng.getComponent(document.querySelector('app-word-workspace')).result;return {...r,file:undefined,bytes:r.file.size};});
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('app-operation-result .operation-result__primary').click()]);const dest=path.join(output,(opts.appearance?'appearance-':opts.mode==='off'?'off-':'')+name.replace('.pdf','.docx'));await download.saveAs(dest);
  const zip=await JSZip.loadAsync(fs.readFileSync(dest));const xml=await zip.file('word/document.xml').async('string');
  if(fs.statSync(dest).size!==result.bytes)throw Error('Download size mismatch');
  reports[name+(opts.appearance?'-appearance':opts.mode==='off'?'-off':'')]={...result,ocrAssetRequests:requests.slice(before).filter(u=>u.includes('/ocr/')).length,sections:(xml.match(/<w:sectPr>/g)||[]).length};
  console.log('PASS',name,JSON.stringify(result));
  return {result,xml};
 }
 // Simulate a failed local OCR engine asset; the task must fail, release its loader, and retry.
 await page.route('**/assets/ocr/core/**',route=>route.abort());
 await upload('ocr-english.pdf');await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'OCR could not'}).waitFor({timeout:15000});
 await page.locator('.app-loader').waitFor({state:'hidden'});
 reports.assetFailureRecovered=true;
 await page.unroute('**/assets/ocr/core/**');
 const recovered=await convert('ocr-english.pdf');if(!recovered.result.ocrPages.length)throw Error('Retry failed');
 // Pause engine loading and cancel before initialization completes.
 await page.route('**/assets/ocr/core/**',async route=>{await new Promise(r=>setTimeout(r,2000));await route.continue().catch(()=>{});});
 await upload('ocr-english.pdf');await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
 await page.locator('.status-text').filter({hasText:/Preparing OCR|Loading OCR/}).waitFor();
 const cancelledAt=Date.now();await page.locator('.loader-cancel-button').click();
 await page.getByRole('alert').filter({hasText:'cancelled'}).waitFor({timeout:5000});
 await page.locator('.app-loader').waitFor({state:'hidden'});reports.cancelDuringOcrMs=Date.now()-cancelledAt;
 await page.unroute('**/assets/ocr/core/**');
 // No artificial page cap even on the conservative device profile.
 await page.evaluate(()=>{ng.getComponent(document.querySelector('app-word-workspace')).engine.capability.current.formFactor='mobile';});
 const many=await convert('ocr-many-pages.pdf');if(many.result.pages!==350)throw Error('Mobile page cap');
 await upload('ocr-english.pdf');await page.setViewportSize({width:390,height:1000});
 const mobile=await convert('ocr-english.pdf');if(!mobile.result.ocrPages.length)throw Error('Mobile OCR failed');
 // Exact 200 MB admission and rejection beyond it, without allocating a large JS byte array.
 const boundaries=await page.evaluate(async()=>{
  const c=ng.getComponent(document.querySelector('app-tool'));
  const small=ng.getComponent(document.querySelector('app-word-workspace')).file;
  const exact=new File([small,new Blob([new Uint8Array(200000000-small.size)])],'boundary.pdf',{type:'application/pdf'});
  const over=new File([exact,'x'],'over.pdf',{type:'application/pdf'});
  return {exactAccepted:c.validateFiles([exact]).length===1,overRejected:c.validateFiles([over]).length===0};
 });
 if(!boundaries.exactAccepted||!boundaries.overRejected)throw Error('Boundary validation wrong');
 reports.boundaries=boundaries;
 reports.mobileNoOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);reports.errors=errors;
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(path.join(output,'recovery.json'),JSON.stringify(reports,null,2));console.log('ALL PASS');
 }catch(e){await page.screenshot({path:path.join(output,'failure.png')});console.error(e);console.log(await page.locator('body').innerText());process.exitCode=1;}
 finally{await browser.close();server.kill('SIGTERM');process.exit(process.exitCode||0);}
})();

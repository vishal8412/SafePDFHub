const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out=path.join(root,'word-to-pdf-validation');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const api=spawn(process.execPath,['services/word-to-pdf/server.mjs'],{cwd:root,env:{...process.env,PORT:'8080',ALLOWED_ORIGINS:'http://127.0.0.1:4937'},stdio:['ignore',fs.openSync(path.join(out,'api.log'),'w'),'inherit']});
 const web=spawn('npm',['start','--','--host','127.0.0.1','--port','4937','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'web.log'),'w'),'inherit']});
 let browser;
 try{
  for(const url of ['http://127.0.0.1:8080/health','http://127.0.0.1:4937']){let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}assert(ready,'Service not ready: '+url);}
  async function idle(){for(let i=0;i<100;i++){if(!(await (await fetch('http://127.0.0.1:8080/health')).json()).busy)return;await new Promise(r=>setTimeout(r,20));}throw Error('Service did not finish cleanup');}
  const apiChecks={};for(const name of ['corrupt','external','macro']){const r=await fetch('http://127.0.0.1:8080/convert/docx',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:fs.readFileSync(path.join(root,'regression-fixtures/word-to-pdf',name+'.docx'))});assert.equal(r.status,422);apiChecks[name]=await r.json();await idle();}
  const denied=await fetch('http://127.0.0.1:8080/health',{headers:{Origin:'https://unapproved.example'}});assert.equal(denied.status,403);
  browser=await chromium.launch({executablePath:process.env.WORD_BROWSER,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('PAGEERROR',String(e));});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});let uploads=0,downloads=0;page.on('request',r=>{if(r.url().endsWith('/convert/docx'))uploads++;});page.on('download',()=>downloads++);
  await page.goto('http://127.0.0.1:4937');await page.getByRole('heading',{name:'Word to PDF',exact:true}).waitFor();
  await page.goto('http://127.0.0.1:4937/tools/word-to-pdf');await page.waitForFunction(()=>window.ng&&ng.getComponent(document.querySelector('app-tool')));
  await page.locator('input[type=file]').first().setInputFiles(path.join(root,'regression-fixtures/word-to-pdf/layout.docx'));await page.locator('.service-host').waitFor({timeout:20000});
  const button=page.getByRole('button',{name:'Convert to PDF',exact:true});assert(await button.isDisabled());assert.equal(uploads,0);assert.equal(downloads,0);
  await page.getByRole('checkbox').check();await button.click();
  await Promise.race([page.getByRole('heading',{name:'Your PDF is ready',exact:true}).waitFor({timeout:120000}),page.getByRole('alert').waitFor({timeout:120000}).then(async()=>{throw Error(await page.getByRole('alert').innerText());})]);
  await page.locator('.app-loader').waitFor({state:'hidden'});assert.equal(downloads,0);
  const result=await page.evaluate(()=>{const r=ng.getComponent(document.querySelector('app-word-to-pdf-workspace')).result;return {pages:r.pages,bytes:r.file.size,durationMs:r.durationMs,name:r.file.name};});assert.equal(result.pages,3);
  fs.writeFileSync(path.join(out,'memory-result.pdf'),Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await ng.getComponent(document.querySelector('app-word-to-pdf-workspace')).result.file.arrayBuffer())))));console.log('RESULT',JSON.stringify(result));
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator('.operation-result__primary').click()]);await d.saveAs(path.join(out,'layout.pdf'));assert.equal(fs.statSync(path.join(out,'layout.pdf')).size,result.bytes);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));await page.screenshot({animations:'disabled',path:path.join(out,`result-${width}.png`),fullPage:true});}
  // Consent resets when replacing the source; an unavailable service gives retry UI.
  await page.route('**/health',r=>r.fulfill({status:503,contentType:'application/json',body:'{"ready":false}'}));
  await page.locator('input[type=file]').first().setInputFiles(path.join(root,'regression-fixtures/word-to-pdf/layout.docx'));await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Convert to PDF',exact:true}).isDisabled());assert(!await page.getByRole('checkbox').isChecked());
  await page.unroute('**/health');await page.getByRole('button',{name:'Check again'}).click();await page.locator('.service-host').waitFor();
  // Hold a real browser request to verify cancellation releases the shared loader.
  await page.route('**/convert/docx',async route=>{await new Promise(r=>setTimeout(r,1500));try{await route.abort();}catch{}});
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Convert to PDF',exact:true}).click();await page.getByRole('button',{name:'Cancel current operation'}).click();await page.getByRole('alert').filter({hasText:'Conversion cancelled'}).waitFor();await page.locator('.app-loader').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({apiChecks,originRejected:true,result,noAutomaticUpload:true,noAutomaticDownload:true,consentReset:true,serviceRetry:true,cancellation:true,mobileWidths:[390,320],errors},null,2));console.log('ALL PASS',JSON.stringify(result));
 }catch(e){console.error(e);process.exitCode=1;}finally{await browser?.close();web.kill();api.kill();process.exit(process.exitCode||0);}
})();

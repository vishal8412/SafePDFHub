/** STUDIO_LARGE_PDF=/path/document.pdf PLAYWRIGHT_MODULE=playwright CHROMIUM_EXECUTABLE=/path/chromium node scripts/studio-formatting-regression.cjs */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.STUDIO_RESULTS_DIR||path.join(root,'benchmark-results/formatting'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),fs.openSync(path.join(out,'server.log'),'a')]});
 let browser;
 try {
  let ready=false;for(let n=0;n<180;n++){try{if((await fetch('http://127.0.0.1:4930')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1900,height:1100},acceptDownloads:true});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4930/studio');
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(path.resolve(process.env.STUDIO_LARGE_PDF));
  await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.hasDocument());
  await page.getByRole('button',{name:'Edit PDF',exact:true}).click();
  const result=page.locator('.studio-export-result');
  let downloads=0;page.on('download',()=>downloads++);
  const prepare=async()=>{await page.getByRole('button',{name:'Export PDF',exact:true}).click();await result.waitFor({state:'visible',timeout:180000});await page.locator('.app-loader').waitFor({state:'hidden'});};
  const read=()=>page.evaluate(()=>{const f=ng.getComponent(document.querySelector('app-studio-canvas')).facade,r=f.exportResult();return {size:r.file.size,duration:r.durationMs,name:r.file.name,pages:r.pageCount}});
  const save=async name=>{const d=page.waitForEvent('download');await result.locator('.operation-result__primary').click();await(await d).saveAs(path.join(out,name+'.pdf'))};
  const back=async()=>{await page.getByRole('button',{name:'Continue editing',exact:true}).click();await result.waitFor({state:'hidden'});await page.getByRole('button',{name:'Export PDF',exact:true}).waitFor({state:'visible'})};
  await prepare();assert.equal(downloads,0,'Export must prepare a result without downloading');
  const unchanged=await read();assert.equal(unchanged.pages,842);assert.equal(unchanged.size,fs.statSync(process.env.STUDIO_LARGE_PDF).size);
  await page.screenshot({path:path.join(out,'result-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'result-mobile.png'),fullPage:true});
  assert(await result.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'result must fit mobile width');
  await page.setViewportSize({width:1900,height:1100});
  await save('unchanged');await save('unchanged-again');assert.equal(downloads,2);
  await back();assert(await page.getByRole('button',{name:'Export PDF',exact:true}).isVisible());
  // Instrument serialization, then add a visible annotation.
  await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas')),f=c.facade,s=f.pdfExportService;
    window.exportCalls=0;window.realExport=s.exportTextObjects.bind(s);s.exportTextObjects=(...args)=>{window.exportCalls++;return window.realExport(...args)};
    f.createDrawingObject([{x:.1,y:.08},{x:.7,y:.08}],{strokeColor:'#ff0000',strokeWidth:.004,opacity:1},'draw');});
  await prepare();const edited=await read();assert.equal(await page.evaluate(()=>window.exportCalls),1);await save('edited');
  await back();await prepare();const cached=await read();assert.equal(await page.evaluate(()=>window.exportCalls),1,'repeat Export must reuse prepared PDF');
  await save('cached');await back();
  await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));const o=c.objectService.snapshot().find(o=>o.drawing);c.facade.updateDrawingStyle(o.id,{strokeColor:'#0000ff'});});
  await prepare();assert.equal(await page.evaluate(()=>window.exportCalls),2,'editing invalidates prepared bytes');await save('changed');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open another PDF',exact:true}).click();
  await(await chooser).setFiles(path.join(root,'regression-fixtures/studio/text-table.pdf'));
  await result.waitFor({state:'hidden'});await page.waitForFunction(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.pageCount()===1);
  await prepare();const replaced=await read();assert.equal(replaced.pages,1);assert(replaced.name.includes('text-table'));
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,unchanged,edited,cached,replaced,downloads,browserErrors:errors},null,2));console.log('EXPORT RESULT AND CACHE PASSED');
 }finally{await browser?.close();server.kill('SIGKILL')}
})().catch(e=>{console.error(e);process.exitCode=1});

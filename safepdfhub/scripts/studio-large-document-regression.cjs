/** Generate the fixture with studio-large-fixture.py, then set STUDIO_LARGE_PDF. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'benchmark-results/large-document');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),fs.openSync(path.join(out,'server.log'),'a')]});
 let browser;
 try {
  let ready=false;for(let i=0;i<180;i++){try{if((await fetch('http://127.0.0.1:4930')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1900,height:1100},acceptDownloads:true});page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4930/studio');
  const started=Date.now();
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(path.resolve(process.env.STUDIO_LARGE_PDF));
  await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.hasDocument());
  await page.locator('.app-loader').waitFor({state:'hidden'});
  await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return c.canvasRef?.nativeElement.width>0 && c.activeRenderVersion===null});
  const openMs=Date.now()-started;
  const initial=await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return {pages:c.facade.pageCount(),bytes:c.facade.document().file.size,analyzed:c.facade.contentAnalysisState()?.analyzedPages,sidebarNodes:document.querySelectorAll('.sidebar__page-item').length}});
  assert.equal(initial.pages,18639);assert(initial.bytes>375*1024*1024);assert.equal(initial.analyzed,0);assert(initial.sidebarNodes<30);
  const nav=[];
  for(const n of [1000,18639,1]) {
   const start=Date.now();await page.evaluate(n=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(n),n);
   await page.locator(`.sidebar__page-item[data-page-number="${n}"]`).waitFor();
   await page.waitForTimeout(100);
   await page.waitForFunction(()=>ng.getComponent(document.querySelector('app-studio-canvas')).activeRenderVersion===null);
   nav.push({page:n,ms:Date.now()-start});
  }
  // Scrolling away from current page must not snap back due to recycled views.
  await page.locator('.sidebar__pages-list').evaluate(el=>{el.scrollTop=50000;el.dispatchEvent(new Event('scroll'))});
  await page.waitForTimeout(200);
  assert((await page.locator('.sidebar__pages-list').evaluate(el=>el.scrollTop))>49000);
  const modes=[];
  for (const mode of ['compact','grid','comfortable']) {
   await page.evaluate(mode=>{const w=ng.getComponent(document.querySelector('app-studio-workspace'));w.setSidebarPageView(mode);w.facade.goToPage(18000)},mode);
   await page.locator('.sidebar__page-item[data-page-number="18000"]').waitFor();
   modes.push({mode,nodes:await page.locator('.sidebar__page-item').count()});assert(modes.at(-1).nodes<40);
  }
  await page.evaluate(()=>{const w=ng.getComponent(document.querySelector('app-studio-workspace'));w.onPageThumbnailSelected({pageNumber:1,originalEvent:new MouseEvent('click',{ctrlKey:true})});w.onPageThumbnailSelected({pageNumber:18000,originalEvent:new MouseEvent('click',{ctrlKey:true})});w.toggleOrganizeFocusMode()});
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-workspace')).selectedPageNumbers()),[1,18000]);
  assert((await page.locator('.sidebar__page-item').count())<150);
  await page.waitForFunction(()=>{
    const el=document.querySelector('.sidebar__page-item[data-page-number="18000"]');
    if(!el)return false; const r=el.getBoundingClientRect(),v=document.querySelector('.sidebar__pages-list').getBoundingClientRect();
    return r.top>=v.top-1 && r.bottom<=v.bottom+1;
  });
  await page.screenshot({path:path.join(out,'organizer.png')});
  await page.evaluate(()=>{const w=ng.getComponent(document.querySelector('app-studio-workspace'));w.exitOrganizeFocusMode();w.clearPageSelection();w.facade.goToPage(1)});
  await page.waitForTimeout(150);
  // Rapid navigation and zoom, then a normal render, must all settle.
  await page.evaluate(()=>{const f=ng.getComponent(document.querySelector('app-studio-canvas')).facade;for(let i=0;i<15;i++){f.goToPage(i+1);f.setZoom(90+i)}f.goToPage(1);f.fitPage()});
  await page.waitForTimeout(250);
  await page.waitForFunction(()=>ng.getComponent(document.querySelector('app-studio-canvas')).activeRenderVersion===null);
  // Long task observation excludes initial upload and explicit final export.
  await page.evaluate(()=>{window.longTasks=[];window.observer=new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration)));window.observer.observe({type:'longtask',buffered:false})});
  const editingStart=Date.now();await page.getByRole('button',{name:'Edit PDF',exact:true}).click();
  await page.waitForFunction(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.listForPage(1).some(o=>o.pdfText),null,{timeout:180000});
  const firstEditReadyMs=Date.now()-editingStart;
  const text=await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.listForPage(1).find(o=>o.pdfText));
  await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).beginTextEditing(id),text.id);
  const editor=page.getByRole('textbox',{name:'Edit PDF text',exact:true});await editor.fill('Updated large document text');
  const editStart=Date.now();await page.getByRole('button',{name:'Finish text edit',exact:true}).click();
  await page.waitForTimeout(150);await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return !c.previewBusy()&&(c.committedPreview()||c.previewError())});
  assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewError()),'');
  const editPreviewMs=Date.now()-editStart;
  const longTasks=await page.evaluate(()=>{window.observer.disconnect();return window.longTasks});
  await page.screenshot({path:path.join(out,'editing.png')});
  // Watermark the actual >100 MB file through the shared engine; no mocked size.
  const watermark=await page.evaluate(async()=>{const f=ng.getComponent(document.querySelector('app-studio-canvas')).facade;const start=performance.now();const r=await f.pdfWatermark.apply(f.document().file,{kind:'text',text:'CONFIDENTIAL',opacity:.3,rotation:0,position:'center',pageSelection:{mode:'all'},tiled:false,fontSize:24,font:'Helvetica',color:'#000000',imageScalePercent:30});window.watermarked=r.file;return {bytes:r.file.size,pages:r.pageCount,marked:r.watermarkedPageCount,ms:performance.now()-start}});
  assert.equal(watermark.pages,18639);assert.equal(watermark.marked,18639);
  const combined=await page.evaluate(async()=>{
    const f=ng.getComponent(document.querySelector('app-studio-canvas')).facade;
    f.rotateCurrentPage('right');
    f.createDrawingObject([{x:.1,y:.2},{x:.7,y:.2}],{strokeColor:'#ff0000',strokeWidth:.003,opacity:1},'draw');
    f.commitWatermark({kind:'text',text:'CONFIDENTIAL',opacity:.3,rotation:0,position:'center',pageSelection:{mode:'all'},tiled:false,fontSize:24,font:'Helvetica',color:'#000000',imageScalePercent:30});
    await f.exportPdf();
    const result=f.exportResult();
    return result ? {bytes:result.file.size,pages:result.pageCount,ms:result.durationMs} : null;
  });
  assert(combined,'Combined Studio export must succeed');assert.equal(combined.pages,18639);
  await page.locator('.app-loader').waitFor({state:'hidden'});
  await page.locator('.studio-export-result').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'combined-export.png')});
  const outputCheck=await page.evaluate(async()=>{
    const f=ng.getComponent(document.querySelector('app-studio-canvas')).facade;
    const doc=await f.pdfEngine.loadFile(f.exportResult().file);
    try {
      const first=await doc.pdf.getPage(1),last=await doc.pdf.getPage(doc.pageCount);
      const text=(await first.getTextContent()).items.map(i=>i.str||'').join(' ');
      const lastText=(await last.getTextContent()).items.map(i=>i.str||'').join(' ');
      return {pageCount:doc.pageCount,rotation:first.rotate,edited:text.includes('Updated large document text'),firstMarked:text.includes('CONFIDENTIAL'),lastMarked:lastText.includes('CONFIDENTIAL')};
    } finally {await f.pdfEngine.destroy(doc)}
  });
  assert.deepEqual(outputCheck,{pageCount:18639,rotation:90,edited:true,firstMarked:true,lastMarked:true});

  assert.deepEqual(errors,[]);
  const result={passed:true,synthetic:true,initial,openMs,nav,modes,firstEditReadyMs,editPreviewMs,longTasks,watermark,combined,outputCheck,browserErrors:errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {await browser?.close();server.kill('SIGKILL')}
})().catch(e=>{console.error(e);process.exitCode=1});

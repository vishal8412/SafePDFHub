/** STUDIO_RESUME_PDF=/path/resume.pdf node scripts/studio-editing-space-regression.cjs
 * Uses Playwright; optional PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.STUDIO_RESULTS_DIR||path.join(root,'benchmark-results/editing-space'));
fs.mkdirSync(out,{recursive:true});
assert(process.env.STUDIO_RESUME_PDF,'Set STUDIO_RESUME_PDF');
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),fs.openSync(path.join(out,'server.log'),'a')]});
 let browser;
 try{
  let ready=false;for(let n=0;n<180;n++){try{if((await fetch('http://127.0.0.1:4930')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
  page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4930/studio');
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(path.resolve(process.env.STUDIO_RESUME_PDF));
  await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.hasDocument());
  await page.getByRole('button',{name:'Edit PDF',exact:true}).click();
  await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return c.facade.contentAnalysisState()?.pages[1]});
  const object=await page.evaluate(async()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));await c.facade.ensureCurrentPageContent();return c.objectService.listForPage(1).find(o=>o.text==='Peppermint')});assert(object,'resume heading missing');
  // Opening an already indexed target must not wait for a pending canvas render.
  const opening=await page.evaluate(id=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));const render=c.currentRender;c.currentRender=new Promise(()=>{});const start=performance.now();c.beginTextEditing(id);const result={id:c.editingObjectId,ms:performance.now()-start};c.currentRender=render;return result},object.id);
  assert.equal(opening.id,object.id);
  const editor=page.getByRole('textbox',{name:'Edit PDF text',exact:true});
  await editor.fill('Vishal Suryawanshi');
  assert.equal(await page.getByRole('textbox',{name:'Text content',exact:true}).inputValue(),'Vishal Suryawanshi');
  assert(await page.getByRole('textbox',{name:'Text content',exact:true}).evaluate(el=>el.readOnly));
  const originalBounds=object.bounds;
  const before=await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewGeneration);
  await page.waitForTimeout(150);
  await editor.press('End');await editor.type(' — Software Engineer');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewGeneration),before,'typing must not export');
  const width=page.getByRole('spinbutton',{name:'W',exact:true});await width.fill(String(230/object.pdfText.pageWidthPdf*100));await width.press('Tab');
  await page.waitForFunction(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id).bounds.width>.3,object.id);
  assert.equal(await editor.inputValue(),'Vishal Suryawanshi — Software Engineer');
  // The resize handles must also work without leaving Edit PDF mode.
  const handle=page.locator('.studio-selection-box__handle--se');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+12,{steps:5});await page.mouse.up();
  await page.waitForTimeout(200);
  const resized=await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id),object.id);
  const renderState=await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));const canvas=document.querySelector('.studio-canvas__pdf');const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<200&&pixels[i+3]>0)count++;return {active:c.activeRenderVersion,dark:count,covers:[...document.querySelectorAll('.studio-pdf-text-source-cover')].map(el=>el.getBoundingClientRect().toJSON())}});
  fs.writeFileSync(path.join(out,'resize-debug.json'),JSON.stringify({resized,originalBounds,box,renderState,errors},null,2));
  await page.screenshot({path:path.join(out,'resize-debug.png'),fullPage:true});
  assert(resized.bounds.width>230/resized.pdfText.pageWidthPdf);assert(resized.bounds.height>originalBounds.height);
  assert.deepEqual(resized.pdfText.sourceBounds,originalBounds);
  assert.equal(await editor.inputValue(),'Vishal Suryawanshi — Software Engineer');
  assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy()),false,'editing must not trigger background exports');
  await page.getByRole('button',{name:'Finish text edit',exact:true}).click();
  const preview=async()=>{await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return !c.previewBusy()&&!!c.committedPreview()},null,{timeout:120000});assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewError()),'')};
  await preview();await page.screenshot({path:path.join(out,'resized-heading.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PDF',exact:true}).click();await(await download).saveAs(path.join(out,'resized-resume.pdf'));
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(1));await preview();
  assert.deepEqual(await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id).bounds,object.id),resized.bounds);
  // Undo text, then pointer resize, then numeric resize; source region stays stable.
  for(let n=0;n<3;n++)assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()));
  assert.deepEqual(await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id).bounds,object.id),originalBounds);
  for(let n=0;n<3;n++)assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.redo()));await preview();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,opening,originalBounds,resizedBounds:resized.bounds,browserErrors:errors},null,2));
  console.log('EDITING SPACE PASSED',JSON.stringify(opening));
 }finally{await browser?.close();server.kill('SIGKILL')}
})().catch(error=>{console.error(error);process.exitCode=1});

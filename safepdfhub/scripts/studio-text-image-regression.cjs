/** npm install --no-save playwright; npx playwright install chromium
 * STUDIO_RESUME_PDF=/path/resume.pdf STUDIO_LARGE_PDF=/path/large.pdf node scripts/studio-text-image-regression.cjs
 * Optional PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, STUDIO_RESULTS_DIR. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.STUDIO_RESULTS_DIR||path.join(root,'benchmark-results/studio-fixes'));
fs.mkdirSync(out,{recursive:true});
const samples=[['resume',process.env.STUDIO_RESUME_PDF],['large',process.env.STUDIO_LARGE_PDF]]
 .filter(([name])=>!process.env.STUDIO_SAMPLE||name===process.env.STUDIO_SAMPLE);
for(const [name,file] of samples) assert(file&&fs.existsSync(file),`Missing ${name} input`);
const canvas=()=>ng.getComponent(document.querySelector('app-studio-canvas'));
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),fs.openSync(path.join(out,'server.log'),'a')]});
 let browser;
 try {
  let ready=false;for(let n=0;n<180;n++){try{if((await fetch('http://127.0.0.1:4930')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready,'dev server did not start');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
  page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=async()=>page.evaluate(async()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));await c.facade.ensureCurrentPageContent();return c.objectService.listForPage(c.facade.currentPage())});
  const preview=async()=>{await page.waitForTimeout(350);await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return !c.previewBusy()&&(c.committedPreview()||c.previewError())},null,{timeout:120000});assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewError()),'');};
  const edit=async(object,text)=>{await page.getByRole('button',{name:'Edit PDF Text',exact:true}).click();await page.locator(`[data-object-id="${object.id}"]`).click();await page.getByRole('textbox',{name:'Edit PDF text',exact:true}).fill(text);await page.getByRole('button',{name:'Finish text edit',exact:true}).click();await preview();};
  const exportPdf=async(name)=>{const download=page.waitForEvent('download',{timeout:180000});await page.getByRole('button',{name:'Export PDF',exact:true}).click();await(await download).saveAs(path.join(out,name+'.pdf'));};
  for(const [name,file] of samples){
   await page.goto('http://127.0.0.1:4930/studio');
   await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(path.resolve(file));
   await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.hasDocument());
   const objects=await state();fs.writeFileSync(path.join(out,name+'-objects.json'),JSON.stringify(objects,null,2));
   if(name==='resume'){
    const title=objects.find(o=>o.text==='Vishal Suryawanshi');assert.equal(title.pdfText.textColor,'#6677ad');
    const para=objects.find(o=>o.text?.startsWith('Thermax is'));assert.equal(para.pdfText.sourceLines.length,4,'paragraph crossed by other-column rows');
    await edit(title,'Vishal Test');
    await edit(objects.find(o=>o.text?.startsWith('vish.suryawanshi@')),'edited@example.com');
    await edit(para,'Studio replacement text remains visible. Unicode check: Ω.');
    await page.screenshot({path:path.join(out,'resume-text.png'),fullPage:true});
    await exportPdf('resume-text');
    // Undo and redo committed text, then test replacement history.
    assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()));
    assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.redo()));await preview();
   }else{
    const para=objects.find(o=>o.text?.startsWith('Donec tempor'));assert(para.pdfText.sourceLines.length>=4);
    await edit(para,'SafePDFHub large document replacement remains visible. '+para.text);
    await exportPdf('large-text');
   }
   const image=objects.filter(o=>o.pdfImage).sort((a,b)=>b.bounds.width*b.bounds.height-a.bounds.width*a.bounds.height)[0];assert(image,'source image missing');
   await page.getByRole('button',{name:'Edit PDF Image',exact:true}).click();
   const chooser=page.waitForEvent('filechooser');await page.locator(`[data-object-id="${image.id}"]`).click({position:{x:5,y:5}});await(await chooser).setFiles(path.join(root,'regression-fixtures/studio/oriented.jpg'));await preview();
   const replaced=(await state()).find(o=>o.id===image.id);assert.equal(replaced.image.naturalWidth,160);assert.equal(replaced.image.naturalHeight,320);
   for(const mode of ['fill','stretch','fit']){await page.evaluate(({id,mode})=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.updatePdfImageFitMode(id,mode),{id:image.id,mode});await preview();}
   if(name==='resume') {
    // The inspector must share orientation/validation and commit one undo step.
    await page.locator('app-studio-right-sidebar').getByRole('button',{name:'Selection',exact:true}).click();
    await page.locator('app-studio-right-sidebar input[type=file][accept="image/png,image/jpeg"]').setInputFiles(path.join(root,'regression-fixtures/studio/replacement.png'));
    await page.waitForFunction(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id)?.image?.mimeType==='image/png',image.id);
    await preview();
    assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()));await preview();
    assert.equal((await state()).find(o=>o.id===image.id).image.mimeType,'image/jpeg','inspector replacement needs only one undo');
    console.log('INSPECTOR UNDO PASSED');
    await page.getByRole('button',{name:'Select',exact:true}).click();
    await page.locator(`[data-object-id="${image.id}"]`).click({position:{x:10,y:10}});
    const box=await page.locator('.studio-selection-box').boundingBox();assert(box);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+12,{steps:5});await page.mouse.up();await preview();
    const moved=(await state()).find(o=>o.id===image.id);assert(moved.bounds.x>image.bounds.x);
    assert.deepEqual(moved.pdfImage.sourceBounds,image.pdfImage.sourceBounds);
    await exportPdf('resume-moved-image');
    assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()));await preview();
   }
   await page.screenshot({path:path.join(out,name+'-image.png'),fullPage:true});await exportPdf(name+'-image');
   await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.restoreOriginalPdfImage(id),image.id);await preview();
   assert.equal((await state()).find(o=>o.id===image.id).pdfImage.replaced,false);
   assert(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()));await preview();
   assert.equal((await state()).find(o=>o.id===image.id).pdfImage.replaced,true);
   if(name==='resume'){
    await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));
    const second=await state();const text=second.find(o=>o.pdfText&&o.text.length>12);assert(text);await edit(text,'Second page editing works.');await exportPdf('resume-two-pages');
   }
   console.log(name.toUpperCase(),'PASSED');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,samples:samples.map(s=>s[0]),browserErrors:errors},null,2));
 }finally{await browser?.close();server.kill('SIGKILL');}
})().catch(e=>{console.error(e);process.exitCode=1});

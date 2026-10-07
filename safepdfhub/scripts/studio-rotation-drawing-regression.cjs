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
  const preview=async()=>{await page.waitForTimeout(500);await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return !c.previewBusy()&&(c.committedPreview()||c.previewError())},null,{timeout:120000});assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewError()),'')};
  const objects=()=>page.evaluate(async()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));await c.facade.ensureCurrentPageContent();return c.objectService.listForPage(1)});
  const initial=await objects(),original=initial.filter(o=>o.pdfText&&o.text.length>200)[0];assert(original);
  await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).beginTextEditing(id),original.id);
  const editor=page.getByRole('textbox',{name:'Edit PDF text',exact:true});await editor.waitFor();
  const before=await editor.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const size=page.getByRole('spinbutton',{name:'Text size',exact:true});await size.fill('20');await size.press('Tab');await page.waitForTimeout(300);
  const after=await editor.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert(after>before*1.5,JSON.stringify({before,after}));
  assert.equal((await objects()).find(o=>o.id===original.id).pdfText.fitMode,'original');
  await page.getByRole('button',{name:'Cancel text edit',exact:true}).click();
  const im=initial.filter(o=>o.pdfImage).sort((a,b)=>b.bounds.width*b.bounds.height-a.bounds.width*a.bounds.height)[0];assert(im);
  const chooser=page.waitForEvent('filechooser');await page.locator(`[data-object-id="${im.id}"]`).click({position:{x:5,y:5}});await(await chooser).setFiles(path.join(root,'regression-fixtures/studio/replacement.png'));await preview();
  const exportPdf=async name=>{const download=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Export PDF',exact:true}).click();await(await download).saveAs(path.join(out,name+'.pdf'));await page.locator('.app-loader').waitFor({state:'hidden'})};
  await exportPdf('image-0');
  for(const angle of [90,180,270,360]){
    await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.rotateCurrentPage('right'));
    await page.waitForTimeout(500);const current=(await objects()).find(o=>o.id===im.id);await preview();
    const b=im.bounds,r=current.bounds;
    const expected=angle===90?{x:1-b.y-b.height,y:b.x,width:b.height,height:b.width}:angle===180?{x:1-b.x-b.width,y:1-b.y-b.height,width:b.width,height:b.height}:angle===270?{x:b.y,y:1-b.x-b.width,width:b.height,height:b.width}:b;
    for(const k of ['x','y','width','height'])assert(Math.abs(r[k]-expected[k])<.00001,JSON.stringify({angle,r,expected}));
    await exportPdf('image-'+angle);await page.screenshot({path:path.join(out,'rotation-'+angle+'.png')});
  }
  // Add paths with very different aspect ratios and every shape type.
  const ids=await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas')),f=c.facade;
    const d=f.createDrawingObject([{x:.1,y:.08},{x:.5,y:.08},{x:.5,y:.13}],{strokeColor:'#ff0000',strokeWidth:.004,opacity:1},'draw');
    const h=f.createDrawingObject(Array.from({length:51},(_,i)=>({x:.1+i*.006,y:.16})),{strokeColor:'#00ff00',strokeWidth:.015,opacity:.3},'highlight');
    ['rectangle','ellipse','line','arrow'].forEach((kind,i)=>f.createShapeObject(.1+i*.2,.8,.25+i*.2,.9,kind,{strokeColor:'#0000ff',fillColor:null,strokeWidth:.004,opacity:.6}));
    return [d.objectId,h.objectId];});
  await page.waitForTimeout(300);
  for(const id of ids){const el=page.locator(`[data-object-id="${id}"] polyline`);assert.equal(await el.getAttribute('vector-effect'),'non-scaling-stroke');assert(await el.evaluate(el=>el.parentElement.getBoundingClientRect().height)>0,'straight stroke SVG must not collapse');assert.equal(await el.evaluate(el=>getComputedStyle(el.parentElement).overflow),'visible');}
  await exportPdf('annotations');await page.screenshot({path:path.join(out,'annotations.png'),fullPage:true});
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.rotateCurrentPage('right'));
  await objects();await preview();await exportPdf('annotations-90');
  await page.screenshot({path:path.join(out,'annotations-90.png'),fullPage:true});
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo());await objects();await preview();await exportPdf('annotations-undo');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,before,after,browserErrors:errors},null,2));console.log('ROTATION AND ANNOTATIONS PASSED');
 }finally{await browser?.close();server.kill('SIGKILL')}
})().catch(e=>{console.error(e);process.exitCode=1});

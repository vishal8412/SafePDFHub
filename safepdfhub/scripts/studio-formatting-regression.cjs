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
  const original=await page.evaluate(async()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));await c.facade.ensureCurrentPageContent();return c.objectService.listForPage(1).filter(o=>o.pdfText&&o.text.length>200).sort((a,b)=>a.bounds.y-b.bounds.y)[0]});assert(original);
  const editor=page.getByRole('textbox',{name:'Edit PDF text',exact:true});
  const open=async()=>{await page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).beginTextEditing(id),original.id);await editor.waitFor();await page.waitForTimeout(250)};
  const obj=()=>page.evaluate(id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id),original.id);
  const preview=async()=>{await page.waitForTimeout(300);await page.waitForFunction(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));return !c.previewBusy()&&(c.committedPreview()||c.previewError())},null,{timeout:120000});assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).previewError()),'')};
  const covers=async()=>{await page.waitForTimeout(150);const r=await page.evaluate(()=>{const a=document.querySelector('.studio-text-editor').getBoundingClientRect(),b=document.querySelector('.studio-selection-box').getBoundingClientRect();return {editor:a.toJSON(),selection:b.toJSON()}});assert(r.selection.bottom>=r.editor.bottom-2,JSON.stringify(r));assert(r.selection.right>=r.editor.right-2);return r};
  await open();await covers();
  assert.equal(await page.getByRole('spinbutton',{name:'Text area width',exact:true}).count(),0);
  const size=page.getByRole('spinbutton',{name:'Text size',exact:true});assert(await size.isEnabled());
  const bold=page.getByRole('button',{name:'Bold',exact:true});assert(await bold.isEnabled());
  await bold.click();await page.getByRole('button',{name:'Italic',exact:true}).click();
  await size.fill('8');await size.press('Tab');await covers();
  assert.equal((await obj()).pdfText.replacementFontSizePdf,8);
  await size.fill('');await size.press('Tab');assert.equal((await obj()).pdfText.replacementFontSizePdf,8,'empty size must preserve the last valid size');
  assert.equal((await obj()).pdfText.replacementFontWeight,700);
  assert.equal((await obj()).pdfText.replacementFontStyle,'italic');
  assert.equal((await obj()).pdfText.fontSizePdf,original.pdfText.fontSizePdf);
  const appearance=await editor.evaluate(el=>({weight:getComputedStyle(el).fontWeight,style:getComputedStyle(el).fontStyle,family:getComputedStyle(el).fontFamily}));
  assert.equal(appearance.weight,'700');assert.equal(appearance.style,'italic');
  // Cancelling must clear edited flags and overrides, not leave invisible mutations.
  await page.getByRole('button',{name:'Cancel text edit',exact:true}).click();const cancelled=await obj();
  assert.equal(cancelled.pdfText.edited,original.pdfText.edited);assert.equal(cancelled.pdfText.replacementFontSizePdf,undefined);
  if(process.env.STUDIO_FORMAT_QUICK==='1'){assert.deepEqual(errors,[]);console.log('FORMAT INPUT PASSED');return;}
  await open();await bold.click();await size.fill('8');await size.press('Tab');
  const fit=page.getByLabel('Replacement fit',{exact:true});await fit.selectOption('original');await covers();
  const bg=await fit.evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(bg,'rgb(255, 255, 255)');
  // Keep Done/Cancel on the formatting row at the user's desktop width.
  const rows=await page.evaluate(()=>Array.from(document.querySelectorAll('.studio-text-toolbar > button')).map(el=>el.getBoundingClientRect().top));assert(Math.max(...rows)-Math.min(...rows)<3);
  await page.screenshot({path:path.join(out,'formatting-editor.png'),fullPage:true});
  await page.getByRole('button',{name:'Finish text edit',exact:true}).click();await preview();
  assert.equal((await obj()).pdfText.replacementFontWeight,700);
  const download=page.waitForEvent('download',{timeout:180000});await page.getByRole('button',{name:'Export PDF',exact:true}).click();await(await download).saveAs(path.join(out,'formatted.pdf'));
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(1));await preview();
  assert.equal((await obj()).pdfText.replacementFontSizePdf,8);
  await open();await size.fill('18');await size.press('Tab');await covers();
  assert.equal((await obj()).pdfText.replacementFontSizePdf,18);
  await page.getByRole('button',{name:'Cancel text edit',exact:true}).click();await preview();
  assert.equal((await obj()).pdfText.replacementFontSizePdf,8);
  // Undo and redo the cancellation restore all font overrides as one object state.
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo());assert.equal((await obj()).pdfText.replacementFontSizePdf,18);
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.redo());assert.equal((await obj()).pdfText.replacementFontSizePdf,8);await preview();
  await page.screenshot({path:path.join(out,'formatted-page.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,original,formatted:await obj(),appearance,browserErrors:errors},null,2));console.log('FORMATTING PASSED');
 }finally{await browser?.close();server.kill('SIGKILL')}
})().catch(e=>{console.error(e);process.exitCode=1});

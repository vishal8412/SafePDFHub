const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const root=path.resolve(__dirname,'..'),out=path.join(root,'benchmark-results/signing-ux');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([600,800]).drawText('Signing test page '+(i+1),{x:40,y:740,size:18});
 const fixture=path.join(out,'input.pdf');fs.writeFileSync(fixture,await pdf.save());
 const log=fs.openSync(path.join(out,'server.log'),'w');
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',log,log]});
 let browser;
 try {
  let ready=false;for(let i=0;i<180;i++){try{if((await fetch('http://127.0.0.1:4930')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1366,height:768},acceptDownloads:true});page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4930/studio');await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(fixture);
  await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.hasDocument());await page.locator('.app-loader').waitFor({state:'hidden'});
  const sign=async(kind='Signature')=>{await page.getByRole('button',{name:'Sign',exact:true}).click();await page.locator('.studio-sign-picker__grid').getByRole('button',{name:new RegExp('^'+kind)}).click();await page.locator('.builder').waitFor()};
  const state=()=>page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().filter(o=>o.type==='signature'));
  await sign();
  const visibleFooter=async()=>{const b=await page.locator('.builder__footer .primary').boundingBox();assert(b&&b.y>=0&&b.y+b.height<=page.viewportSize().height,'Use button must be visible without scrolling');};
  await visibleFooter();assert.equal(await page.locator('.draw-tool-button .sign-tool-icon').count(),4);
  const pad=await page.locator('.canvas-wrap canvas').boundingBox();
  await page.mouse.move(pad.x+30,pad.y+50);await page.mouse.down();await page.mouse.move(pad.x+150,pad.y+70,{steps:15});await page.mouse.up();
  await page.screenshot({path:path.join(out,'builder-desktop.png')});
  await page.getByRole('tab',{name:'Type',exact:true}).click();await page.getByLabel('Your text',{exact:true}).fill('Vikram');
  await page.getByRole('button',{name:'Use signature',exact:true}).click();await page.locator('.builder').waitFor({state:'hidden'});
  await page.locator('.studio-sign-placement-hint').waitFor();
  const sheet=await page.locator('.studio-canvas__page').boundingBox();
  await page.mouse.move(sheet.x+sheet.width*.5,sheet.y+sheet.height*.5);await page.locator('.studio-sign-ghost img').waitFor();
  await page.screenshot({path:path.join(out,'placement.png')});
  await page.mouse.click(sheet.x-10,sheet.y+100);assert.equal((await state()).length,0,'gray workspace must not place marks');
  await page.mouse.click(sheet.x+sheet.width*.5,sheet.y+sheet.height*.5);assert.equal((await state()).length,1);
  await page.locator('.studio-sign-placement-hint').waitFor({state:'hidden'});await page.locator('.studio-signature-object__image').waitFor();
  // Copy excludes source page. A repeat must update the same group, retaining artwork.
  await page.getByRole('button',{name:'Copy to other pages…',exact:true}).click();
  const modal=page.locator('.properties-signing-modal');
  await modal.getByLabel('Pages',{exact:true}).fill('2, 99');assert(await modal.getByRole('button',{name:/Copy to \d/}).isDisabled());
  await modal.getByLabel('Pages',{exact:true}).fill('2-3');await page.screenshot({path:path.join(out,'copy-pages.png')});
  await modal.getByRole('button',{name:'Copy to 2 pages',exact:true}).click();await modal.waitFor({state:'hidden'});await page.locator('.app-loader').waitFor({state:'hidden'});
  let objects=await state();assert.equal(objects.length,3);assert(objects.every(o=>o.signing.asset?.dataUrl));assert.equal(new Set(objects.map(o=>o.signing.bulkGroupId)).size,1);
  await page.getByRole('button',{name:'Copy to other pages…',exact:true}).click();await modal.getByLabel('Pages',{exact:true}).fill('2-3');await modal.getByRole('button',{name:'Copy to 2 pages',exact:true}).click();await modal.waitFor({state:'hidden'});await page.locator('.app-loader').waitFor({state:'hidden'});assert.equal((await state()).length,3);
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));await page.locator('.studio-signature-object__image').waitFor();
  const image=page.locator('.studio-signature-object__image');assert(await image.evaluate(el=>el.complete&&el.naturalWidth>0));
  // Delete original; copies must retain independent access to their asset.
  await page.evaluate(()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas')),o=c.objectService.snapshot().find(o=>o.type==='signature'&&o.pageNumber===1);c.facade.goToPage(1);c.facade.selectObject({objectId:o.id,pageNumber:1,bounds:o.bounds,type:'signature'});c.facade.deleteSelectedObject();c.facade.goToPage(2)});
  assert((await state()).every(o=>o.signing.asset?.dataUrl));
  await page.getByRole('button',{name:'Export PDF',exact:true}).click();await page.locator('.studio-export-result').waitFor({state:'visible',timeout:120000});await page.locator('.app-loader').waitFor({state:'hidden'});
  const download=page.waitForEvent('download');await page.locator('.studio-export-result .operation-result__primary').click();await(await download).saveAs(path.join(out,'signed.pdf'));
  await page.getByRole('button',{name:'Continue editing',exact:true}).click();
  // Initials and escape cancellation.
  await sign('Initials');await page.getByRole('tab',{name:'Type',exact:true}).click();await page.getByLabel('Your text',{exact:true}).fill('VS');await page.getByRole('button',{name:'Use initials',exact:true}).click();await page.locator('.studio-sign-placement-hint').waitFor();const before=(await state()).length;await page.keyboard.press('Escape');assert.equal((await state()).length,before);await page.locator('.studio-sign-placement-hint').waitFor({state:'hidden'});
  // Upload stays in the dialog for explicit confirmation.
  await sign();await page.getByRole('tab',{name:'Upload',exact:true}).click();await page.locator('.import-card input').setInputFiles(path.join(root,'regression-fixtures/studio/replacement.png'));await page.locator('.imported-preview img').waitFor();assert(await page.locator('.builder').isVisible());await page.getByRole('button',{name:'Use signature',exact:true}).click();await page.locator('.studio-sign-placement-hint').waitFor();await page.keyboard.press('Escape');
  // Mobile and short desktop heights keep action visible in every method.
  await sign();
  for(const size of [{width:390,height:844},{width:1024,height:600}]){
    await page.setViewportSize(size);for(const name of ['Draw','Type','Upload','Scan']){await page.getByRole('tab',{name,exact:true}).click();await visibleFooter();}
    await page.getByRole('tab',{name:'Draw',exact:true}).click();await page.screenshot({path:path.join(out,`builder-${size.width}.png`)});
  }
  await page.keyboard.press('Escape');await page.locator('.builder').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,browserErrors:errors,footerViewports:['1366x768','390x844','1024x600'],bulkCopiesRetainArtwork:true,invalidPagesRejected:true,repeatCopyNoDuplicates:true,placementPreview:true,cancelPlacement:true,uploadRequiresConfirmation:true},null,2));console.log('SIGNING UX PASSED');
 }finally{await browser?.close();server.kill('SIGKILL')}
})().catch(e=>{console.error(e);process.exitCode=1});

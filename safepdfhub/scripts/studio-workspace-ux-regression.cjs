const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PDFDocument,degrees}=require('pdf-lib');
const root=path.resolve(__dirname,'..'),out=path.join(root,'benchmark-results/workspace-ux');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const pdf=await PDFDocument.create();for(let i=0;i<240;i++){const p=pdf.addPage([600,800]);p.drawText('Workspace test '+(i+1),{x:40,y:740,size:18});if(i===1)p.setRotation(degrees(90));}
 const fixture=path.join(out,'input.pdf');fs.writeFileSync(fixture,await pdf.save());
 const log=fs.openSync(path.join(out,'server.log'),'w');
 const server=require('node:child_process').spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',log,log]});let browser;
 try{
 for(let i=0;i<180;i++){try{if((await fetch('http://127.0.0.1:4930')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4930/studio');await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(fixture);
 await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-studio-canvas'))?.facade.pageCount()===240);await page.locator('.app-loader').waitFor({state:'hidden'});
 await page.locator('.studio-canvas__page canvas').first().waitFor();
 assert.equal(await page.locator('app-header').count(),0);assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Account',exact:true}).count(),0);
 await page.locator('.studio-layout-menu summary').click();
 await page.getByRole('checkbox',{name:/Document bar/}).uncheck();await page.locator('.studio-document-bar').waitFor({state:'hidden'});assert(await page.locator('.studio-navigation').isVisible());await page.getByRole('checkbox',{name:/Document bar/}).check();
 await page.getByRole('checkbox',{name:/Editing toolbar/}).uncheck();await page.locator('app-studio-toolbar').waitFor({state:'hidden'});await page.getByRole('checkbox',{name:/Editing toolbar/}).check();await page.keyboard.press('Escape');
 await page.waitForTimeout(500);
 const list=page.locator('.sidebar__pages-list');await list.evaluate(el=>{el.scrollTop=8000;el.dispatchEvent(new Event('scroll'))});await page.waitForTimeout(700);
 const scroll1=await list.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,first:el.querySelector('[data-page-number]')?.getAttribute('data-page-number')}));console.log('SCROLL',scroll1);assert(scroll1.top>7000,'manual scroll must not snap back');
 await list.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});await page.waitForTimeout(700);assert(await page.locator('[data-page-number="240"]').count(),'last thumbnail reachable');
 await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));await page.waitForTimeout(500);await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(1));await page.waitForTimeout(500);
 await page.screenshot({path:path.join(out,'workspace.png')});
 const zoom=await page.locator('.zoom-select').textContent();assert(zoom.includes('Fit page'));
 const rect=await page.locator('.studio-canvas__page').boundingBox();await page.getByRole('button',{name:'Add Text',exact:true}).click();await page.mouse.click(rect.x+rect.width*.2,rect.y+rect.height*.3);await page.locator('textarea.studio-text-editor').fill('Rotation text');await page.getByRole('button',{name:'Finish text edit',exact:true}).click();
 assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.activeTool()),'select');await page.mouse.click(rect.x+rect.width*.6,rect.y+rect.height*.7);
 const count=()=>page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().filter(o=>o.type==='text'&&!o.pdfText).length);assert.equal(await count(),1);
 // A shared guard prevents both route exit and replacing the active file.
 let confirms=0;
 await page.locator('.studio-brand').click();await page.getByRole('alertdialog').waitFor();assert(page.url().endsWith('/studio'));assert.equal(await page.locator('main.layout').getAttribute('inert'),'');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Keep editing');await page.keyboard.press('Escape');confirms++;
 const unload=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented});assert(unload);
 await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(fixture);await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();confirms++;assert.equal(await count(),1);
 // Add an image using the UI. Its physical aspect ratio must be preserved.
 await page.getByRole('button',{name:'Image',exact:true}).click();await page.mouse.click(rect.x+rect.width*.55,rect.y+rect.height*.55);await page.locator('input[type=file][accept*="image"]').first().setInputFiles(path.join(root,'regression-fixtures/studio/replacement.png'));await page.waitForFunction(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().some(o=>o.type==='image'&&!o.pdfImage));
 const original=await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().filter(o=>!o.pdfText&&!o.pdfImage));
 fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(original));
 for(let turn=1;turn<=4;turn++){
  await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.rotateCurrentPage('right'));await page.waitForTimeout(350);
  const objects=await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().filter(o=>!o.pdfText&&!o.pdfImage));
  for(const o of objects.filter(o=>o.type==='text'||o.type==='image'))assert.equal(o.contentRotation,turn*90%360);
  await page.waitForFunction(expected=>{const el=document.querySelector('.studio-editor-object__image');const box=el?.getBoundingClientRect();return box && Math.abs(box.width/box.height-expected)<.025},turn%2 ? .5 : 2);
  const drawnImage=await page.locator('.studio-editor-object__image').first().boundingBox();assert(Math.abs(drawnImage.width/drawnImage.height-(turn%2 ? .5 : 2))<.025,'rotated image preview aspect ratio');
  if(turn===1){await page.screenshot({path:path.join(out,'rotated.png')});await page.evaluate(async()=>{const c=ng.getComponent(document.querySelector('app-studio-canvas'));const f=await c.facade.exportCurrentDocumentFile();window.exportBytes=Array.from(new Uint8Array(await f.arrayBuffer()))});fs.writeFileSync(path.join(out,'rotated.pdf'),Buffer.from(await page.evaluate(()=>window.exportBytes)));}
 }
 const restored=await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.snapshot().filter(o=>!o.pdfText&&!o.pdfImage));for(const o of original){const n=restored.find(n=>n.id===o.id);for(const k of ['x','y','width','height'])assert(Math.abs(o.bounds[k]-n.bounds[k])<1e-8);}
 // Insert into a page that already has an intrinsic 90-degree rotation.
 await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(2));await page.waitForTimeout(450);
 const landscape=await page.locator('.studio-canvas__page').boundingBox();
 await page.getByRole('button',{name:'Add Text',exact:true}).click();await page.mouse.click(landscape.x+landscape.width*.2,landscape.y+landscape.height*.3);await page.locator('textarea.studio-text-editor').fill('Upright insertion');await page.getByRole('button',{name:'Finish text edit',exact:true}).click();
 await page.getByRole('button',{name:'Image',exact:true}).click();await page.mouse.click(landscape.x+landscape.width*.55,landscape.y+landscape.height*.6);await page.locator('input[type=file][accept*="image"]').first().setInputFiles(path.join(root,'regression-fixtures/studio/replacement.png'));await page.waitForTimeout(300);
 const landscapeImage=await page.locator('.studio-editor-object__image').first().boundingBox();assert(Math.abs(landscapeImage.width/landscapeImage.height-2)<.025);
 await page.getByRole('button',{name:'Export PDF',exact:true}).click();await page.locator('.studio-export-result').waitFor({state:'visible',timeout:120000});await page.locator('.app-loader').waitFor({state:'hidden'});
 const download=page.waitForEvent('download');await page.locator('.studio-export-result .operation-result__primary').click();await(await download).saveAs(path.join(out,'workspace.pdf'));
 await page.getByRole('button',{name:'Continue editing',exact:true}).click();
 assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.hasUnsavedChanges()),false,'download clears current dirty checkpoint');
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}),false);
 await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.goToPage(1));await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Shape',exact:true}).click();await page.locator('[aria-label="Shape options"]').waitFor();const palette=await page.locator('[aria-label="Shape options"]').boundingBox();assert(palette.x>=0&&palette.x+palette.width<=1366);await page.screenshot({path:path.join(out,'shape.png')});
 // Top watermark action.
 await page.getByRole('button',{name:/^Watermark/}).click();await page.getByRole('button',{name:'Add Watermark',exact:true}).waitFor();const apply=await page.getByRole('button',{name:'Add Watermark',exact:true}).boundingBox();assert(apply.y<450);
 await page.screenshot({path:path.join(out,'watermark.png')});
 await page.getByRole('button',{name:'Close watermark inspector',exact:true}).click();
 for(const size of [{width:390,height:844},{width:1024,height:600}]){
   await page.setViewportSize(size);await page.waitForTimeout(350);
   const bar=await page.locator('app-studio-header').boundingBox();assert(bar.x>=0&&bar.x+bar.width<=size.width);
   const shape=await page.locator('[aria-label="Shape options"]').boundingBox();assert(shape.x>=0&&shape.x+shape.width<=size.width,'responsive shape toolbar fits');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(out,`workspace-${size.width}.png`)});
 }
 await page.setViewportSize({width:1366,height:900});
 await page.getByRole('button',{name:'Sign',exact:true}).click();await page.locator('.studio-sign-picker__grid').getByRole('button',{name:/^Signature/}).click();
 for(const name of ['Pen','Pencil','Brush','Eraser']){
   await page.locator('.draw-toolbar').getByRole('button',{name,exact:true}).click();
   await page.waitForFunction(()=>{
     const cursor=decodeURIComponent(document.querySelector('.canvas-wrap canvas').style.cursor);
     const icon=document.querySelector('.active-draw-tool svg path').getAttribute('d');
     return cursor.includes(icon);
   });
 }
 await page.keyboard.press('Escape');
 // Navigation discovery and password export use the same full editing pipeline.
 await page.locator('.studio-tools-menu summary').click();
 assert(await page.getByRole('link',{name:/Compress PDF/}).isVisible());await page.screenshot({path:path.join(out,'tools-menu.png')});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/^Watermark/}).click();
 await page.getByPlaceholder('CONFIDENTIAL',{exact:true}).fill('STUDIO PROTECTED WATERMARK');
 await page.getByRole('button',{name:'Add Watermark',exact:true}).click();
 await page.getByRole('button',{name:'Protect PDF',exact:true}).click();
 const protect=page.locator('.studio-security-dialog__panel--security');await protect.waitFor();
 assert.equal(await protect.getByRole('button',{name:'Unlock PDF',exact:true}).count(),0);
 assert.equal(await protect.locator('.security-form__header').count(),0);
 for(const width of [1366,390]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(200);
   const panel=await protect.boundingBox();assert(panel.x>=0&&panel.x+panel.width<=width&&panel.y>=0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const action of ['.security-form__primary','.security-form__secondary']) {const button=await protect.locator(action).boundingBox();assert(button.y>=0&&button.y+button.height<=844,'password actions remain visible');}
   await page.screenshot({path:path.join(out,`protect-${width}.png`)});
 }
 await page.setViewportSize({width:1366,height:900});
 await page.locator('#security-password').fill('StudioTest123!');await page.locator('#security-confirm-password').fill('StudioTest123!');
 const protectedDownload=page.waitForEvent('download',{timeout:120000});
 await protect.locator('.security-form__primary').click();await(await protectedDownload).saveAs(path.join(out,'protected.pdf'));
 await page.locator('.app-loader').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-studio-canvas')).facade.hasUnsavedChanges()),false,'protected download clears the downloaded revision');
 // Confirming the branded guard completes navigation; background cannot consume Escape/Tab.
 await page.getByRole('button',{name:'Add Text',exact:true}).click();
 const finalRect=await page.locator('.studio-canvas__page').boundingBox();await page.mouse.click(finalRect.x+finalRect.width*.3,finalRect.y+finalRect.height*.4);await page.locator('textarea.studio-text-editor').fill('Unsaved final edit');await page.getByRole('button',{name:'Finish text edit',exact:true}).click();
 await page.locator('.studio-brand').click();await page.getByRole('alertdialog').waitFor();await page.screenshot({path:path.join(out,'exit-dialog.png')});
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Leave without downloading');
 await page.getByRole('button',{name:'Leave without downloading',exact:true}).click();await page.waitForURL('http://127.0.0.1:4930/');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,browserErrors:errors,manualSidebarScroll:scroll1,guardConfirmations:confirms},null,2));console.log('WORKSPACE UX PASSED');
 }finally{await browser?.close();server.kill('SIGTERM');fs.closeSync(log)}
})().catch(e=>{console.error(e);process.exitCode=1});

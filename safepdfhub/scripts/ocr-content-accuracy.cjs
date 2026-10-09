const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const JSZip=require('jszip');
const root=path.resolve(__dirname,'..'),out=path.join(root,'accuracy-validation');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=spawn('npm',['start','--','--host','127.0.0.1','--port','4932','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(out,'server.log'),'w'),'inherit']});
 process.on('exit',()=>server.kill());
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4932')).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 const browser=await chromium.launch({executablePath:process.env.WORD_BROWSER,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true});const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));let downloadCount=0;page.on('download',()=>downloadCount++);
 try{
 await page.goto('http://127.0.0.1:4932/tools/pdf-to-word');await page.waitForFunction(()=>window.ng&&ng.getComponent(document.querySelector('app-tool')));
 async function upload(file){await page.locator('.app-loader').waitFor({state:'hidden'});await page.locator('input[type=file]').first().setInputFiles(file);await page.locator('app-word-workspace').waitFor();}
 async function convert(file,lang){
  await upload(file);await page.locator('#word-ocr-language').selectOption(lang);
  await page.evaluate(()=>{
    const engine=ng.getComponent(document.querySelector('app-word-workspace')).engine;
    if(!engine.originalPng)engine.originalPng=engine.png.bind(engine);window.pageHashes=[];
    engine.png=async canvas=>{const b=await engine.originalPng(canvas);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');window.pageHashes.push(hash);return b;};
  });
  await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
  await Promise.race([page.getByRole('heading',{name:'Your Word document is ready'}).waitFor({timeout:300000}),page.locator('app-word-workspace [role=alert]').waitFor({timeout:300000}).then(async()=>{throw Error(await page.locator('app-word-workspace [role=alert]').innerText());})]);
  await page.locator('.app-loader').waitFor({state:'hidden'});
  const result=await page.evaluate(()=>{const r=ng.getComponent(document.querySelector('app-word-workspace')).result;return {...r,file:undefined,bytes:r.file.size,hashes:window.pageHashes};});
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator('.operation-result__primary').click()]);const dest=path.join(out,path.basename(file,'.pdf')+'-'+lang+'.docx');await d.saveAs(dest);
  const zip=await JSZip.loadAsync(fs.readFileSync(dest));const xml=await zip.file('word/document.xml').async('string');
  const hashes=[];for(let i=1;i<=result.hashes.length;i++){const f=zip.file(`word/media/image${i}.png`);if(!f)throw Error('Missing source page image '+i);hashes.push(crypto.createHash('sha256').update(await f.async('nodebuffer')).digest('hex'));}
  if(JSON.stringify(hashes)!==JSON.stringify(result.hashes))throw Error('Page image changed during export');
  const report={...result,hashes:undefined,imageHashesVerified:hashes.length,sections:(xml.match(/<w:sectPr>/g)||[]).length};
  console.log('CONVERTED',path.basename(file),JSON.stringify({...report,preservedPages:report.preservedPages.length,imagePages:report.imagePages.length,reviewPages:report.reviewPages.length}));return {report,xml};
 }
 const input=process.env.ACCURACY_PDF;
 await upload(input);await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Choose the document language'}).waitFor({timeout:20000});
 await page.locator('.app-loader').waitFor({state:'hidden'});
 if(downloadCount)throw Error('Unexpected auto download');
 const actual=await convert(input,'mar+eng');
 if(actual.report.pages!==189||actual.report.imagePages.length!==189||actual.report.ocrPages.length||/<w:t[ >]/.test(actual.xml))throw Error('Unreliable scan text was exported');
 await page.screenshot({path:path.join(out,'result.png')});
 const english=await convert(path.join(root,'regression-fixtures/word/ocr-english.pdf'),'eng');
 if(!english.report.ocrPages.length||!english.xml.includes('Invoice number 4827'))throw Error('Clear English recognition regressed');
 fs.writeFileSync(path.join(out,'accuracy-browser.json'),JSON.stringify({source:actual.report,clearEnglish:english.report,missingLanguageRejected:true,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log('ALL PASS');
 }catch(e){console.error(e);console.log(await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}
 finally{await browser.close();server.kill();process.exit(process.exitCode||0);}
})();

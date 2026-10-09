/** Requires Playwright + Chromium outside production dependencies.
 * PLAYWRIGHT_MODULE and CHROMIUM_MODULE may point to installed packages. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'ocr-validation');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=spawn('npm',['start','--','--host','127.0.0.1','--port','4932','--live-reload=false','--hmr=false'],{cwd:root,stdio:['ignore',fs.openSync(path.join(output,'server.log'),'w'),'inherit']});
 process.on('exit',()=>server.kill('SIGTERM'));
 for(let i=0;i<90;i++){try {const r=await fetch('http://127.0.0.1:4932');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 const binary = process.env.WORD_BROWSER || await require(process.env.CHROMIUM_MODULE || '@sparticuz/chromium').executablePath();
 const browser = await chromium.launch({executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[], requests=[], reports={};
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>requests.push(r.url()));
 page.on('console',msg=>{if(msg.type()==='error') console.log('BROWSER',msg.text())});
 try {
 await page.goto('http://127.0.0.1:4932/tools/pdf-to-word');
 await page.locator('input[type=file]').first().waitFor({state:'attached'});
 await page.waitForFunction(()=>window.ng && ng.getComponent(document.querySelector('app-tool')));
 async function upload(name){
  await page.locator('.app-loader').waitFor({state:'hidden'});
  await page.locator('input[type=file]').first().setInputFiles(path.join(root,'regression-fixtures/word',name));
  await page.locator('app-word-workspace').waitFor();
 }
 async function convert(name,opts={}){
  await upload(name);
  await page.getByRole('radio',{name: opts.appearance?'Keep page appearance':'Editable text'}).check();
  if(!opts.appearance){await page.locator('#word-ocr-mode').selectOption(opts.mode||'auto');await page.locator('#word-ocr-language').selectOption(opts.language||'eng').catch(()=>{});}
  const before=requests.length;
  await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
  console.log('CONVERTING',name);
  await Promise.race([page.getByRole('heading',{name:'Your Word document is ready'}).waitFor({timeout:60000}),page.locator('app-word-workspace [role=alert]').waitFor().then(async()=>{throw Error(await page.locator('app-word-workspace [role=alert]').innerText())})]);
  await page.locator('.app-loader').waitFor({state:'hidden'});
  const result=await page.evaluate(()=>{const r=ng.getComponent(document.querySelector('app-word-workspace')).result;return {...r,file:undefined,bytes:r.file.size};});
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('app-operation-result .operation-result__primary').click()]);const dest=path.join(output,(opts.appearance?'appearance-':opts.mode==='off'?'off-':'')+path.basename(name).replace('.pdf','.docx'));await download.saveAs(dest);
  const zip=await JSZip.loadAsync(fs.readFileSync(dest));const xml=await zip.file('word/document.xml').async('string');
  if(fs.statSync(dest).size!==result.bytes)throw Error('Download size mismatch');
  reports[name+(opts.appearance?'-appearance':opts.mode==='off'?'-off':'')]={...result,ocrAssetRequests:requests.slice(before).filter(u=>u.includes('/ocr/')).length,sections:(xml.match(/<w:sectPr>/g)||[]).length};
  console.log('PASS',name,JSON.stringify(result));
  return {result,xml};
 }
 const hindi=await convert('ocr-hindi.pdf',{language:'hin'});
 if(!hindi.xml.includes('नमस्ते भारत')||hindi.result.ocrPages[0]!==1)throw Error('Hindi recognition failed');
 await page.setViewportSize({width:1440,height:1000});
 const large=await convert('../../ocr-validation/large-images.pdf',{appearance:true});
 if(large.result.pages!==16)throw Error('Large file pages missing');
 reports.largeInputBytes=fs.statSync(path.join(output,'large-images.pdf')).size;
 await upload('ocr-mixed.pdf');await page.getByRole('radio',{name:'Editable text'}).check();await page.locator('#word-ocr-mode').selectOption('auto');
 await page.getByRole('button',{name:'Convert to Word',exact:true}).click();
 await page.locator('.page-progress').filter({hasText:'Page 2 of 2'}).waitFor();
 await page.screenshot({path:path.join(output,'common-loader.png')});
 await page.getByRole('heading',{name:'Your Word document is ready'}).waitFor({timeout:120000});
 await page.locator('.app-loader').waitFor({state:'hidden'});
 await page.screenshot({path:path.join(output,'result.png')});
 await upload('ocr-english.pdf');await page.setViewportSize({width:390,height:1000});
 await page.screenshot({path:path.join(output,'mobile-settings.png')});
 if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Mobile horizontal overflow');
 reports.mobileNoOverflow=true;reports.errors=errors;
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(path.join(output,'large-hindi.json'),JSON.stringify(reports,null,2));console.log('ALL PASS');
 }catch(e){await page.screenshot({path:path.join(output,'failure.png')});console.error(e);console.log(await page.locator('body').innerText());process.exitCode=1;}
 finally{await browser.close();server.kill('SIGTERM');process.exit(process.exitCode||0);}
})();

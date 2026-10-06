import sys,json,time,argparse,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright
import fitz
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('label');p.add_argument('--target');p.add_argument('--mode',default='Maximum Reduction');args=p.parse_args()
root=Path.cwd();source=Path(args.input).resolve();out=Path(os.environ.get('COMPRESSOR_TEST_OUTPUT', 'benchmark-results/compressor'))/args.label;out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(accept_downloads=True)
 page.add_init_script('''window.pickerCalls=0;window.showSaveFilePicker=()=>{window.pickerCalls++;throw new Error('Picker blocked')};window.largeReads=[];const read=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(this.size>32000000)window.largeReads.push(this.size);return read.call(this)};window.workerResults=[];const W=Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',e=>{if(['done','error','phase'].includes(e.data.type)){window.workerResults.push(e.data);console.log('WORKER '+JSON.stringify(e.data))}})}};''')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m: print(m.text[:400],flush=True) if m.text.startswith('WORKER') else None)
 page.goto(os.environ.get('COMPRESSOR_TEST_URL', 'http://127.0.0.1:4920/tools/compress-pdf'));page.locator('input[type=file]').first.set_input_files(str(source))
 page.get_by_role('button',name='Compress PDF',exact=True).wait_for(timeout=120000)
 if source.stat().st_size <= 200_000_000:page.locator('button.mode-card').filter(has_text=args.mode).click()
 if args.target:
  page.get_by_label('Compress to a target size').check();page.get_by_label('Maximum file size (MB)').fill(args.target)
 start=time.monotonic();page.get_by_role('button',name='Compress PDF',exact=True).click();print('START',args.label,flush=True)
 try:page.locator('button.operation-result__primary').wait_for(timeout=310000)
 except:
  print(page.locator('body').inner_text());print(page.evaluate('window.workerResults'));raise
 seconds=time.monotonic()-start
 with page.expect_download() as d:page.locator('button.operation-result__primary').click()
 dest=out/'result.pdf';d.value.save_as(dest)
 a=fitz.open(source);b=fitz.open(dest)
 assert not b.is_repaired and len(a)==len(b)
 for i in set([0,len(a)//2,len(a)-1]):assert a[i].get_text()==b[i].get_text() and a[i].rect==b[i].rect
 assert dest.stat().st_size<=source.stat().st_size
 result={'inputBytes':source.stat().st_size,'outputBytes':dest.stat().st_size,'seconds':seconds,'pages':len(b),'description':page.locator('app-operation-result').inner_text(),'errors':errors,'largeReads':page.evaluate('window.largeReads'),'pickerCalls':page.evaluate('window.pickerCalls'),'workers':page.evaluate('window.workerResults')}
 assert not errors and not result['largeReads'] and result['pickerCalls']==0
 with page.expect_download() as d:page.locator('button.operation-result__primary').click()
 repeat=out/'repeat.pdf';d.value.save_as(repeat);assert hashlib.sha256(repeat.read_bytes()).digest()==hashlib.sha256(dest.read_bytes()).digest();repeat.unlink()
 result['repeatDownloadIdentical']=True
 (out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
 browser.close()

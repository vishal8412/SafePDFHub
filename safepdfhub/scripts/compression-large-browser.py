"""Benchmark the disk-backed compressor against a running local application.
Uses the anchor-download fallback so an automated run does not open a native save picker.
"""
import argparse, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True,type=Path)
parser.add_argument('--url',default='http://localhost:4200/tools/compress-pdf')
parser.add_argument('--browser',help='Optional Chromium executable path')
parser.add_argument('--output-dir',type=Path,default=Path('benchmark-results/large-compression'))
args=parser.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 options={'headless':True}
 if args.browser:options['executable_path']=args.browser
 browser=p.chromium.launch(**options)
 page=browser.new_page(accept_downloads=True)
 page.add_init_script("window.showSaveFilePicker=undefined;window.largeReads=[];const old=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(this.size>32000000)window.largeReads.push(this.size);return old.call(this)}")
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url);page.locator('input[type=file]').first.set_input_files(str(args.input.resolve()))
 button=page.get_by_role('button',name='Compress PDF',exact=True);button.wait_for(timeout=30000)
 start=time.monotonic();button.click()
 page.locator('button.operation-result__primary').wait_for(timeout=330000)
 with page.expect_download() as download:page.locator('button.operation-result__primary').click()
 output=args.output_dir/'compressed.pdf';download.value.save_as(output)
 result={'inputBytes':args.input.stat().st_size,'outputBytes':output.stat().st_size,'seconds':round(time.monotonic()-start,2),'mainThreadLargeReads':page.evaluate('window.largeReads'),'pageErrors':errors,'description':page.locator('app-operation-result').inner_text()}
 assert not result['mainThreadLargeReads'] and not errors
 assert f"{result['outputBytes']:,} bytes" in result['description']
 (args.output_dir/'result.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2));browser.close()

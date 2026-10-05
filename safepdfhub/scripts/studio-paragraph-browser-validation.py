import sys,time,json,urllib.request,subprocess,os,atexit,signal
from pathlib import Path
os.chdir(Path(__file__).resolve().parent.parent)
from playwright.sync_api import sync_playwright
sample=Path(os.environ['STUDIO_SAMPLE_PDF']).resolve()
if not sample.is_file(): raise SystemExit('STUDIO_SAMPLE_PDF must point to the supplied 15-MB(1).pdf test sample.')
out=Path(os.environ.get('STUDIO_RESULTS_DIR','benchmark-results/studio-paragraphs'));out.mkdir(parents=True,exist_ok=True)
server=subprocess.Popen(['npm','start','--','--host','127.0.0.1','--port','4930','--live-reload=false','--hmr=false'],cwd='.',stdout=open(out/'server.log','w'),stderr=subprocess.STDOUT,start_new_session=True)
atexit.register(lambda:os.killpg(server.pid,signal.SIGTERM))
for _ in range(60):
 try:urllib.request.urlopen('http://127.0.0.1:4930').close();break
 except:time.sleep(1)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1600,'height':1100},accept_downloads=True)
 page.on('pageerror',lambda e:print('ERROR',str(e),flush=True))
 page.goto('http://127.0.0.1:4930/studio');print('inputs',page.locator('input[type=file]').evaluate_all('(els)=>els.map(e=>({accept:e.accept,html:e.outerHTML}))'),flush=True)
 page.wait_for_function("window.ng && ng.getComponent(document.querySelector('app-studio-canvas'))?.facade")
 page.locator('input[type=file][accept*="pdf"]').first.set_input_files(str(sample))
 page.wait_for_function("ng.getComponent(document.querySelector('app-studio-canvas')).facade.hasDocument()",timeout=60000)
 data=page.evaluate("async()=>{let c=ng.getComponent(document.querySelector('app-studio-canvas'));await c.facade.ensureCurrentPageContent();return c.objectService.listForPage(1)}")
 (out/'objects.json').write_text(json.dumps(data,indent=2))
 paragraphs=[x for x in data if x.get('pdfText')]
 print('PARAGRAPHS',[(x['text'][:45],len(x['pdfText'].get('sourceLines',[]))) for x in paragraphs],flush=True)
 text=next(x for x in paragraphs if x['text'].startswith('Donec tempor'))
 assert len(text['pdfText']['sourceLines'])>=4
 page.get_by_role('button',name='Edit PDF Text',exact=True).click()
 page.locator('[data-object-id="'+text['id']+'"]').click()
 editor=page.get_by_role('textbox',name='Edit PDF text',exact=True)
 replacement=text['text']+'\nVishal Suryawanshi added this new line.\nA second new line keeps the same font and spacing.'
 editor.fill(replacement)
 page.wait_for_timeout(300)
 page.wait_for_function("!ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy() && (ng.getComponent(document.querySelector('app-studio-canvas')).committedPreview() || ng.getComponent(document.querySelector('app-studio-canvas')).previewError())",timeout=90000)
 assert not page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).previewError()")
 print('LIVE',page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).previewError()"),flush=True)
 page.screenshot(path=str(out/'live-text.png'),full_page=True)
 page.get_by_role('button',name='Finish text edit',exact=True).click()
 page.wait_for_timeout(300)
 page.wait_for_function("!ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy() && (ng.getComponent(document.querySelector('app-studio-canvas')).committedPreview() || ng.getComponent(document.querySelector('app-studio-canvas')).previewError())",timeout=90000)
 assert not page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).previewError()")
 print('COMMITTED',page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).previewError()"),flush=True)
 with page.expect_download(timeout=90000) as d:page.get_by_role('button',name='Export PDF',exact=True).click()
 d.value.save_as(out/'paragraph-edited.pdf')
 page.wait_for_timeout(800)
 page.get_by_role('button',name='Edit PDF Image',exact=True).click()
 image=max((x for x in data if x['type']=='image'),key=lambda x:x['bounds']['width']*x['bounds']['height'])
 with page.expect_file_chooser() as chooser:page.locator('[data-object-id="'+image['id']+'"]').click(position={'x':5,'y':5})
 chooser.value.set_files(str(Path('regression-fixtures/studio/replacement.png').resolve()))
 page.wait_for_function("ng.getComponent(document.querySelector('app-studio-canvas')).objectService.listForPage(1).some(x=>x.pdfImage?.replaced)")
 page.wait_for_timeout(300)
 page.wait_for_function("!ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy() && ng.getComponent(document.querySelector('app-studio-canvas')).committedPreview()",timeout=90000)
 with page.expect_download(timeout=90000) as d:page.get_by_role('button',name='Export PDF',exact=True).click()
 d.value.save_as(out/'paragraph-image-edited.pdf')
 page.wait_for_timeout(800)
 page.screenshot(path=str(out/'committed-image.png'),full_page=True)
 # Move the replacement left. Its original source location must still be removed.
 page.get_by_role('button',name='Select',exact=True).click()
 page.wait_for_timeout(300)
 page.wait_for_function("!ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy()",timeout=90000)
 box=page.locator('.studio-selection-box').bounding_box()
 assert box
 start_x=box['x']+box['width']/2;start_y=box['y']+box['height']/2
 page.mouse.move(start_x,start_y);page.mouse.down()
 page.mouse.move(start_x-32,start_y+10,steps=5);page.mouse.up()
 moved_by_pointer=page.evaluate("id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id)",image['id'])
 assert moved_by_pointer['bounds']['x'] < image['bounds']['x']-.01
 assert moved_by_pointer['bounds']['y'] > image['bounds']['y']
 print('POINTER DRAG PASSED',flush=True)
 with page.expect_download(timeout=90000) as d:page.get_by_role('button',name='Export PDF',exact=True).click()
 d.value.save_as(out/'moved-image.pdf')
 # Undo/redo must round-trip the moved replacement and original source geometry.
 moved=page.evaluate("id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id)",image['id'])
 assert abs(moved['pdfImage']['sourceBounds']['x']-image['bounds']['x'])<1e-8
 assert page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).facade.undo()")
 assert page.evaluate("ng.getComponent(document.querySelector('app-studio-canvas')).facade.redo()")
 restored_move=page.evaluate("id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id)",image['id'])
 assert restored_move['bounds']==moved['bounds']
 page.evaluate("id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.clearImageData(id)",image['id'])
 restored=page.evaluate("id=>ng.getComponent(document.querySelector('app-studio-canvas')).objectService.get(id)",image['id'])
 assert restored['bounds']==image['bounds'] and not restored['pdfImage']['replaced']
 with page.expect_download(timeout=90000) as d:page.get_by_role('button',name='Export PDF',exact=True).click()
 d.value.save_as(out/'restored-image.pdf')
 page.wait_for_timeout(300)
 page.wait_for_function("!ng.getComponent(document.querySelector('app-studio-canvas')).previewBusy()",timeout=90000)
 following=next(x for x in paragraphs if x['text'].startswith('Donec semper'))
 page.get_by_role('button',name='Edit PDF Text',exact=True).click()
 page.locator('[data-object-id="'+following['id']+'"]').click()
 assert page.get_by_role('textbox',name='Edit PDF text',exact=True).input_value()==following['text']
 assert abs(float(page.get_by_role('spinbutton',name='Text size',exact=True).input_value())-10.56)<.01
 page.get_by_role('button',name='Finish text edit',exact=True).click()
 print('PARAGRAPH, COMPOSITE IMAGE, POINTER DRAG, UNDO/REDO AND RESTORE COMPLETE',flush=True)
 browser.close()

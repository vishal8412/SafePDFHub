import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfPageRendererService } from './pdf-page-renderer.service';
import { pdfjsFontOptions } from '../../../core/pdf/pdfjs-font-options';
import { studioZoomScale, studioZoomPercent } from './studio-view-layout';
import { StudioFacade } from '../facade/studio.facade';
import { StudioStateService } from '../state/studio-state.service';
import { StudioPageService } from './studio-page.service';
import { PdfEngineService } from './pdf-engine.service';
import type { StudioPdfDocument } from '../models/pdf-document.model';

function read(blob:Blob):Promise<ArrayBuffer> { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);}); }
describe('Studio source font and display fidelity',()=>{
  it('renders a 612-point page as 816 CSS pixels at 100% without altering source fonts',async()=>{
    const renderer=new PdfPageRendererService();
    const render=vi.fn(()=>({promise:Promise.resolve(),cancel:vi.fn()}));
    const source={rotate:0,getViewport:({scale}:{scale:number})=>({width:612*scale,height:792*scale}),render,cleanup:vi.fn()};
    const pdf={numPages:1,getPage:vi.fn(async()=>source)};
    const canvas={style:{},getContext:()=>({setTransform:vi.fn(),clearRect:vi.fn()})} as unknown as HTMLCanvasElement;
    const result=await renderer.renderPage(pdf as any,1,canvas,{mode:'zoom',zoomPercent:100});
    expect(result.width).toBe(816);expect(result.height).toBe(1056);
    expect(canvas.style.width).toBe('816px');expect(render).toHaveBeenCalledOnce();
    expect(studioZoomPercent(result.scale)).toBe(100);
    const fit=await renderer.renderPage(pdf as any,1,canvas,{mode:'fit-page',viewportWidth:840,viewportHeight:1080,padding:12});
    expect(fit.scale).toBeCloseTo(result.scale);
  });
  it('keeps reported zoom consistent without applying the screen conversion twice',()=>{
    for(const percent of [50,75,100,125,150,200]) expect(studioZoomPercent(studioZoomScale(percent))).toBe(percent);
    expect(studioZoomPercent(1)).toBe(75);
    expect(studioZoomScale(NaN)).toBeCloseTo(4/3);
  });
  it('resolves bundled font resources under root and subdirectory deployments',()=>{
    for(const root of ['https://example.test/','https://example.test/editor/']) {
      const options=pdfjsFontOptions(root);
      expect(options.standardFontDataUrl).toBe(root+'assets/pdfjs/standard_fonts/');
      expect(options.cMapUrl).toBe(root+'assets/pdfjs/cmaps/');
      expect(options.wasmUrl).toBe(root+'assets/pdfjs/wasm/');
      expect(options.disableFontFace).toBe(false);expect(options.cMapPacked).toBe(true);
    }
  });
  it('passes font resources to the Studio document loader',async()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient()]});
    const engine=TestBed.inject(PdfEngineService);
    const getDocument=vi.fn((_options:unknown)=>({promise:Promise.resolve({numPages:1})}));
    vi.spyOn(engine as any,'getPdfJs').mockResolvedValue({getDocument});
    await engine.loadData(new Uint8Array([1]));
    expect(getDocument.mock.calls[0][0]).toMatchObject({...pdfjsFontOptions(),fontExtraProperties:true});
  });
  it('exports an unedited PDF byte-for-byte, preserving source font resources',async()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient()]});
    const doc=await PDFDocument.create();const page=doc.addPage([612,792]);const font=await doc.embedFont(StandardFonts.TimesRoman);
    page.drawText('Original Times text',{font,size:18,x:40,y:700});
    const bytes=await doc.save();const file=new File([bytes.slice().buffer as ArrayBuffer],'original.pdf',{type:'application/pdf'});
    const state=TestBed.inject(StudioStateService),pages=TestBed.inject(StudioPageService),facade=TestBed.inject(StudioFacade);
    state.setDocument({id:'original',name:file.name,file,size:file.size,type:file.type,pageCount:1,pdf:{}} as StudioPdfDocument);pages.initialize(1);
    const result=await facade.exportCurrentDocumentFile();
    expect(new Uint8Array(await read(result))).toEqual(bytes);
  });
});
